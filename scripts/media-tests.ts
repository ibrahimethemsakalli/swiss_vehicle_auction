import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  unlink,
  utimes,
  lstat,
  readdir,
  rmdir,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { encode } from 'next-auth/jwt';

async function main() {
  const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '');
  if (
    !process.env.TEST_DATABASE_URL &&
    ['localhost', '127.0.0.1'].includes(database.hostname) &&
    database.pathname === '/autoveri'
  )
    database.pathname = '/autoveri_test';
  if (!database.pathname.endsWith('_test')) throw Error('Isolated _test database required');
  process.env.DATABASE_URL = database.toString();
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, stdio: 'pipe' },
  );
  if (migrated.status !== 0) throw Error('Test migrations failed');
  const { db } = await import('../src/lib/db');
  const { uploadPhoto, photoAccess, cleanupMedia } = await import('../src/lib/media');
  const { createVehicle, vehicleInput } = await import('../src/lib/vehicles');
  const { PHOTO_LIMITS: limits } = await import('../src/lib/photo-processing');
  const directory = await mkdtemp(path.resolve('.local/media-test-'));
  process.env.UPLOAD_DIR = directory;
  const run = randomUUID();
  const users: string[] = [],
    vehicles: string[] = [];
  let server: ChildProcess | undefined;
  let groups = 0;
  const photo = await sharp({
    create: { width: 30, height: 20, channels: 3, background: '#abcdef' },
  })
    .withMetadata()
    .png()
    .toBuffer();
  const fileExists = async (name: string) =>
    lstat(path.join(directory, name))
      .then(() => true)
      .catch(() => false);
  const nameOf = (url: string) => url.split('/').at(-1)!;
  const metadataFixture = async (
    ownerId: string,
    count: number,
    bytes = 100,
    vehicleId: string | null = null,
  ) => {
    const records = Array.from({ length: count }, () => ({
      id: randomUUID(),
      filename: `${randomUUID()}.jpg`,
      ownerId,
      bytes,
      status: 'READY',
      vehicleId,
    }));
    await db.mediaAsset.createMany({ data: records });
    return records;
  };
  try {
    for (const role of ['PRIVATE_USER', 'PRIVATE_USER', 'ADMIN'] as const) {
      const id = randomUUID();
      users.push(id);
      await db.user.create({
        data: {
          id,
          email: `${id}@media.test`,
          phone: `MEDIA-${id}`,
          passwordHash: 'not-a-login-hash',
          role,
          isIdentityVerified: true,
          phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(),
        },
      });
    }
    const [owner, stranger, admin] = users;
    const first = await uploadPhoto(owner, photo);
    const filename = nameOf(first.url);
    assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { filename } })).ownerId, owner);
    assert.equal(
      (await sharp(await readFile(path.join(directory, filename))).metadata()).exif,
      undefined,
    );
    assert.equal(await photoAccess(filename), null);
    assert.equal(await photoAccess(filename, stranger), null);
    assert.equal(await photoAccess(filename, owner), 'private');
    groups++;
    console.log('PASS owned, sanitized, private pending media');

    const input = {
      stammnummer: '123456789',
      vinChassis:
        'WBA' +
        run
          .replace(/[^0-9]/g, '')
          .padEnd(14, '1')
          .slice(0, 14),
      firstRegistration: '2020-01-01',
      make: 'MEDIA TEST',
      model: 'Alpine',
      mileage: 1000,
      canton: 'ZH',
      mfkDate: '2025-01-01',
      serviceHistory: 'FULL',
      tireCondition: 'Test',
      description: `MEDIA TEST ${run}`,
      images: [first.url],
      listingType: 'AUCTION_7_DAYS',
      startPrice: '1000',
    };
    assert.equal(
      vehicleInput.safeParse({ ...input, images: ['https://example.test/stolen.jpg'] }).success,
      false,
    );
    assert.equal(
      vehicleInput.safeParse({ ...input, images: [first.url, first.url] }).success,
      false,
    );
    await assert.rejects(() => createVehicle(stranger, input), /PHOTO_OWNERSHIP_REQUIRED/);
    const attached = await createVehicle(owner, input);
    vehicles.push(attached.id);
    assert.equal(
      (await db.mediaAsset.findUniqueOrThrow({ where: { filename } })).vehicleId,
      attached.id,
    );
    assert.equal(await photoAccess(filename, admin), 'private');
    await assert.rejects(
      () => createVehicle(owner, { ...input, vinChassis: 'WBA22222222222222' }),
      /PHOTO_OWNERSHIP_REQUIRED/,
    );
    await db.vehicle.update({ where: { id: attached.id }, data: { status: 'ACTIVE' } });
    assert.equal(await photoAccess(filename), 'public');
    groups++;
    console.log('PASS atomic attachment, foreign/external/duplicate/reused photo rejection');

    const quota = await metadataFixture(owner, limits.pendingCount - 1);
    const race = await Promise.allSettled([uploadPhoto(owner, photo), uploadPhoto(owner, photo)]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(
      race.some((r) => r.status === 'rejected' && /PHOTO_QUOTA_EXCEEDED/.test(String(r.reason))),
    );
    await db.mediaAsset.deleteMany({ where: { id: { in: quota.map((r) => r.id) } } });
    const countBefore = await db.mediaAsset.count({ where: { ownerId: owner } });
    await assert.rejects(() => uploadPhoto(owner, Buffer.from([255, 216, 255])), /INVALID_IMAGE/);
    assert.equal(await db.mediaAsset.count({ where: { ownerId: owner } }), countBefore);
    groups++;
    console.log('PASS concurrent count quota and failed-decode rollback');

    const blocked = path.join(directory, 'blocked-storage');
    await writeFile(blocked, 'not a directory');
    process.env.UPLOAD_DIR = blocked;
    try {
      await assert.rejects(() => uploadPhoto(owner, photo));
    } finally {
      process.env.UPLOAD_DIR = directory;
    }
    assert.equal(await db.mediaAsset.count({ where: { ownerId: owner } }), countBefore);
    groups++;
    console.log('PASS filesystem write failure releases quota reservation');

    const pendingBytes = await metadataFixture(stranger, 1, limits.pendingBytes);
    await assert.rejects(() => uploadPhoto(stranger, photo), /PHOTO_QUOTA_EXCEEDED/);
    await db.mediaAsset.deleteMany({ where: { id: { in: pendingBytes.map((r) => r.id) } } });
    const totalBytes = await metadataFixture(owner, 1, limits.totalBytes, attached.id);
    await assert.rejects(() => uploadPhoto(owner, photo), /PHOTO_QUOTA_EXCEEDED/);
    await db.mediaAsset.deleteMany({ where: { id: { in: totalBytes.map((r) => r.id) } } });
    const totalCount = await metadataFixture(owner, limits.totalCount, 100, attached.id);
    await assert.rejects(() => uploadPhoto(owner, photo), /PHOTO_QUOTA_EXCEEDED/);
    await db.mediaAsset.deleteMany({ where: { id: { in: totalCount.map((r) => r.id) } } });
    groups++;
    console.log('PASS pending-byte, total-byte and total-count quotas');

    const orphan = await uploadPhoto(owner, photo),
      fresh = await uploadPhoto(owner, photo);
    const staleDate = new Date(Date.now() - limits.orphanAgeMs - 10000);
    await db.mediaAsset.updateMany({
      where: { filename: { in: [filename, nameOf(orphan.url)] } },
      data: { createdAt: staleDate },
    });
    await assert.rejects(
      () =>
        createVehicle(owner, { ...input, vinChassis: 'WBA33333333333333', images: [orphan.url] }),
      /PHOTO_OWNERSHIP_REQUIRED/,
    );
    const stale = await metadataFixture(owner, 1);
    await db.mediaAsset.update({
      where: { id: stale[0].id },
      data: { status: 'STAGING', createdAt: new Date(Date.now() - limits.stagingAgeMs - 10000) },
    });
    const retry = await metadataFixture(owner, 1);
    await db.mediaAsset.update({ where: { id: retry[0].id }, data: { status: 'DELETING' } });
    const unregistered = `${randomUUID()}.jpg`,
      legacy = `${randomUUID()}.png`;
    for (const name of [unregistered, legacy]) {
      await writeFile(path.join(directory, name), photo);
      await utimes(path.join(directory, name), staleDate, staleDate);
    }
    await db.vehicle.update({
      where: { id: attached.id },
      data: { images: [first.url, `/api/uploads/${legacy}`] },
    });
    await writeFile(path.join(directory, 'keep.txt'), 'unrelated');
    await utimes(path.join(directory, 'keep.txt'), staleDate, staleDate);
    const dry = await cleanupMedia();
    assert.ok(dry.eligible >= 4);
    assert.equal(dry.removed, 0);
    assert.equal(await fileExists(nameOf(orphan.url)), true);
    const cleaned = await cleanupMedia({ apply: true });
    assert.equal(cleaned.failed, 0);
    assert.ok(cleaned.removed >= 4);
    assert.equal(await fileExists(nameOf(orphan.url)), false);
    assert.equal(await fileExists(unregistered), false);
    for (const keep of [filename, nameOf(fresh.url), legacy, 'keep.txt'])
      assert.equal(await fileExists(keep), true, keep);
    assert.equal(await photoAccess(legacy), 'public');
    assert.equal(
      await db.mediaAsset.count({ where: { id: { in: [stale[0].id, retry[0].id] } } }),
      0,
    );
    assert.equal((await cleanupMedia({ apply: true })).removed, 0);
    groups++;
    console.log(
      'PASS dry-run, expiry, interrupted uploads, retry, unregistered cleanup and linked/legacy protection',
    );

    const failedDelete = await metadataFixture(owner, 1);
    await db.mediaAsset.update({
      where: { id: failedDelete[0].id },
      data: { createdAt: staleDate },
    });
    const blockedPath = path.join(directory, failedDelete[0].filename);
    await mkdir(blockedPath);
    const failedCleanup = await cleanupMedia({ apply: true });
    assert.equal(failedCleanup.failed, 1);
    assert.equal(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: failedDelete[0].id } })).status,
      'DELETING',
    );
    await rmdir(blockedPath);
    await writeFile(blockedPath, photo);
    const retryCleanup = await cleanupMedia({ apply: true });
    assert.equal(retryCleanup.failed, 0);
    assert.equal(retryCleanup.removed, 1);
    assert.equal(await db.mediaAsset.count({ where: { id: failedDelete[0].id } }), 0);
    groups++;
    console.log('PASS actual deletion failure retains a retryable record');

    const concurrent = await uploadPhoto(owner, photo);
    const [claimed, pruned] = await Promise.allSettled([
      createVehicle(owner, { ...input, vinChassis: 'WBA44444444444444', images: [concurrent.url] }),
      cleanupMedia({ apply: true, now: new Date(Date.now() + limits.orphanAgeMs + 10000) }),
    ]);
    assert.equal(pruned.status, 'fulfilled');
    if (claimed.status === 'fulfilled') {
      vehicles.push(claimed.value.id);
      assert.equal(await fileExists(nameOf(concurrent.url)), true);
    } else {
      assert.match(String(claimed.reason), /PHOTO_OWNERSHIP_REQUIRED/);
      assert.equal(await fileExists(nameOf(concurrent.url)), false);
    }
    groups++;
    console.log('PASS attachment versus cleanup race');

    // Exercise only the changed HTTP endpoints using signed test-session cookies.
    const origin = 'http://127.0.0.1:3102',
      secret = randomBytes(48).toString('hex');
    server = spawn(process.execPath, ['scripts/media-test-server.mjs'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXTAUTH_URL: origin,
        NEXTAUTH_SECRET: secret,
        UPLOAD_DIR: directory,
        STRIPE_SECRET_KEY: '',
        TWILIO_AUTH_TOKEN: '',
      },
    });
    server.stdout?.resume();
    server.stderr?.resume();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Media HTTP host startup timed out')), 60000);
      server!.once('message', () => {
        clearTimeout(timer);
        resolve();
      });
      server!.once('exit', () => {
        clearTimeout(timer);
        reject(Error('Media HTTP host exited'));
      });
    });
    const cookie = async (id: string) =>
      `next-auth.session-token=${await encode({ secret, token: { sub: id, authVersion: 0, email: `${id}@media.test` }, maxAge: 600 })}`;
    const ownerCookie = await cookie(owner),
      strangerCookie = await cookie(stranger);
    const multipart = () => {
      const f = new FormData();
      f.set('photo', new File([photo], 'vehicle.png', { type: 'image/png' }));
      return f;
    };
    const anonymous = await fetch(origin + '/api/uploads', {
      method: 'POST',
      headers: { Origin: origin },
      body: multipart(),
    });
    assert.equal(anonymous.status, 401);
    const response = await fetch(origin + '/api/uploads', {
      method: 'POST',
      headers: { Origin: origin, Cookie: ownerCookie },
      body: multipart(),
    });
    assert.equal(response.status, 201);
    const httpPhoto = await response.json();
    assert.ok(httpPhoto.expiresAt);
    assert.equal((await fetch(origin + httpPhoto.url)).status, 404);
    assert.equal(
      (await fetch(origin + httpPhoto.url, { headers: { Cookie: strangerCookie } })).status,
      404,
    );
    const privateRead = await fetch(origin + httpPhoto.url, { headers: { Cookie: ownerCookie } });
    assert.equal(privateRead.status, 200);
    assert.match(privateRead.headers.get('cache-control')!, /no-store/);
    const httpMeta = await sharp(Buffer.from(await privateRead.arrayBuffer())).metadata();
    assert.equal(httpMeta.format, 'jpeg');
    assert.equal(httpMeta.exif, undefined);
    const publishedRead = await fetch(origin + first.url);
    assert.equal(publishedRead.status, 200);
    assert.match(publishedRead.headers.get('cache-control')!, /must-revalidate/);
    const httpQuota = await metadataFixture(stranger, limits.pendingCount);
    const rejected = await fetch(origin + '/api/uploads', {
      method: 'POST',
      headers: { Origin: origin, Cookie: strangerCookie },
      body: multipart(),
    });
    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).error, 'PHOTO_QUOTA_EXCEEDED');
    await db.mediaAsset.deleteMany({ where: { id: { in: httpQuota.map((p) => p.id) } } });
    const unverified = randomUUID();
    users.push(unverified);
    await db.user.create({
      data: {
        id: unverified,
        email: `${unverified}@media.test`,
        phone: `MEDIA-${unverified}`,
        passwordHash: 'not-a-login-hash',
      },
    });
    assert.equal(
      (
        await fetch(origin + '/api/uploads', {
          method: 'POST',
          headers: { Origin: origin, Cookie: await cookie(unverified) },
          body: multipart(),
        })
      ).status,
      403,
    );
    assert.equal(await db.mediaAsset.count({ where: { ownerId: unverified } }), 0);
    const noOrigin = await fetch(origin + '/api/uploads', {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: multipart(),
    });
    assert.equal(noOrigin.status, 403);
    groups++;
    console.log('PASS HTTP authentication/origin guards, sanitized upload and private read access');
    console.log(
      `${groups} media integration groups passed; no bidding/payment/settlement workflows executed.`,
    );
  } finally {
    if (server) {
      server.kill();
      await new Promise<void>((resolve) => {
        if (server!.exitCode !== null) resolve();
        else {
          server!.once('exit', () => resolve());
          setTimeout(resolve, 5000).unref();
        }
      });
    }
    await db.mediaAsset.deleteMany({ where: { ownerId: { in: users } } });
    await db.vehicle.deleteMany({ where: { id: { in: vehicles } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    // Only this run's mkdtemp directory is touched; no recursive deletion.
    for (const name of await readdir(directory)) await unlink(path.join(directory, name));
    await rmdir(directory);
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Media tests failed');
  process.exitCode = 1;
});
