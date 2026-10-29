import { z } from 'zod';
const id = z.uuid();
const note = z
  .string()
  .trim()
  .min(5)
  .max(1000)
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));
export const reportCategories = [
  'MISLEADING',
  'FRAUD',
  'PERSONAL_DATA',
  'PROHIBITED',
  'OTHER',
] as const;
export const trustCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('report'),
      vehicleId: id,
      category: z.enum(reportCategories),
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal('rate'),
      settlementId: id,
      rating: z.number().int().min(1).max(5),
      note,
    })
    .strict(),
  z.object({ action: z.literal('reply'), reviewId: id, note }).strict(),
  z.object({ action: z.literal('appeal'), reviewId: id, note }).strict(),
  z
    .object({
      action: z.literal('decideReport'),
      id,
      decision: z.enum(['DISMISSED', 'WARNING', 'ESCALATED']),
      note,
    })
    .strict(),
  z
    .object({ action: z.literal('decideAppeal'), id, decision: z.enum(['KEEP', 'HIDE']), note })
    .strict(),
]);
export const trustQuery = z
  .object({
    view: z
      .enum(['deals', 'reviews', 'reports', 'warnings', 'adminReports', 'adminAppeals'])
      .default('deals'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    status: z.enum(['OPEN', 'CLOSED']).default('OPEN'),
  })
  .strict();
