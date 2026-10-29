import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { queueQuery, assignmentCommand } from '../src/lib/admin-queue-rules';
import { retentionNoticeKind } from '../src/lib/retention-routing';
test('retention queue accepts only its states and coordination actions', () => {
  assert.equal(queueQuery.parse({ kind: 'retention', status: 'NEEDS_INFO' }).kind, 'retention');
  assert.equal(queueQuery.safeParse({ kind: 'retention', status: 'CAPTURED_FEE' }).success, false);
  const cmd = {
    kind: 'retention',
    id: '00000000-0000-4000-8000-000000000018',
    action: 'claim',
    version: 0,
    note: 'Independent review coordination',
  };
  assert.ok(assignmentCommand.safeParse(cmd).success);
  assert.equal(assignmentCommand.safeParse({ ...cmd, action: 'approve' }).success, false);
  assert.equal(assignmentCommand.safeParse({ ...cmd, ownerId: cmd.id }).success, false);
});
test('notification event mapping and routing copy cover all four languages', () => {
  assert.equal(retentionNoticeKind('REQUEST'), 'RETENTION_REVIEW');
  assert.equal(retentionNoticeKind('SUPPLEMENT'), 'RETENTION_REVIEW');
  assert.equal(retentionNoticeKind('RELEASED'), 'RETENTION_RELEASED');
  assert.equal(retentionNoticeKind('CREATE'), undefined);
  const en = JSON.parse(readFileSync('src/messages/en.json', 'utf8'));
  const keys = Object.keys(en).filter((k) => k.startsWith('rh'));
  assert.equal(keys.length, 11);
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const m = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const k of keys) assert.ok(m[k], lang + ':' + k);
  }
});
