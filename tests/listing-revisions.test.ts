import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewFeedback, correctionKeys } from '../src/lib/review-feedback';
import { draftCommand } from '../src/lib/listing-drafts';
test('rejection requires a bounded reason and a known correction checklist', () => {
  assert.equal(reviewFeedback.safeParse({ action: 'reject', note: 'Fix photos' }).success, false);
  assert.equal(
    reviewFeedback.safeParse({ action: 'reject', note: 'Fix photos', corrections: ['INJECTED'] })
      .success,
    false,
  );
  assert.equal(
    reviewFeedback.safeParse({ action: 'reject', note: 'x'.repeat(2001), corrections: ['PHOTOS'] })
      .success,
    false,
  );
  assert.ok(
    reviewFeedback.safeParse({ action: 'reject', note: 'Fix photos', corrections: ['PHOTOS'] })
      .success,
  );
  for (const action of ['revise', 'relist'])
    assert.ok(
      draftCommand.safeParse({
        action,
        vehicleId: '00000000-0000-4000-8000-000000000012',
        version: 1,
      }).success,
    );
});
test('recovery copy and version actions exist in every language', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const d = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const key of [
      'REJECTED',
      'revisionTitle',
      'revisionChecklist',
      'revisionEdit',
      'relistStart',
      'relistHint',
      'relistLocked',
      'revisionVersion',
      ...correctionKeys.map((k) => `correction${k}`),
      ...[
        'SUBMITTED',
        'REJECTED',
        'APPROVED',
        'REVISION_STARTED',
        'RELIST_STARTED',
        'EDIT_STARTED',
      ].map((k) => `revision${k}`),
    ])
      assert.ok(d[key]?.length, `${lang}:${key}`);
  }
});
