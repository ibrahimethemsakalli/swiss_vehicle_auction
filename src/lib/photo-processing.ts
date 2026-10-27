import sharp from 'sharp';

export const PHOTO_LIMITS = {
  inputBytes: 5_000_000,
  requestBytes: 5_100_000,
  pixels: 40_000_000,
  dimension: 12_000,
  outputDimension: 4096,
  pendingCount: 24,
  pendingBytes: 60_000_000,
  totalCount: 120,
  totalBytes: 300_000_000,
  orphanAgeMs: 24 * 60 * 60 * 1000,
  stagingAgeMs: 60 * 60 * 1000,
} as const;

export class MediaError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

// Decode pixels rather than copying metadata segments. Sharp strips EXIF, XMP,
// IPTC and ICC by default; never call withMetadata/keepMetadata on this pipeline.
export async function normalizePhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > PHOTO_LIMITS.inputBytes)
    throw new MediaError('PHOTO_TOO_LARGE', 413);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!jpeg && !png) throw new MediaError('INVALID_IMAGE', 415);
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: PHOTO_LIMITS.pixels });
    const info = await image.metadata();
    if (
      !['jpeg', 'png'].includes(info.format ?? '') ||
      !info.width ||
      !info.height ||
      info.width > PHOTO_LIMITS.dimension ||
      info.height > PHOTO_LIMITS.dimension ||
      (info.pages ?? 1) !== 1
    )
      throw Error('Invalid dimensions or animation');
    const result = await image
      .timeout({ seconds: 10 })
      .rotate()
      .resize({
        width: PHOTO_LIMITS.outputDimension,
        height: PHOTO_LIMITS.outputDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > PHOTO_LIMITS.inputBytes) throw new MediaError('PHOTO_TOO_LARGE', 413);
    return { bytes: result.data, width: result.info.width, height: result.info.height };
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError('INVALID_IMAGE', 415);
  }
}

export const mediaFilenamePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;
export function filenameFromPhotoUrl(url: string) {
  const filename = url.startsWith('/api/uploads/') ? url.slice('/api/uploads/'.length) : '';
  if (!mediaFilenamePattern.test(filename)) throw new MediaError('PHOTO_OWNERSHIP_REQUIRED', 400);
  return filename;
}
