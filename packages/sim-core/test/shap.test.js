import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/rng.js';
import { treeShapSingle, treeExpected } from '../src/model/treeshap.js';

function randomTree(rng, F, depth) {
  const t = { feat: [], thr: [], left: [], right: [], val: [], cnt: [], leaf: [], mgl: [] };
  function build(d) {
    const id = t.feat.length; t.feat.push(0); t.thr.push(0); t.left.push(-1); t.right.push(-1); t.val.push(0); t.cnt.push(0); t.leaf.push(0); t.mgl.push(0);
    if (d === 0) { t.leaf[id] = 1; t.val[id] = rng.normal(0, 1); t.cnt[id] = rng.int(5, 50); return id; }
    t.feat[id] = rng.int(0, F - 1); t.thr[id] = rng.normal(0, 1); const l = build(d - 1), r = build(d - 1); t.left[id] = l; t.right[id] = r; t.cnt[id] = t.cnt[l] + t.cnt[r]; return id;
  }
  build(depth); return t;
}
function ev(tr, node, x, S) {
  if (tr.leaf[node]) return tr.val[node]; const f = tr.feat[node];
  if (S.has(f)) return ev(tr, x[f] <= tr.thr[node] ? tr.left[node] : tr.right[node], x, S);
  return (tr.cnt[tr.left[node]] * ev(tr, tr.left[node], x, S) + tr.cnt[tr.right[node]] * ev(tr, tr.right[node], x, S)) / tr.cnt[node];
}
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
function bruteShapley(tr, x, F) {
  const phi = new Array(F).fill(0);
  for (let i = 0; i < F; i++) for (let mask = 0; mask < 1 << F; mask++) {
    if (mask & (1 << i)) continue; const S = new Set(); let k = 0; for (let j = 0; j < F; j++) if (mask & (1 << j)) { S.add(j); k++; }
    const S2 = new Set(S); S2.add(i); phi[i] += (fact(k) * fact(F - k - 1)) / fact(F) * (ev(tr, 0, x, S2) - ev(tr, 0, x, S));
  }
  return phi;
}
test('TreeSHAP equals brute-force exact Shapley values (path-dependent value function) on random trees', () => {
  const rng = new Rng(42); const F = 6;
  for (let rep = 0; rep < 20; rep++) {
    const tr = randomTree(rng, F, 4), x = Array.from({ length: F }, () => rng.normal(0, 1)), phi = new Float64Array(F); treeShapSingle(tr, x, phi); const bf = bruteShapley(tr, x, F);
    for (let i = 0; i < F; i++) assert.ok(Math.abs(phi[i] - bf[i]) < 1e-9, `rep ${rep} feature ${i}: ${phi[i]} vs ${bf[i]}`);
    const sum = phi.reduce((a, b) => a + b, 0); assert.ok(Math.abs(sum + treeExpected(tr) - ev(tr, 0, x, new Set(Array.from({ length: F }, (_, j) => j)))) < 1e-9, 'local accuracy');
  }
});
