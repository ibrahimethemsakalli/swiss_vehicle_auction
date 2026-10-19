import { createHash } from 'node:crypto';
import { db } from './db';

export async function rateLimit(subject: string, limit: number, seconds: number) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const key = createHash('sha256').update(`${subject}:${bucket}`).digest('hex');
  const entry = await db.rateLimit.upsert({
    where: { key },
    create: { key, expiresAt: new Date((bucket + 1) * seconds * 1000) },
    update: { count: { increment: 1 } },
  });
  if (entry.count > limit) throw new Error('RATE_LIMITED');
}
