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
import { cleanupMedia } from './src/lib/media';
import { cleanupListingViews } from './src/lib/listing-statistics';
import { WorkerMonitor } from './src/lib/worker-monitor';
import { notifySearchMatches } from './src/lib/saved-searches';
import { notifyHoldRenewals } from './src/lib/notifications';
import { notifyAppointmentReminders } from './src/lib/appointment-reminders';
import { sweepLocalProxy } from './src/lib/local-proxy-lifecycle';
import { remindRefundInformation } from './src/lib/refund-notifications';
import { refundPool } from './src/lib/refund-service';
import { enforceProductionLaunch } from './src/lib/launch-gate';
import { readLaunchDatabase } from './src/lib/launch-database';
async function main() {
  await enforceProductionLaunch(process.env, () => readLaunchDatabase(db, process.env));
  const monitor = new WorkerMonitor();
  process.env.OPS_INSTANCE_ID = monitor.state.instanceId;
  await monitor.persist();
  const app = next({ dev: process.env.NODE_ENV !== 'production', webpack: true });
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  const timers: NodeJS.Timeout[] = [];
  // Separate preview/HTTP hosts may connect read-only without running a second
  // copy of the auction, payment, media and outbox workers.
  const workersEnabled =
    !!process.env.DATABASE_URL && process.env.BACKGROUND_WORKERS_ENABLED !== 'false';
  function schedule(
    name: string,
    interval: number,
    maxRun: number,
    task: () => Promise<unknown>,
    enabled = workersEnabled,
  ) {
    const run = monitor.register(name, interval, maxRun, enabled);
    timers.push(setInterval(() => void run(task), interval).unref());
  }
  timers.push(
    setInterval(
      () =>
        void monitor.persist().catch(() => console.error('Worker heartbeat persistence failed')),
      5000,
    ).unref(),
  );
  schedule('media.cleanup', 3600000, 120000, async () => {
    const result = await cleanupMedia({ apply: true });
    if (result.failed) throw new Error('MEDIA_CLEANUP_RETRY');
  });
  schedule('notifications.searches', 60000, 120000, () => notifySearchMatches(db));
  schedule('statistics.cleanup', 3600000, 30000, () => cleanupListingViews(db));
  schedule('notifications.renewal', 60000, 30000, () => notifyHoldRenewals(db));
  schedule('notifications.appointments', 60000, 30000, () => notifyAppointmentReminders(db));
  schedule(
    'refund.information-reminders',
    60000,
    30000,
    () => remindRefundInformation(refundPool()),
    workersEnabled &&
      process.env.LOCAL_REFUND_POLICY_WORKER === 'true' &&
      localPaymentsEnabled() &&
      ['development', 'test'].includes(process.env.NODE_ENV ?? ''),
  );
  const close = monitor.register('auction.close', 15000, 120000, workersEnabled);
  schedule(
    'local-proxy.lifecycle',
    15000,
    120000,
    () => sweepLocalProxy(db),
    workersEnabled &&
      process.env.LOCAL_PROXY_ENGINE === 'true' &&
      ['development', 'test'].includes(process.env.NODE_ENV ?? ''),
  );
  const offers = monitor.register('offers.expire', 15000, 120000, workersEnabled);
  // Preserve the existing serial business-worker ordering; track failures independently.
  const paymentsEnabled =
    workersEnabled && (!!process.env.STRIPE_SECRET_KEY || localPaymentsEnabled());
  const capture = monitor.register('payment.capture', 15000, 120000, paymentsEnabled);
  const release = monitor.register('payment.release', 15000, 120000, paymentsEnabled);
  const reconcile = monitor.register('payment.reconcile', 15000, 120000, paymentsEnabled);
  schedule('business.cycle', 15000, 600000, async () => {
    await close(closeDueAuctions);
    await offers(expireOffers);
    await capture(processCaptures);
    await release(processReleases);
    await reconcile(reconcileHolds);
  });
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
          select: { authVersion: true, suspendedAt: true, isSample: true, role: true },
        });
        if (
          !account ||
          account.suspendedAt ||
          account.isSample ||
          (account.role === 'ADMIN' && token.adminMfa !== true) ||
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
  schedule('outbox.dispatch', 500, 30000, async () => {
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
  });
  await monitor.persist();
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    monitor.state.stopping = true;
    timers.forEach(clearInterval);
    await monitor.persist().catch(() => {});
    io.close();
    server.close();
    const deadline = Date.now() + 30000;
    while (monitor.state.workers.some((w) => w.state === 'running') && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    await db.$disconnect();
    process.exit(0);
  }
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () =>
    console.log(`Local: http://127.0.0.1:${process.env.PORT ?? 3000}`),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error && error.message.startsWith('LAUNCH_BLOCKED:')
      ? error.message
      : 'Server startup failed',
  );
  process.exit(1);
});
