import { z } from 'zod';
import { db } from '../../../lib/db';
import { requireUser, apiError } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { sendSms, checkSms } from '../../../lib/sms';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const id = await requireUser();
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (user.suspendedAt) throw new Error('FORBIDDEN');
    return Response.json(
      {
        phone: `+41 ••• •• ${user.phone.slice(-4)}`,
        phoneVerified: !!user.phoneVerifiedAt,
        identityVerified: user.isIdentityVerified,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const id = await requireUser();
    const input = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('send') }).strict(),
        z.object({ action: z.literal('check'), code: z.string().regex(/^\d{4,10}$/) }).strict(),
      ])
      .parse(await request.json());
    if (input.action === 'send') await sendSms(id);
    else await checkSms(id, input.code);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
