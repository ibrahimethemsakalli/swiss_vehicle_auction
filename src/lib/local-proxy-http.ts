import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { assertLocalProxyEnvironment } from './local-proxy-engine';
import { assertSameOrigin } from './mutation';
import { changeProxyWorkspace, readProxyWorkspace } from './local-proxy-workspace';
export function localProxyHandlers(
  db: PrismaClient,
  authenticate: () => Promise<string>,
  databaseUrl: string,
) {
  const headers = {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  const statuses: Record<string, number> = {
    LOCAL_PROXY_DISABLED: 404,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    SELF_BID: 403,
    INVALID_BODY: 400,
    INVALID_INPUT: 400,
    BID_TOO_LOW: 409,
    LIMIT_NOT_HIGHER: 409,
    AUCTION_ENDED: 409,
    AUCTION_NOT_STARTED: 409,
    AUCTION_NOT_DUE: 409,
    SALE_NOT_READY: 409,
    SALE_COMPLETED: 409,
    REFUND_NOT_READY: 409,
    REFUND_EXISTS: 409,
    REFUND_DECIDED: 409,
    REFUND_REASON_INVALID: 400,
    LEDGER_TOO_LARGE: 409,
    LEADER_HOLD_EXPIRED: 409,
    REQUEST_CONFLICT: 409,
    LOCAL_PROXY_QUOTA: 409,
    FIXTURE_ACCOUNTS_REQUIRED: 409,
  };
  async function handle(r: Request, write: boolean) {
    try {
      assertLocalProxyEnvironment(databaseUrl);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(r.url).hostname) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(
          new URL(process.env.NEXTAUTH_URL ?? '').hostname,
        )
      )
        throw Error('LOCAL_PROXY_DISABLED');
      if (write) assertSameOrigin(r);
      const id = await authenticate();
      if (!write)
        return Response.json(
          await readProxyWorkspace(db, id, Object.fromEntries(new URL(r.url).searchParams)),
          { headers },
        );
      if (!r.headers.get('content-type')?.startsWith('application/json'))
        throw Error('INVALID_BODY');
      const reader = r.body?.getReader();
      if (!reader) throw Error('INVALID_BODY');
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const p = await reader.read();
          if (p.done) break;
          bytes += p.value.length;
          if (bytes > 2048) {
            await reader.cancel();
            throw Error('INVALID_BODY');
          }
          chunks.push(p.value);
        }
      } finally {
        reader.releaseLock();
      }
      return Response.json(
        await changeProxyWorkspace(
          db,
          id,
          JSON.parse(Buffer.concat(chunks).toString('utf8')),
          databaseUrl,
        ),
        { headers },
      );
    } catch (e) {
      const code =
        e instanceof z.ZodError && e.issues.some((issue) => issue.path.includes('reason'))
          ? 'REFUND_REASON_INVALID'
          : e instanceof Error
            ? e.message
            : '';
      const status =
        statuses[code] ?? (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503);
      return Response.json(
        { error: statuses[code] ? code : status === 400 ? 'INVALID_INPUT' : 'LOCAL_PROXY_FAILED' },
        { status, headers },
      );
    }
  }
  return { GET: (r: Request) => handle(r, false), POST: (r: Request) => handle(r, true) };
}
