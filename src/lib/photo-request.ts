import { MediaError, PHOTO_LIMITS } from './photo-processing';

export async function photoFromRequest(request: Request) {
  const length = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(length) || length <= 0 || length > PHOTO_LIMITS.requestBytes)
    throw new MediaError('PHOTO_TOO_LARGE', 413);
  if (!request.body) throw new MediaError('INVALID_IMAGE', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > PHOTO_LIMITS.requestBytes) {
        await reader.cancel();
        throw new MediaError('PHOTO_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: Buffer.concat(chunks),
    }).formData();
  } catch {
    throw new MediaError('INVALID_IMAGE', 400);
  }
  const file = form.get('photo');
  if (!(file instanceof File) || form.getAll('photo').length !== 1)
    throw new MediaError('INVALID_IMAGE', 400);
  if (file.size > PHOTO_LIMITS.inputBytes) throw new MediaError('PHOTO_TOO_LARGE', 413);
  return Buffer.from(await file.arrayBuffer());
}
