import { z } from 'zod';
import { emailInput } from '../../../lib/validation-inputs';
import { requireUser, apiError } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { verifyEmail, resetByEmail, requestAccountMessage } from '../../../lib/account-challenges';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = z
      .object({
        action: z.enum(['requestEmail', 'requestReset', 'requestAdmin', 'verifyEmail', 'reset']),
        email: emailInput.optional(),
        password: z.string().max(72).optional(),
        token: z.string().max(128).optional(),
      })
      .strict()
      .parse(await request.json());
    if (input.action.startsWith('request')) {
      if (!input.email) throw new Error('INVALID_CREDENTIALS');
      await requestAccountMessage(
        input.email,
        input.action === 'requestAdmin'
          ? 'ADMIN'
          : input.action === 'requestReset'
            ? 'RESET'
            : 'EMAIL',
        input.password,
      );
    } else if (input.action === 'verifyEmail') {
      const id = await requireUser();
      await verifyEmail(id, input.token ?? '');
    } else {
      await resetByEmail(input.email ?? '', input.token ?? '', input.password ?? '');
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
