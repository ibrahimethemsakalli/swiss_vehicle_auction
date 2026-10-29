import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proxyWorkspaceCommand } from '../src/lib/local-proxy-workspace';
test('workspace commands cannot set participants, holds or create configuration', () => {
  const id = '00000000-0000-4000-8000-000000000025';
  assert.ok(proxyWorkspaceCommand.safeParse({ action: 'create', requestId: id }).success);
  for (const raw of [
    { action: 'create', requestId: id, sellerId: id },
    { action: 'bid', auctionId: id, requestId: id, maximum: '1000', holdId: id },
    { action: 'bid', auctionId: id, requestId: id, maximum: '1000', actorId: id },
  ])
    assert.equal(proxyWorkspaceCommand.safeParse(raw).success, false);
});
test('workspace translations cover all four languages', () => {
  const de = JSON.parse(readFileSync('src/messages/de.json', 'utf8'));
  for (const lang of ['fr', 'it', 'en']) {
    const d = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const key of Object.keys(de).filter((k) => k.startsWith('lp'))) assert.ok(d[key]);
  }
});
