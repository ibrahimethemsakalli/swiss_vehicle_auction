import { z } from 'zod';
export const correctionKeys = [
  'PHOTOS',
  'DOCUMENT',
  'VEHICLE_DATA',
  'PRICE',
  'DESCRIPTION',
] as const;
export const reviewFeedback = z
  .object({
    action: z.enum(['approve', 'reject']),
    note: z.string().trim().min(5).max(2000),
    corrections: z.array(z.enum(correctionKeys)).max(5).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'reject' && !v.corrections.length)
      ctx.addIssue({ code: 'custom', path: ['corrections'], message: 'validationRequired' });
  });
