import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { mutateTrust, readTrust } from './trust';
import { assertSameOrigin } from './mutation';
export function trustHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const statuses: Record<string, number> = {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        VERIFICATION_REQUIRED: 403,
        RATE_LIMITED: 429,
        TRUST_DUPLICATE: 409,
        TRUST_INELIGIBLE: 403,
        TRUST_SELF_REVIEW: 403,
        TRUST_CONFLICT: 409,
        TRUST_DATE: 400,
        TRUST_UNAVAILABLE: 409,
        INVALID_BODY: 400,
      };
      const validation = error instanceof z.ZodError || error instanceof SyntaxError;
      return Response.json(
        { error: statuses[code] ? code : validation ? 'TRUST_INVALID' : 'TRUST_FAILED' },
        { status: statuses[code] ?? (validation ? 400 : 503), headers },
      );
    }
  }
  return {
    GET: (req: Request) =>
      handle(async () =>
        readTrust(db, await authenticate(), Object.fromEntries(new URL(req.url).searchParams)),
      ),
    POST: (req: Request) =>
      handle(async () => {
        assertSameOrigin(req);
        const id = await authenticate();
        if (Number(req.headers.get('content-length') ?? 0) > 12000) throw Error('INVALID_BODY');
        const reader = req.body?.getReader();
        if (!reader) throw Error('INVALID_BODY');
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const r = await reader.read();
            if (r.done) break;
            total += r.value.length;
            if (total > 12000) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(r.value);
          }
        } finally {
          reader.releaseLock();
        }
        return mutateTrust(db, id, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
