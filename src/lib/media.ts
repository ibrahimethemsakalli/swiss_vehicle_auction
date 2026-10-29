import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { db } from './db';
import { uploadDirectory } from './uploads';
import {
  PHOTO_LIMITS as limits,
  MediaError,
  normalizePhoto,
  mediaFilenamePattern,
} from './photo-processing';

async function removeFile(filename: string) {
  if (!mediaFilenamePattern.test(filename)) throw new Error('INVALID_MEDIA_FILENAME');
  try {
    await unlink(path.join(uploadDirectory(), filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

let processing = 0;
export async function uploadPhoto(ownerId: string, bytes: Buffer) {
  if (processing >= 2) throw new MediaError('PHOTO_BUSY', 429);
  processing++;
  let assetId: string | undefined;
  let fileCreated = false;
  const filename = `${randomUUID()}.jpg`;
  try {
    if (!bytes.length || bytes.length > limits.inputBytes)
      throw new MediaError('PHOTO_TOO_LARGE', 413);
    const asset = await db.$transaction(async (tx) => {
      // All quota reservations, attachments and cleanup claims share this lock.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: ownerId } });
      if (
        !user ||
        user.suspendedAt ||
        user.isSample ||
        !user.isIdentityVerified ||
        !user.phoneVerifiedAt ||
        !user.emailVerifiedAt
      )
        throw new MediaError('FORBIDDEN', 403);
      const [total, pending] = await Promise.all([
        tx.mediaAsset.aggregate({ where: { ownerId }, _count: true, _sum: { bytes: true } }),
        tx.mediaAsset.aggregate({
          where: { ownerId, vehicleId: null },
          _count: true,
          _sum: { bytes: true },
        }),
      ]);
      if (
        total._count >= limits.totalCount ||
        (total._sum.bytes ?? 0) + limits.inputBytes > limits.totalBytes ||
        pending._count >= limits.pendingCount ||
        (pending._sum.bytes ?? 0) + limits.inputBytes > limits.pendingBytes
      )
        throw new MediaError('PHOTO_QUOTA_EXCEEDED', 429);
      return tx.mediaAsset.create({ data: { filename, ownerId, bytes: limits.inputBytes } });
    });
    assetId = asset.id;
    const clean = await normalizePhoto(bytes);
    await mkdir(uploadDirectory(), { recursive: true });
    const handle = await open(path.join(uploadDirectory(), filename), 'wx', 0o600);
    fileCreated = true;
    try {
      await handle.writeFile(clean.bytes);
    } finally {
      await handle.close();
    }
    await db.mediaAsset.update({
      where: { id: asset.id, status: 'STAGING' },
      data: {
        status: 'READY',
        bytes: clean.bytes.length,
        width: clean.width,
        height: clean.height,
      },
    });
    return {
      url: `/api/uploads/${filename}`,
      expiresAt: new Date(asset.createdAt.getTime() + limits.orphanAgeMs).toISOString(),
    };
  } catch (error) {
    if (assetId) {
      // Keep DELETING on disk failures so the janitor can retry safely.
      const retired = await db.mediaAsset.updateMany({
        where: { id: assetId, status: 'STAGING' },
        data: { status: 'DELETING' },
      });
      // A failed response after a committed READY update must not delete it.
      if (retired.count)
        try {
          if (fileCreated) await removeFile(filename);
          await db.mediaAsset.deleteMany({ where: { id: assetId, status: 'DELETING' } });
        } catch {}
    }
    throw error;
  } finally {
    processing--;
  }
}

export async function photoAccess(
  filename: string,
  viewerId?: string,
): Promise<'public' | 'private' | null> {
  if (!mediaFilenamePattern.test(filename)) return null;
  const url = `/api/uploads/${filename}`;
  const asset = await db.mediaAsset.findUnique({
    where: { filename },
    include: { vehicle: { select: { status: true, images: true } } },
  });
  if (asset && asset.status !== 'READY') return null;
  // Existing referenced uploads remain readable; unregistered files cannot be
  // claimed by new listings. No metadata-cleaning guarantee for legacy photos.
  const vehicle =
    asset?.vehicle ??
    (!asset
      ? await db.vehicle.findFirst({
          where: { images: { has: url } },
          select: { status: true, images: true, userId: true },
        })
      : null);
  if (
    vehicle &&
    vehicle.images.includes(url) &&
    ['ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED'].includes(vehicle.status)
  )
    return 'public';
  if (!viewerId) return null;
  const viewer = await db.user.findUnique({
    where: { id: viewerId },
    select: { role: true, suspendedAt: true },
  });
  if (!viewer || viewer.suspendedAt) return null;
  const legacyOwner = vehicle && 'userId' in vehicle ? vehicle.userId : undefined;
  return asset?.ownerId === viewerId ||
    legacyOwner === viewerId ||
    (viewer.role === 'ADMIN' && !!vehicle)
    ? 'private'
    : null;
}

export async function cleanupMedia({
  apply = false,
  now = new Date(),
  limit = 100,
}: { apply?: boolean; now?: Date; limit?: number } = {}) {
  const cutoff = new Date(now.getTime() - limits.orphanAgeMs);
  const stagingCutoff = new Date(now.getTime() - limits.stagingAgeMs);
  const candidates = await db.mediaAsset.findMany({
    where: {
      vehicleId: null,
      draftId: null,
      OR: [
        { status: 'DELETING' },
        { status: 'READY', createdAt: { lt: cutoff } },
        { status: 'STAGING', createdAt: { lt: stagingCutoff } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  const result = { eligible: 0, removed: 0, failed: 0, unregistered: 0 };
  for (const asset of candidates) {
    try {
      const claimed = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${asset.ownerId} FOR UPDATE`;
        const current = await tx.mediaAsset.findUnique({ where: { id: asset.id } });
        if (
          !current ||
          current.vehicleId ||
          current.draftId ||
          (current.status !== 'DELETING' &&
            current.createdAt >= (current.status === 'STAGING' ? stagingCutoff : cutoff))
        )
          return false;
        if (
          await tx.vehicle.count({ where: { images: { has: `/api/uploads/${current.filename}` } } })
        )
          return false;
        if (apply)
          await tx.mediaAsset.update({ where: { id: current.id }, data: { status: 'DELETING' } });
        return true;
      });
      if (!claimed) continue;
      result.eligible++;
      if (apply) {
        await removeFile(asset.filename);
        await db.mediaAsset.deleteMany({ where: { id: asset.id, status: 'DELETING' } });
        result.removed++;
      }
    } catch {
      result.failed++;
    }
  }
  // Catch files left by a crash/old uploader. Only UUID photo names, ordinary
  // files older than 24h, and never anything referenced by any listing.
  let entries;
  try {
    entries = await readdir(uploadDirectory(), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw error;
  }
  for (const entry of entries) {
    if (result.unregistered >= limit) break;
    if (!entry.isFile() || !mediaFilenamePattern.test(entry.name)) continue;
    try {
      const info = await lstat(path.join(uploadDirectory(), entry.name));
      if (!info.isFile() || info.mtime >= cutoff) continue;
      if (
        (await db.mediaAsset.count({ where: { filename: entry.name } })) ||
        (await db.vehicle.count({ where: { images: { has: `/api/uploads/${entry.name}` } } }))
      )
        continue;
      result.unregistered++;
      result.eligible++;
      if (apply) {
        await removeFile(entry.name);
        result.removed++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}
