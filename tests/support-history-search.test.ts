import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { historyFilters, readFilteredHistory } from '../src/lib/support-history-search';
import { supportRead } from '../src/lib/support';
test('dates reject impossible days and reversed ranges; search is bounded', () => {
  for (const raw of [
    { from: '2026-02-30' },
    { from: '2026-03-02', to: '2026-03-01' },
    { message: 'x'.repeat(161) },
  ])
    assert.equal(historyFilters.safeParse(raw).success, false);
  assert.equal(historyFilters.safeParse({ from: '2024-02-29', to: '2024-02-29' }).success, true);
});
test('filtered history scopes ticket, escapes wildcards, uses inclusive UTC days and bounded paging', async () => {
  let query: any;
  const db = {
    supportEntry: {
      findMany: async (q: any) => {
        query = q;
        return Array.from({ length: 31 }, (_, i) => ({ id: String(i) }));
      },
    },
  };
  const r = await readFilteredHistory(db as any, 'ticket', 2, {
    message: '  50%_\\  ',
    from: '2026-10-01',
    to: '2026-10-01',
  });
  assert.equal(query.where.ticketId, 'ticket');
  assert.equal(query.where.body.contains, '50\\%\\_\\\\');
  assert.equal(query.where.createdAt.gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(query.where.createdAt.lt.toISOString(), '2026-10-02T00:00:00.000Z');
  assert.equal(query.skip, 30);
  assert.equal(query.take, 31);
  assert.equal(r.entries.length, 30);
  assert.equal(r.more, true);
  assert.deepEqual(Object.keys(query.select).sort(), ['body', 'createdAt', 'id', 'staff']);
});
test('context is ticket-scoped and ranked with deterministic timestamp/id ties, ignoring search filters', async () => {
  let find: any, count: any, list: any;
  const id = 'ac3d527c-024a-4385-8f79-65f33271133c',
    createdAt = new Date('2026-10-01');
  const db = {
    supportEntry: {
      findFirst: async (q: any) => {
        find = q;
        return { id, createdAt };
      },
      count: async (q: any) => {
        count = q;
        return 34;
      },
      findMany: async (q: any) => {
        list = q;
        return [];
      },
    },
  };
  const r = await readFilteredHistory(db as any, 'ticket', 1, {
    context: id,
    message: 'not in context',
  });
  assert.deepEqual(find.where, { id, ticketId: 'ticket' });
  assert.equal(count.where.ticketId, 'ticket');
  assert.deepEqual(count.where.OR[1], { createdAt, id: { lt: id } });
  assert.equal(r.resolvedPage, 2);
  assert.equal(list.skip, 30);
  assert.deepEqual(list.where, { ticketId: 'ticket' });
  db.supportEntry.findFirst = async () => null as any;
  await assert.rejects(
    readFilteredHistory(db as any, 'other-ticket', 1, { context: id }),
    /NOT_FOUND/,
  );
});
test('unauthorized users never reach message search; all four languages contain search copy', async () => {
  const id = 'ac3d527c-024a-4385-8f79-65f33271133c';
  let looked = false;
  const db = {
    user: { findUnique: async () => ({ id: 'buyer', role: 'PRIVATE_USER' }) },
    supportTicket: {
      findFirst: async (q: any) => {
        looked = true;
        assert.equal(q.where.userId, 'buyer');
        return null;
      },
    },
  };
  await assert.rejects(supportRead(db as any, 'buyer', { id, message: 'secret' }), /NOT_FOUND/);
  assert.equal(looked, true);
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const o = JSON.parse(
      readFileSync(new URL('../src/messages/' + lang + '.json', import.meta.url), 'utf8'),
    );
    for (const k of [
      'hsText',
      'hsFrom',
      'hsTo',
      'hsUTC',
      'hsInvalid',
      'hsSearch',
      'hsContext',
      'hsBack',
      'hsContextView',
    ])
      assert.ok(o[k]?.length);
  }
});
