import 'dotenv/config';
import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';
import { socketToken, socketOriginAllowed } from './src/lib/socket-auth';
import { db } from './src/lib/db';
import { placeBid } from './src/lib/bidding';
import { z } from 'zod';
import { processReleases, reconcileHolds } from './src/lib/payments';
import { closeDueAuctions, processCaptures } from './src/lib/settlement';
import { expireOffers } from './src/lib/offers';
import { localPaymentsEnabled } from './src/lib/local-payment';
async function main() {
  const app = next({ dev: process.env.NODE_ENV !== 'production' });
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  let processingPayments = false;
  setInterval(async () => {
    if (processingPayments || !process.env.DATABASE_URL) return;
    processingPayments = true;
    try {
      await closeDueAuctions();
      await expireOffers();
      if (!process.env.STRIPE_SECRET_KEY && !localPaymentsEnabled()) return;
      await processCaptures();
      await processReleases();
      await reconcileHolds();
    } catch {
      console.error('Payment reconciliation failed; retrying.');
    } finally {
      processingPayments = false;
    }
  }, 15000).unref();
  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const io = new Server(server, {
    maxHttpBufferSize: 8192,
    cors: { origin, credentials: true },
    allowRequest: (req, callback) => {
      // Same-origin polling GETs may omit Origin; validate Referer in that case.
      callback(null, socketOriginAllowed(req.headers, origin));
    },
  });
  io.on('connection', (socket) => {
    socket.on('auction.subscribe', async (id: unknown) => {
      if (
        !process.env.DATABASE_URL ||
        !z.string().uuid().safeParse(id).success ||
        socket.rooms.size > 20
      )
        return;
      try {
        // Join before snapshot so a bid committed during the read is not missed.
        await socket.join(id as string);
        const vehicle = await db.vehicle.findFirst({
          where: {
            id: id as string,
            listingType: 'AUCTION_7_DAYS',
            status: { in: ['ACTIVE', 'EXPIRED', 'SOLD'] },
          },
          select: {
            id: true,
            status: true,
            currentPrice: true,
            auctionEndsAt: true,
            version: true,
          },
        });
        if (vehicle) socket.emit('auction.snapshot', vehicle);
        else await socket.leave(id as string);
      } catch {
        socket.emit('auction.unavailable');
      }
    });
    let pending = false;
    let lastBidAt = 0;
    socket.on('auction.bid', async (input: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      if (pending || Date.now() - lastBidAt < 1000) return ack({ error: 'RATE_LIMITED' });
      pending = true;
      lastBidAt = Date.now();
      try {
        const token = await socketToken(
          socket.request.headers,
          origin,
          process.env.NEXTAUTH_SECRET,
        );
        if (!token?.sub) return ack({ error: 'UNAUTHORIZED' });
        const account = await db.user.findUnique({
          where: { id: token.sub },
          select: { authVersion: true, suspendedAt: true, isSample: true },
        });
        if (
          !account ||
          account.suspendedAt ||
          account.isSample ||
          account.authVersion !== token.authVersion
        )
          return ack({ error: 'UNAUTHORIZED' });
        ack({ data: await placeBid(token.sub, input) });
      } catch {
        ack({ error: 'BID_REJECTED' });
      } finally {
        pending = false;
      }
    });
  });
  // Durable at-least-once delivery; clients discard older/equal auction versions.
  let dispatching = false;
  setInterval(async () => {
    if (dispatching || !process.env.DATABASE_URL) return;
    dispatching = true;
    try {
      const events = await db.outboxEvent.findMany({
        where: { deliveredAt: null, kind: 'auction.updated' },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      for (const event of events) {
        const payload = event.payload as { vehicleId: string };
        io.to(payload.vehicleId).emit(event.kind, event.payload);
        await db.outboxEvent.update({ where: { id: event.id }, data: { deliveredAt: new Date() } });
      }
    } catch {
      console.error('Outbox dispatch failed; retrying.');
    } finally {
      dispatching = false;
    }
  }, 500).unref();
  server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () =>
    console.log(`Local: http://127.0.0.1:${process.env.PORT ?? 3000}`),
  );
}
main().catch(() => {
  console.error('Server startup failed');
  process.exit(1);
});
