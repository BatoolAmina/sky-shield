import test from 'node:test';
import assert from 'node:assert/strict';
import { drawScene, pickTrack, toScreen } from '../src/draw.js';

const mockCtx = () => { const calls = []; return new Proxy({ calls }, { get: (t, k) => (k === 'calls' ? calls : (...a) => { calls.push([k, ...a]); }), set: () => true }); };
const frame = { zones: { restricted: 1500, warning: 4000, outer: 9000 }, tracks: [{ id: 1, x: 1000, y: 2000, vx: 5, vy: -3, mentor: { threat: 0.9 }, classified: null }, { id: 2, x: -3000, y: 500, mentor: null, classified: 'nonthreat' }], truth: [{ id: 5, cls: 'bird', x: 10, y: 20, status: 'active' }] };

test('toScreen maps the asset to the centre and north to up', () => {
  const [cx, cy] = toScreen(0, 0, 500, 500, 9000); assert.deepEqual([cx, cy], [250, 250]); const [, ny] = toScreen(0, 4500, 500, 500, 9000); assert.ok(ny < 250);
});
test('drawScene draws rings, tracks and (optionally) ground truth without throwing', () => {
  const c = mockCtx(); drawScene(c, 500, 500, frame, { selectedId: 1, showTruth: true });
  const arcs = c.calls.filter((x) => x[0] === 'arc').length; assert.ok(arcs >= 3 + 2 + 1); assert.ok(c.calls.some((x) => x[0] === 'strokeRect'));
  const c2 = mockCtx(); drawScene(c2, 500, 500, frame, {}); assert.ok(!c2.calls.some((x) => x[0] === 'strokeRect'), 'truth hidden by default');
  drawScene(mockCtx(), 500, 500, null, {});
});
test('pickTrack selects the nearest track within the click radius', () => {
  const [x, y] = toScreen(1000, 2000, 500, 500, 9000); assert.equal(pickTrack(frame, 500, 500, x + 3, y - 2), 1); assert.equal(pickTrack(frame, 500, 500, 10, 10), null);
});
