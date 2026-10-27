import test from 'node:test';
import assert from 'node:assert/strict';

test('Prisma 7 ESM migration loads database consumers without connecting or invoking workflows', async () => {
  const [{ authHandler, authOptions }, { db }, backup] = await Promise.all([
    import('../src/lib/auth'),
    import('../src/lib/db'),
    import('../scripts/local-backup-lib'),
    import('../src/lib/bidding'),
    import('../src/lib/offers'),
    import('../src/lib/legal'),
    import('../src/lib/operations'),
  ]);
  assert.equal(typeof authHandler, 'function');
  assert.equal(authOptions.providers[0].id, 'credentials');
  assert.equal(typeof backup.assertEmptyRestoreDatabase, 'function');
  await db.$disconnect();
});
