import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { readHandover, mutateHandover } from './handover';
import { assertSameOrigin } from './mutation';
export function handoverHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const codes: Record<string, number> = {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        VERIFICATION_REQUIRED: 403,
        CONFLICT: 409,
        HANDOVER_LOCKED: 409,
        DISPUTE_OPEN: 409,
        HANDOVER_LIMIT: 409,
        HANDOVER_INCOMPLETE: 400,
        RATE_LIMITED: 429,
        INVALID_BODY: 400,
      };
      return Response.json(
        { error: codes[code] ? code : 'HANDOVER_FAILED' },
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
        readHandover(db, await authenticate(), Object.fromEntries(new URL(r.url).searchParams)),
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
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 12000) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        return mutateHandover(db, id, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
