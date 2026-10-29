import type { PrismaClient } from '../generated/prisma/client';
import { z } from 'zod';
import { assertSameOrigin } from './mutation';
import { readListingStatistics, recordListingView } from './listing-statistics';
export function statisticsHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const status =
        code === 'UNAUTHORIZED'
          ? 401
          : code === 'FORBIDDEN'
            ? 403
            : e instanceof z.ZodError || e instanceof SyntaxError || code === 'INVALID_BODY'
              ? 400
              : 503;
      return Response.json(
        { error: status === 503 ? 'UNAVAILABLE' : 'REQUEST_REJECTED' },
        { status, headers },
      );
    }
  }
  return {
    GET: (r: Request) =>
      handle(async () =>
        readListingStatistics(
          db,
          await authenticate(),
          Object.fromEntries(new URL(r.url).searchParams),
        ),
      ),
    POST: (r: Request) =>
      handle(async () => {
        assertSameOrigin(r);
        const user = await authenticate();
        const reader = r.body?.getReader();
        if (!reader) throw Error('INVALID_BODY');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 512) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        await recordListingView(
          db,
          user,
          JSON.parse(Buffer.concat(chunks).toString('utf8')),
          r.headers.get('user-agent') ?? '',
        );
        // Never disclose whether the viewer/vehicle was eligible or already counted.
        return { ok: true };
      }),
  };
}
