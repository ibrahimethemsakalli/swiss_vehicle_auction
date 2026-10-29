import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { assertSameOrigin } from './mutation';
import { readSearches, changeSearches } from './saved-searches';
export function savedSearchHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const known: Record<string, number> = {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        SEARCH_LIMIT: 409,
        SEARCH_NAME: 409,
        INVALID_BODY: 400,
      };
      return Response.json(
        { error: known[code] ? code : 'SEARCH_FAILED' },
        {
          status: known[code] ?? (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503),
          headers,
        },
      );
    }
  }
  return {
    GET: () => handle(async () => readSearches(db, await authenticate())),
    POST: (r: Request) =>
      handle(async () => {
        assertSameOrigin(r);
        const userId = await authenticate();
        const reader = r.body?.getReader();
        if (!reader) throw Error('INVALID_BODY');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 24000) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        return changeSearches(db, userId, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
