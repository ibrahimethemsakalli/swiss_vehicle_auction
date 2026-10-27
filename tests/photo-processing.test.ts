import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizePhoto, PHOTO_LIMITS, filenameFromPhotoUrl } from '../src/lib/photo-processing';
import { photoFromRequest } from '../src/lib/photo-request';

test('JPEG metadata is removed and EXIF orientation applied to pixels', async () => {
  const source = await sharp({
    create: { width: 24, height: 12, channels: 3, background: '#ff0000' },
  })
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Artist: 'PRIVATE GPS OWNER' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '47/1 0/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '8/1 0/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  const clean = await normalizePhoto(source);
  const meta = await sharp(clean.bytes).metadata();
  assert.equal(clean.width, 12);
  assert.equal(clean.height, 24);
  for (const key of ['exif', 'xmp', 'iptc', 'icc', 'orientation'] as const)
    assert.equal(meta[key], undefined, key);
  assert.equal(meta.format, 'jpeg');
  assert.ok(!clean.bytes.includes(Buffer.from('PRIVATE GPS OWNER')));
});
test('PNG is decoded, flattened and re-encoded without embedded metadata', async () => {
  const png = await sharp({
    create: { width: 4, height: 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .withMetadata()
    .png()
    .toBuffer();
  const clean = await normalizePhoto(png);
  const meta = await sharp(clean.bytes).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.hasAlpha, false);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  const pixel = await sharp(clean.bytes).raw().toBuffer();
  assert.ok(pixel.every((v) => v >= 250));
});
test('large images resize to the output limit without enlarging small images', async () => {
  const source = await sharp({
    create: { width: 5000, height: 10, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  const clean = await normalizePhoto(source);
  assert.equal(clean.width, 4096);
  assert.ok(clean.height <= 10);
});
test('spoofed, truncated, unsupported and excessive images are rejected', async () => {
  for (const bytes of [
    Buffer.from('<svg></svg>'),
    Buffer.from([255, 216, 255, 0, 0]),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from('GIF89a'),
  ])
    await assert.rejects(() => normalizePhoto(bytes), /INVALID_IMAGE/);
  await assert.rejects(
    () => normalizePhoto(Buffer.alloc(PHOTO_LIMITS.inputBytes + 1)),
    /PHOTO_TOO_LARGE/,
  );
  const huge = await sharp({
    create: { width: 7000, height: 6000, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  await assert.rejects(() => normalizePhoto(huge), /INVALID_IMAGE/);
});
test('only canonical local UUID photo paths can be attached', () => {
  const name = '12345678-1234-1234-1234-123456789012.jpg';
  assert.equal(filenameFromPhotoUrl('/api/uploads/' + name), name);
  for (const value of [
    'https://example.com/car.jpg',
    '/api/uploads/../secret.jpg',
    '/api/uploads/' + name + '?x=1',
    '/samples/car.jpg',
    '/api/uploads/------------------------------------.jpg',
  ])
    assert.throws(() => filenameFromPhotoUrl(value), /PHOTO_OWNERSHIP_REQUIRED/);
});
test('multipart reads are bounded even when Content-Length lies', async () => {
  const body = Buffer.alloc(PHOTO_LIMITS.requestBytes + 1);
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '10' },
    body,
  });
  await assert.rejects(() => photoFromRequest(request), /PHOTO_TOO_LARGE/);
  await assert.rejects(
    () =>
      photoFromRequest(
        new Request('http://localhost/upload', {
          method: 'POST',
          headers: { 'content-type': 'text/plain', 'content-length': '3' },
          body: 'bad',
        }),
      ),
    /INVALID_IMAGE/,
  );
});
