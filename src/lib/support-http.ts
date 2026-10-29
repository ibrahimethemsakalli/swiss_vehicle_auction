import { supportRoutingWrite } from './support-routing';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { assertSameOrigin } from './mutation';
import { supportRead, supportWrite } from './support';
export function supportHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const codes: Record<string, number> = {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        CLOSED: 409,
        LIMIT: 429,
        RATE_LIMITED: 429,
        INVALID_BODY: 400,
      };
      return Response.json(
        { error: codes[code] ? code : 'FAILED' },
        {
          status: codes[code] ?? (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503),
          headers,
        },
      );
    }
  }
  return {
    GET: (r: Request) =>
      handle(async () =>
        supportRead(db, await authenticate(), Object.fromEntries(new URL(r.url).searchParams)),
      ),
    POST: (r: Request) =>
      handle(async () => {
        assertSameOrigin(r);
        const id = await authenticate();
        const reader = r.body?.getReader();
        if (!reader) throw Error('INVALID_BODY');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const c = await reader.read();
            if (c.done) break;
            size += c.value.length;
            if (size > 20000) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(c.value);
          }
        } finally {
          reader.releaseLock();
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return ['assign', 'read'].includes(body?.action)
          ? supportRoutingWrite(db, id, body)
          : supportWrite(db, id, body);
      }),
  };
}
