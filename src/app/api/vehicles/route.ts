import { requireUser, apiError } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { createVehicle } from '../../../lib/vehicles';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await createVehicle(await requireUser(), await request.json()), {
      status: 201,
    });
  } catch (e) {
    return apiError(e);
  }
}
