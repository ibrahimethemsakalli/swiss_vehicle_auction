import type { PrismaClient } from '../generated/prisma/client';
import { listNotifications, readNotification } from './notifications';
import { assertSameOrigin } from './mutation';
import { z } from 'zod';

export function notificationHandlers(client: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const status =
        code === 'UNAUTHORIZED'
          ? 401
          : code === 'FORBIDDEN'
            ? 403
            : error instanceof z.ZodError || error instanceof SyntaxError || code === 'INVALID_BODY'
              ? 400
              : 503;
      return Response.json(
        {
          error:
            status === 401
              ? 'UNAUTHORIZED'
              : status === 403
                ? 'FORBIDDEN'
                : 'NOTIFICATION_REQUEST_FAILED',
        },
        { status, headers },
      );
    }
  }
  return {
    GET: (request: Request) =>
      handle(async () =>
        listNotifications(
          client,
          await authenticate(),
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      ),
    PATCH: (request: Request) =>
      handle(async () => {
        assertSameOrigin(request);
        const userId = await authenticate();
        if (Number(request.headers.get('content-length') ?? 0) > 1024)
          throw new Error('INVALID_BODY');
        const reader = request.body?.getReader();
        if (!reader) throw new Error('INVALID_BODY');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 1024) {
              await reader.cancel();
              throw new Error('INVALID_BODY');
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        return readNotification(client, userId, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
