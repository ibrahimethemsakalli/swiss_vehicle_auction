import { z } from 'zod';
import { requireUser, apiError } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { generateRecoveryCodes, resetPassword, changePassword } from '../../../lib/recovery';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('generate'), currentPassword: z.string().max(72) }).strict(),
        z
          .object({
            action: z.literal('reset'),
            email: z.string().max(254),
            code: z.string().max(128),
            password: z.string().max(72),
          })
          .strict(),
        z
          .object({
            action: z.literal('change'),
            currentPassword: z.string().max(72),
            password: z.string().max(72),
          })
          .strict(),
      ])
      .parse(await request.json());
    const { action, ...values } = input;
    if (input.action === 'generate')
      return Response.json(
        { codes: await generateRecoveryCodes(await requireUser(), input.currentPassword) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    if (action === 'reset') await resetPassword(values);
    else await changePassword(await requireUser(), values);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
