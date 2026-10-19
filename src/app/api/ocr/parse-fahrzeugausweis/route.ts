import { createWorker } from 'tesseract.js';
import { requireUser, apiError } from '../../../../lib/http';
import { db } from '../../../../lib/db';
import { parseFahrzeugausweis } from '../../../../lib/ocr';
import { assertSameOrigin } from '../../../../lib/mutation';
export const runtime = 'nodejs';
let busy = false;
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const id = await requireUser();
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (user.suspendedAt || !user.phoneVerifiedAt)
      return Response.json({ error: 'VERIFICATION_REQUIRED' }, { status: 403 });
    if (process.env.OCR_ENABLED !== 'true')
      return Response.json({ error: 'OCR_DISABLED' }, { status: 503 });
    if (busy) return Response.json({ error: 'OCR_BUSY' }, { status: 429 });
    const length = Number(request.headers.get('content-length'));
    if (!length || length > 6_000_000)
      return Response.json({ error: 'UPLOAD_TOO_LARGE' }, { status: 413 });
    const file = (await request.formData()).get('document');
    if (!(file instanceof File) || file.size > 5_000_000)
      return Response.json({ error: 'INVALID_IMAGE' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!jpeg && !png) return Response.json({ error: 'JPEG_OR_PNG_REQUIRED' }, { status: 415 });
    busy = true;
    try {
      const worker = await createWorker('deu+fra+ita+eng');
      try {
        const { data } = await worker.recognize(bytes);
        return Response.json(
          {
            fields: parseFahrzeugausweis(data.text),
            confidence: data.confidence,
            requiresReview: true,
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } finally {
        await worker.terminate();
      }
    } finally {
      busy = false;
    }
  } catch (error) {
    return apiError(error);
  }
}
