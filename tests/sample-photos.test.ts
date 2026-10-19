import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import galleries from '../src/data/sample-photos.json';
import { samplePhotoPaths } from '../src/lib/sample-photos';
import { demoVehicles } from '../src/lib/demo';
test('all 12 galleries contain distinct licensed JPEGs with matching source records', async () => {
  assert.equal(galleries.length, 12);
  let count = 0;
  const sources = new Set<string>();
  for (const g of galleries) {
    assert.ok(g.sameVehicleEvidence.length > 30);
    assert.ok(g.photos.length >= 2);
    assert.deepEqual(
      samplePhotoPaths(g.index),
      g.photos.map((p) => p.src),
    );
    for (const p of g.photos) {
      const bytes = await readFile('public' + p.src);
      assert.equal(bytes[0], 255);
      assert.equal(bytes[1], 216);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), p.sha256);
      assert.ok(p.author && p.attribution && p.changes);
      assert.ok(/^https:\/\/commons.wikimedia.org\/wiki\/File:/.test(p.sourceUrl));
      assert.ok(/^https:\/\/creativecommons.org\/licenses\/by(-sa)?\//.test(p.licenseUrl));
      assert.ok(!sources.has(p.sourceUrl));
      sources.add(p.sourceUrl);
      count++;
    }
  }
  assert.equal(count, 32);
  const publicManifest = JSON.parse(await readFile('public/samples/photo-licenses.json', 'utf8'));
  assert.deepEqual(publicManifest, galleries);
  for (const v of demoVehicles())
    assert.ok(v.images.every((src) => galleries.some((g) => g.photos.some((p) => p.src === src))));
});
