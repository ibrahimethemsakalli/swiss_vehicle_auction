import { z } from 'zod';
export const handoverChecks = ['inspection', 'damage', 'keys', 'documents', 'vehicle'] as const;
export const handoverValues = ['UNKNOWN', 'YES', 'NO'] as const;
const answer = z.enum(handoverValues);
export const handoverPayload = z
  .object({
    date: z.union([z.literal(''), z.iso.date()]),
    mileage: z.number().int().min(0).max(2000000).nullable(),
    keyCount: z.number().int().min(0).max(20).nullable(),
    inspection: answer,
    damage: answer,
    keys: answer,
    documents: answer,
    vehicle: answer,
    note: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)),
  })
  .strict();
export type HandoverPayload = z.infer<typeof handoverPayload>;
export const blankHandover: HandoverPayload = {
  date: '',
  mileage: null,
  keyCount: null,
  inspection: 'UNKNOWN',
  damage: 'UNKNOWN',
  keys: 'UNKNOWN',
  documents: 'UNKNOWN',
  vehicle: 'UNKNOWN',
  note: '',
};
const base = { settlementId: z.uuid(), version: z.number().int().min(0).max(100) };
export const handoverCommand = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('save'), payload: handoverPayload }).strict(),
  z.object({ ...base, action: z.literal('acknowledge'), confirmed: z.literal(true) }).strict(),
]);
export const handoverQuery = z
  .object({ settlementId: z.uuid(), page: z.coerce.number().int().min(1).max(1000).default(1) })
  .strict();
export function swissCalendarDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('-');
}
export function readyForAcknowledgement(payload: HandoverPayload, saleCreatedAt: Date, now: Date) {
  return (
    !!payload.date &&
    payload.date >= swissCalendarDate(saleCreatedAt) &&
    payload.date <= swissCalendarDate(now) &&
    handoverChecks.every((k) => payload[k] !== 'UNKNOWN') &&
    (!handoverChecks.some((k) => payload[k] === 'NO') || payload.note.length >= 10)
  );
}
