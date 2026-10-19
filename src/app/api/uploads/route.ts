import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { uploadDirectory } from '../../../lib/uploads';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const id = await requireUser();
    const user = await db.user.findUnique({ where: { id } });
    if (!user || user.suspendedAt || !user.isIdentityVerified || !user.phoneVerifiedAt)
      return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const length = Number(request.headers.get('content-length'));
    if (!length || length > 5_100_000)
      return Response.json({ error: 'TOO_LARGE' }, { status: 413 });
    const file = (await request.formData()).get('photo');
    if (!(file instanceof File) || file.size > 5_000_000)
      return Response.json({ error: 'INVALID_IMAGE' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!jpg && !png) return Response.json({ error: 'INVALID_IMAGE' }, { status: 415 });
    const directory = uploadDirectory();
    await mkdir(directory, { recursive: true });
    const filename = `${randomUUID()}.${jpg ? 'jpg' : 'png'}`;
    await writeFile(path.join(directory, filename), bytes, { flag: 'wx' });
    return Response.json({ url: `/api/uploads/${filename}` }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: 'UPLOAD_FAILED' },
      { status: error instanceof Error && error.message === 'UNAUTHORIZED' ? 401 : 503 },
    );
  }
}
