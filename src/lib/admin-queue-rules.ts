import { z } from 'zod';
export const queueKinds = [
  'queue',
  'payments',
  'settlements',
  'disputes',
  'identities',
  'audit',
  'retention',
] as const;
export const queueStatuses = {
  retention: ['OPEN', 'NEEDS_INFO', 'KEPT', 'WITHDRAWN', 'RELEASED'],
  queue: ['PENDING_VERIFICATION', 'DRAFT', 'REJECTED', 'ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED'],
  payments: [
    'PENDING_AUTHORIZATION',
    'FAILED',
    'CAPTURED_UNEXPECTED',
    'AUTHORIZED',
    'RELEASE_PENDING',
    'RELEASED',
    'CAPTURE_PENDING',
    'CAPTURED_FEE',
    'CAPTURED_COMPENSATION',
    'EXPIRED',
  ],
  settlements: [
    'AWAITING_CONFIRMATION',
    'DEFAULT_REVIEW',
    'CAPTURE_PENDING',
    'COMPLETED',
    'PAYMENT_FAILED',
    'CANCELLED',
    'DEFAULTED',
  ],
  disputes: ['OPEN', 'ACTION_REQUIRED', 'RESOLVED'],
  identities: ['UNVERIFIED', 'VERIFIED', 'SUSPENDED'],
  audit: [
    'admin.review',
    'admin.identity',
    'settlement.action',
    'dispute.reviewed',
    'admin.assignment',
  ],
} as const;
const date = z.union([z.literal(''), z.iso.date()]).default('');
export const queueQuery = z
  .object({
    kind: z.enum(queueKinds).default('queue'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    q: z.string().trim().max(100).default(''),
    status: z.string().max(40).default(''),
    from: date,
    to: date,
    order: z.enum(['oldest', 'newest']).default('oldest'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.from > v.to)
      ctx.addIssue({ code: 'custom', message: 'DATE_RANGE', path: ['to'] });
    if (v.status && !(queueStatuses[v.kind] as readonly string[]).includes(v.status))
      ctx.addIssue({ code: 'custom', message: 'STATUS', path: ['status'] });
  });
export const assignmentCommand = z
  .object({
    kind: z.enum(['queue', 'payments', 'settlements', 'disputes', 'identities', 'retention']),
    id: z.uuid(),
    action: z.enum(['claim', 'release']),
    version: z.number().int().nonnegative(),
    note: z
      .string()
      .trim()
      .min(5)
      .max(500)
      .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)),
  })
  .strict();
export function queueDates(from: string, to: string) {
  return {
    ...(from ? { gte: new Date(from + 'T00:00:00.000Z') } : {}),
    ...(to ? { lt: new Date(new Date(to + 'T00:00:00.000Z').getTime() + 86400000) } : {}),
  };
}
export const recordQuery = z
  .object({ id: z.uuid().optional(), page: z.coerce.number().int().min(1).max(100000).default(1) })
  .strict();
