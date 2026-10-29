import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  queueQuery,
  queueDates,
  assignmentCommand,
  queueStatuses,
  recordQuery,
} from '../src/lib/admin-queue-rules';
test('admin filters reject wrong queue statuses, impossible dates and unbounded queries', () => {
  assert.equal(queueQuery.parse({}).page, 1);
  for (const q of [
    { page: 0 },
    { page: 1.5 },
    { page: 100001 },
    { kind: 'secrets' },
    { q: 'x'.repeat(101) },
    { from: '2026-02-30' },
    { from: '2026-10-02', to: '2026-10-01' },
    { kind: 'payments', status: 'OPEN' },
    { ownerId: 'injected' },
  ])
    assert.equal(queueQuery.safeParse(q).success, false, JSON.stringify(q));
  for (const [kind, statuses] of Object.entries(queueStatuses))
    for (const status of statuses) assert.ok(queueQuery.safeParse({ kind, status }).success);
  assert.equal(recordQuery.safeParse({ id: 'not-uuid' }).success, false);
});
test('UTC inclusive end date includes the full day without relying on browser timezone', () => {
  const dates = queueDates('2026-03-29', '2026-03-29');
  assert.equal(dates.gte?.toISOString(), '2026-03-29T00:00:00.000Z');
  assert.equal(dates.lt?.toISOString(), '2026-03-30T00:00:00.000Z');
});
test('assignment commands cannot inject operators, version or financial actions', () => {
  const valid = {
    kind: 'queue',
    id: '00000000-0000-4000-8000-000000000018',
    action: 'claim',
    version: 0,
    note: 'Work coordination',
  };
  assert.ok(assignmentCommand.safeParse(valid).success);
  for (const c of [
    { ...valid, ownerId: valid.id },
    { ...valid, version: -1 },
    { ...valid, action: 'capture' },
    { ...valid, note: 'x'.repeat(501) },
    { ...valid, note: '   ' },
    { ...valid, kind: 'audit' },
  ])
    assert.equal(assignmentCommand.safeParse(c).success, false);
});
test('operator copy is present in all four languages', () => {
  const catalogs = ['de', 'fr', 'it', 'en'].map((l) =>
    JSON.parse(readFileSync(`src/messages/${l}.json`, 'utf8')),
  );
  for (const key of Object.keys(catalogs[0]).filter((k) => k.startsWith('work')))
    for (const c of catalogs) {
      assert.ok(c[key], key);
      assert.deepEqual(c[key].match(/\{\{\w+\}\}/g), catalogs[0][key].match(/\{\{\w+\}\}/g));
    }
});
