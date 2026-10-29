import { db } from '../../../../lib/db';
import { publicDealerResponse } from '../../../../lib/dealer-http';
export const dynamic = 'force-dynamic';
export async function GET(r: Request, { params }: { params: Promise<{ id: string }> }) {
  return publicDealerResponse(
    db,
    (await params).id,
    Number(new URL(r.url).searchParams.get('page') ?? 1),
  );
}
