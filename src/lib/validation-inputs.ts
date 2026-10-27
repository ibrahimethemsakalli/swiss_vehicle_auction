import { z } from 'zod';

export const emailInput = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const passwordInput = z
  .string()
  .min(12)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, { error: 'validationPasswordBytes' });
export const newPasswordInput = z.strictObject({ password: passwordInput });
// Browser date fields, ISO timestamps and trusted Date fixtures; no null/boolean epoch coercion.
export const pastDateInput = z
  .union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })], { error: 'validationDate' })
  .pipe(z.coerce.date())
  .refine((value) => value <= new Date(), { error: 'validationPastDate' });
