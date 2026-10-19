import { register } from '../../../lib/registration';
import { assertSameOrigin } from '../../../lib/mutation';
import { apiError } from '../../../lib/http';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await register(await request.json());
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
