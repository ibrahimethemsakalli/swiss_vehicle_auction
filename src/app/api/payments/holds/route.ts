import { z } from 'zod';
import { requireUser, apiError } from '../../../../lib/http';
import { assertSameOrigin } from '../../../../lib/mutation';
import { createHold, syncHold } from '../../../../lib/payments';
import { localPaymentsEnabled, assertLocalRequest } from '../../../../lib/local-payment';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const id = await requireUser();
    const input = z
      .discriminatedUnion('action', [
        z
          .object({
            action: z.literal('create'),
            vehicleId: z.uuid(),
            replacementBidId: z.uuid().optional(),
          })
          .strict(),
        z.object({ action: z.literal('confirm'), holdId: z.uuid() }).strict(),
      ])
      .parse(await request.json());
    if (input.action === 'confirm') {
      const hold = await syncHold(input.holdId, id);
      return Response.json({ holdId: hold.id, status: hold.status, expiresAt: hold.expiresAt });
    }
    if (localPaymentsEnabled()) {
      assertLocalRequest(request);
      const created = await createHold(id, input.vehicleId, input.replacementBidId);
      const hold = await syncHold(created.holdId, id);
      return Response.json(
        { holdId: hold.id, localTest: true, status: hold.status },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) throw new Error('PROVIDER_UNAVAILABLE');
    return Response.json(await createHold(id, input.vehicleId, input.replacementBidId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return apiError(e);
  }
}
