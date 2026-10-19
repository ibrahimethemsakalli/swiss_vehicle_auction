import { requireUser, apiError } from '../../../lib/http';
import { placeBid } from '../../../lib/bidding';
import { assertSameOrigin } from '../../../lib/mutation';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await placeBid(await requireUser(), await request.json()));
  } catch (error) {
    return apiError(error);
  }
}
