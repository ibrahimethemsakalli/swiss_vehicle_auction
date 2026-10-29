import type { PrismaClient } from '../generated/prisma/client';
import { z } from 'zod';
import { assertSameOrigin } from './mutation';
import { changeDealer, readDealerWorkspace, publicDealer } from './dealers';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
async function handle(work: () => Promise<unknown>) {
  try {
    return Response.json(await work(), { headers });
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    const errors: Record<string, number> = {
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      VERIFICATION_REQUIRED: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      PREVIEW_CHANGED: 409,
      DRAFT_QUOTA: 409,
      CSV_ERRORS: 400,
      CSV_LIMIT: 400,
      CSV_FORMAT: 400,
      INVALID_BODY: 400,
    };
    const status =
      errors[code] ?? (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503);
    return Response.json({ error: errors[code] ? code : 'REQUEST_REJECTED' }, { status, headers });
  }
}
export function dealerHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  return {
    GET: () => handle(async () => readDealerWorkspace(db, await authenticate())),
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
            const p = await reader.read();
            if (p.done) break;
            size += p.value.length;
            if (size > 600000) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(p.value);
          }
        } finally {
          reader.releaseLock();
        }
        return changeDealer(db, id, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
export const publicDealerResponse = (db: PrismaClient, id: string, page: number) =>
  handle(() => publicDealer(db, id, page));
