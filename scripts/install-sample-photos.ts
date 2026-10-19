import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import { samplePhotoPaths } from '../src/lib/sample-photos';
import galleries from '../src/data/sample-photos.json';
import { sampleDescription } from '../src/lib/sample-facts';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/autoveri'
  )
    throw Error('Local fixture database only');
  const ids = galleries.map((g) => `91000000-0000-4000-8000-${String(g.index).padStart(12, '0')}`);
  const before = await db.vehicle.findMany({
    where: { id: { in: ids }, isSample: true },
    orderBy: { id: 'asc' },
  });
  assert.equal(before.length, 12);
  await mkdir('.local/commons', { recursive: true });
  await writeFile('.local/commons/pre-photo-install.json', JSON.stringify(before, null, 2));
  await db.$transaction(async (tx) => {
    for (const v of before)
      await tx.vehicle.update({
        where: { id: v.id },
        data: { images: samplePhotoPaths(Number(v.id.slice(-12))), description: sampleDescription },
      });
    const after = await tx.vehicle.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    const unchanged = (rows: typeof before) =>
      rows.map(({ images, description, updatedAt, ...rest }) => rest);
    assert.deepEqual(unchanged(after), unchanged(before));
  });
  console.log(
    'PASS: 12 sample galleries updated. All other vehicle fields, filter values and auction/payment state preserved.',
  );
}
main().finally(() => db.$disconnect());
