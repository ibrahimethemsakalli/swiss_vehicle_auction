import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { readAdminQueue, assignAdminWork } from './admin-queue';
import { assertSameOrigin } from './mutation';
export function adminQueueHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const status = (
        {
          UNAUTHORIZED: 401,
          FORBIDDEN: 403,
          CONFLICT: 409,
          NOT_FOUND: 404,
          INVALID_BODY: 400,
          PARTICIPANT: 403,
          LOCAL_PROXY_DISABLED: 404,
        } as Record<string, number>
      )[code];
      return Response.json(
        { error: status ? code : 'QUEUE_FAILED' },
        {
          status: status ?? (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503),
          headers,
        },
      );
    }
  }
  return {
    GET: (req: Request) =>
      handle(async () =>
        readAdminQueue(db, await authenticate(), Object.fromEntries(new URL(req.url).searchParams)),
      ),
    POST: (req: Request) =>
      handle(async () => {
        assertSameOrigin(req);
        const id = await authenticate();
        const reader = req.body?.getReader();
        if (!reader) throw Error('INVALID_BODY');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const r = await reader.read();
            if (r.done) break;
            size += r.value.length;
            if (size > 4096) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(r.value);
          }
        } finally {
          reader.releaseLock();
        }
        return assignAdminWork(db, id, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
