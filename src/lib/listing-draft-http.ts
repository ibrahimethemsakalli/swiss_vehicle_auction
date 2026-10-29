import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { mutateDraft, readDrafts } from './listing-drafts';
import { assertSameOrigin } from './mutation';
import { publicValidation } from './validation-errors';
export function draftHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const known: Record<string, number> = {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        VERIFICATION_REQUIRED: 403,
        DRAFT_CONFLICT: 409,
        DRAFT_LOCKED: 409,
        DRAFT_QUOTA: 429,
        DRAFT_PRICE: 400,
        PHOTO_OWNERSHIP_REQUIRED: 400,
        INVALID_BODY: 400,
      };
      return Response.json(
        {
          error: known[code] ? code : 'DRAFT_FAILED',
          ...(e instanceof z.ZodError ? { validation: publicValidation(e) } : {}),
        },
        {
          status: known[code] ?? (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503),
          headers,
        },
      );
    }
  }
  return {
    GET: (r: Request) =>
      handle(async () =>
        readDrafts(db, await authenticate(), Object.fromEntries(new URL(r.url).searchParams)),
      ),
    POST: (r: Request) =>
      handle(async () => {
        assertSameOrigin(r);
        const id = await authenticate();
        const reader = r.body?.getReader();
        if (!reader) throw Error('INVALID_BODY');
        const chunks: Uint8Array[] = [];
        let n = 0;
        try {
          while (true) {
            const c = await reader.read();
            if (c.done) break;
            n += c.value.length;
            if (n > 48000) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(c.value);
          }
        } finally {
          reader.releaseLock();
        }
        return mutateDraft(db, id, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
