import { requireUser } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { uploadPhoto } from '../../../lib/media';
import { MediaError } from '../../../lib/photo-processing';
import { photoFromRequest } from '../../../lib/photo-request';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ownerId = await requireUser();
    return Response.json(await uploadPhoto(ownerId, await photoFromRequest(request)), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof MediaError)
      return Response.json({ error: error.code }, { status: error.status });
    return Response.json(
      { error: 'UPLOAD_FAILED' },
      {
        status:
          error instanceof Error && error.message === 'UNAUTHORIZED'
            ? 401
            : error instanceof Error && error.message === 'FORBIDDEN'
              ? 403
              : 503,
      },
    );
  }
}
