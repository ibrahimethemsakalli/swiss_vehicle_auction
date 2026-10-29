import { z } from 'zod';
import { db } from '../../../../lib/db';
import { publicReputation } from '../../../../lib/trust';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const { vehicleId } = await context.params;
    z.uuid().parse(vehicleId);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(new URL(req.url).searchParams.get('page') || 1);
    return Response.json(await publicReputation(db, vehicleId, page), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: 'TRUST_FAILED' },
      { status: error instanceof z.ZodError ? 400 : 503 },
    );
  }
}
