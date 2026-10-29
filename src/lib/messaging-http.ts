import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { mutateChat, readChat } from './messaging';
import { assertSameOrigin } from './mutation';
export function messagingHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
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
        CHAT_BLOCKED: 409,
        CHAT_CONFLICT: 409,
        CHAT_DATE: 400,
        CHAT_UNAVAILABLE: 409,
        INVALID_BODY: 400,
      };
      const validation = error instanceof z.ZodError || error instanceof SyntaxError;
      return Response.json(
        { error: statuses[code] ? code : validation ? 'CHAT_INVALID' : 'CHAT_FAILED' },
        { status: statuses[code] ?? (validation ? 400 : 503), headers },
      );
    }
  }
  return {
    GET: (req: Request) =>
      handle(async () =>
        readChat(db, await authenticate(), Object.fromEntries(new URL(req.url).searchParams)),
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
        return mutateChat(db, id, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
