import test from 'node:test';
import assert from 'node:assert/strict';
import { GalleryGesture } from '../src/lib/gallery-gesture';
test('horizontal swipes navigate once; taps, vertical movement and cancellation do not', () => {
  for (const [x, y, cancelled, expected] of [
    [20, 110, false, 1],
    [190, 100, false, -1],
    [110, 100, false, 0],
    [110, 200, false, 0],
    [20, 110, true, 0],
  ] as const) {
    const g = new GalleryGesture(300, 200);
    g.down(1, { x: 100, y: 100 });
    g.move(1, { x, y });
    assert.equal(g.up(1, { x, y }, cancelled), expected);
    assert.equal(g.up(1, { x, y }), 0);
  }
});
test('two fingers zoom; releasing either finger cannot trigger photo navigation', () => {
  const g = new GalleryGesture(300, 200);
  g.down(1, { x: 100, y: 100 });
  g.down(2, { x: 200, y: 100 });
  assert.equal(g.move(2, { x: 300, y: 100 }).scale, 2);
  assert.equal(g.up(2, { x: 300, y: 100 }), 0);
  g.move(1, { x: 10, y: 100 });
  assert.equal(g.up(1, { x: 10, y: 100 }), 0);
  assert.equal(g.scale, 2);
});
test('zoomed dragging pans within image bounds; reset clears pan; zoom is bounded', () => {
  const g = new GalleryGesture(300, 200);
  g.zoom(2);
  g.down(1, { x: 0, y: 0 });
  g.move(1, { x: 1000, y: -1000 });
  assert.deepEqual(g.snapshot(), { scale: 2, x: 150, y: -100 });
  assert.equal(g.up(1, { x: 1000, y: -1000 }), 0);
  assert.equal(g.zoom(99).scale, 4);
  assert.deepEqual(g.zoom(0), { scale: 1, x: 0, y: 0 });
});
test('pinching back to original size does not become a swipe', () => {
  const g = new GalleryGesture(300, 200);
  g.down(1, { x: 100, y: 0 });
  g.down(2, { x: 200, y: 0 });
  g.move(2, { x: 300, y: 0 });
  g.move(2, { x: 150, y: 0 });
  assert.equal(g.scale, 1);
  g.up(2, { x: 150, y: 0 });
  assert.equal(g.up(1, { x: 0, y: 0 }), 0);
});
