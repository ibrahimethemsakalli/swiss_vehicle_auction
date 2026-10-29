import { z } from 'zod';
import { assertSameOrigin } from './mutation';
import type { RefundDecisions } from './refund-decisions';
import { refundWorkflowInput } from './refund-decisions';
type Service = Pick<RefundDecisions, 'list' | 'read' | 'request' | 'decide'> &
  Partial<Pick<RefundDecisions, 'workflow'>>;
const query = z
  .object({
    id: z.uuid().optional(),
    admin: z.enum(['true', 'false']).default('false'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
const note = z.string().trim().min(20).max(2000);
const command = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('request'),
      captureId: z.string().min(1).max(100),
      requestId: z.uuid(),
      reason: note,
      previousCaseId: z.uuid().optional(),
      reviewBasis: z.enum(['EQUIVALENT', 'NEW_EVIDENCE', 'ERROR']).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('decide'),
      caseId: z.uuid(),
      requestId: z.uuid(),
      expectedVersion: z.number().int().min(0),
      outcome: z.enum(['APPROVE', 'REJECT']),
      reason: note,
    })
    .strict(),
  refundWorkflowInput,
]);
export function refundHandlers(
  service: Service,
  authenticate: () => Promise<string>,
  limit: (userId: string) => Promise<void>,
) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(fn: () => Promise<unknown>) {
    try {
      return Response.json(await fn(), { headers });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const statuses: Record<string, number> = {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        POLICY_CHANGED: 409,
        POLICY_UNCONFIGURED: 409,
        CAPTURE_BINDING_REQUIRED: 409,
        REOPEN_REQUIRED: 409,
        REVIEW_LIMIT: 409,
        DIFFERENT_REVIEWER_REQUIRED: 403,
        EVIDENCE_REQUIRED: 409,
        REVIEW_REQUIRED: 409,
        RATE_LIMITED: 429,
        INVALID_BODY: 400,
        TOO_LARGE: 413,
      };
      const status =
        statuses[code] ?? (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503);
      return Response.json(
        { error: statuses[code] ? code : status === 400 ? 'INVALID_BODY' : 'UNAVAILABLE' },
        { status, headers },
      );
    }
  }
  return {
    GET: (r: Request) =>
      handle(async () => {
        const userId = await authenticate();
        const params = new URL(r.url).searchParams;
        if ([...params.keys()].some((k) => params.getAll(k).length !== 1))
          throw Error('INVALID_BODY');
        const q = query.parse(Object.fromEntries(params));
        return q.id ? service.read(userId, q.id) : service.list(userId, q.admin === 'true', q.page);
      }),
    POST: (r: Request) =>
      handle(async () => {
        assertSameOrigin(r);
        const userId = await authenticate();
        if (!r.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
          throw Error('INVALID_BODY');
        await limit(userId);
        const reader = r.body?.getReader();
        if (!reader) throw Error('INVALID_BODY');
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const c = await reader.read();
            if (c.done) break;
            size += c.value.byteLength;
            if (size > 16000) {
              await reader.cancel();
              throw Error('TOO_LARGE');
            }
            chunks.push(c.value);
          }
        } finally {
          reader.releaseLock();
        }
        const { action, ...body } = command.parse(
          JSON.parse(Buffer.concat(chunks).toString('utf8')),
        );
        if (action === 'request') return service.request(userId, body);
        if (action === 'decide') return service.decide(userId, body);
        if (!service.workflow) throw Error('UNAVAILABLE');
        return service.workflow(userId, { action, ...body });
      }),
  };
}
