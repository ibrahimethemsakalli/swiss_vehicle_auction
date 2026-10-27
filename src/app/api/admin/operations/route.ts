import { db } from '../../../../lib/db';
import { requireUser, apiError } from '../../../../lib/http';
import { operationsSnapshot } from '../../../../lib/operations';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await db.user.findUnique({ where: { id: await requireUser() } });
    if (!user || user.role !== 'ADMIN' || user.suspendedAt || user.isSample)
      throw new Error('FORBIDDEN');
    return Response.json(await operationsSnapshot(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
