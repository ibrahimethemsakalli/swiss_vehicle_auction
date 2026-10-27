import { z } from 'zod';
import { hash } from 'bcryptjs';
import { db } from './db';
import { rateLimit } from './rate-limit';
import { acceptanceInput, LegalError, localLegalDraftAllowed } from './legal-policy';
import { activeLegal, lockLegal, recordAcceptance } from './legal';
import { phonePattern } from './account-challenges';
import { emailInput, passwordInput } from './validation-inputs';
export const registrationInput = z
  .object({
    email: emailInput,
    password: passwordInput,
    phone: z.string().regex(phonePattern),
    role: z.enum(['PRIVATE_USER', 'DEALER']),
    language: z.enum(['de', 'fr', 'it', 'en']),
    legal: acceptanceInput.optional(),
    companyName: z.string().trim().max(160).optional(),
    handelsregisterNr: z.string().trim().max(80).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.role === 'DEALER')
      for (const field of ['companyName', 'handelsregisterNr'] as const)
        if (!value[field])
          ctx.addIssue({ code: 'custom', path: [field], message: 'validationRequired' });
  });
export async function register(raw: unknown) {
  const input = registrationInput.parse(raw);
  await rateLimit('registration:global', 30, 3600);
  const { password, legal, ...data } = input;
  if (legal && legal.locale !== data.language) throw new LegalError('LEGAL_LOCALE_MISMATCH', 400);
  const passwordHash = await hash(password, 12);
  const user = await db.$transaction(async (tx) => {
    await lockLegal(tx);
    const current = await activeLegal(tx);
    if (!current && !localLegalDraftAllowed()) throw new LegalError('LEGAL_UNAVAILABLE', 503);
    if (current && !legal) throw new LegalError('LEGAL_ACCEPTANCE_REQUIRED', 428);
    if (!current && legal) throw new LegalError('LEGAL_UNAVAILABLE', 503);
    const created = await tx.user.create({
      data: { ...data, passwordHash },
      select: { id: true },
    });
    if (legal) await recordAcceptance(tx, created.id, legal, 'REGISTRATION');
    return created;
  });
  return user;
}
