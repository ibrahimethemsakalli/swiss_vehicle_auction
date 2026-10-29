import { z } from 'zod';
import { pastDateInput } from './validation-inputs';

export const mfkStates = ['DATED', 'NEVER', 'UNKNOWN'] as const;
export const inspectionFields = {
  mfkStatus: z.enum(mfkStates).default('DATED'),
  mfkDate: z.preprocess((v) => (v === '' || v === undefined ? null : v), pastDateInput.nullable()),
};
export function inspectMfk(v: { mfkStatus: string; mfkDate: Date | null }, ctx: z.RefinementCtx) {
  if ((v.mfkStatus === 'DATED') !== (v.mfkDate !== null))
    ctx.addIssue({ code: 'custom', path: ['mfkDate'], message: 'validationInvalid' });
}
export const inspectionInput = z.object(inspectionFields).superRefine(inspectMfk);
