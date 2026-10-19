import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { db } from '../src/lib/db';
import { sampleFacts } from '../src/lib/sample-facts';
import { samplePhotoPaths } from '../src/lib/sample-photos';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/autoveri'
  )
    throw Error('Local fixture database only');
  const ids = Array.from(
    { length: 12 },
    (_, i) => `91000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  );
  const before = await db.vehicle.findMany({
    where: { id: { in: ids }, isSample: true },
    orderBy: { id: 'asc' },
  });
  assert.equal(before.length, 12);
  await mkdir('.local/commons', { recursive: true });
  await writeFile(
    `.local/commons/facts-backup-${Date.now()}.json`,
    JSON.stringify(before, null, 2),
  );
  await db.$transaction(async (tx) => {
    for (const v of before) {
      const index = Number(v.id.slice(-12));
      assert.deepEqual(v.images, samplePhotoPaths(index));
      const data = sampleFacts(index);
      const after = await tx.vehicle.update({ where: { id: v.id }, data });
      for (const key of Object.keys(v) as (keyof typeof v)[]) {
        if (key in data || key === 'updatedAt') continue;
        assert.deepEqual(after[key], v[key], `Unexpected change: ${key}`);
      }
    }
  });
  console.log(
    'PASS: 12 source-aligned samples; unknown registration/specs cleared; photos, prices, auction and settlement fields unchanged.',
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
