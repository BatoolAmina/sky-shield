/** Path-dependent TreeSHAP (Lundberg et al., Algorithm 2), implemented from scratch for the exported trees.
 *  Explains the raw (log-odds) output of each class. Local accuracy: sum(phi) + expected = raw. */
const cp = (m) => m.map((e) => ({ d: e.d, z: e.z, o: e.o, w: e.w }));
function extend(m, pz, po, pi) {
  const l = m.length, n = cp(m); n.push({ d: pi, z: pz, o: po, w: l === 0 ? 1 : 0 });
  for (let i = l - 1; i >= 0; i--) { n[i + 1].w += (po * n[i].w * (i + 1)) / (l + 1); n[i].w = (pz * n[i].w * (l - i)) / (l + 1); }
  return n;
}
function unwind(m, idx) {
  const l = m.length - 1, n = cp(m), po = n[idx].o, pz = n[idx].z; let nxt = n[l].w;
  for (let j = l - 1; j >= 0; j--) {
    if (po !== 0) { const tmp = n[j].w; n[j].w = (nxt * (l + 1)) / ((j + 1) * po); nxt = tmp - (n[j].w * pz * (l - j)) / (l + 1); }
    else n[j].w = (n[j].w * (l + 1)) / (pz * (l - j));
  }
  for (let j = idx; j < l; j++) { n[j].d = n[j + 1].d; n[j].z = n[j + 1].z; n[j].o = n[j + 1].o; }
  n.pop(); return n;
}
function unwoundSum(m, idx) {
  const l = m.length - 1, po = m[idx].o, pz = m[idx].z; let nxt = m[l].w, tot = 0;
  for (let j = l - 1; j >= 0; j--) {
    if (po !== 0) { const tmp = (nxt * (l + 1)) / ((j + 1) * po); tot += tmp; nxt = m[j].w - (tmp * pz * (l - j)) / (l + 1); }
    else tot += m[j].w / pz / ((l - j) / (l + 1));
  }
  return tot;
}
function recurse(tr, node, x, phi, m, pz, po, pi) {
  m = extend(m, pz, po, pi);
  if (tr.leaf[node]) {
    for (let i = 1; i < m.length; i++) phi[m[i].d] += unwoundSum(m, i) * (m[i].o - m[i].z) * tr.val[node];
    return;
  }
  const f = tr.feat[node], v = x[f];
  const goLeft = Number.isNaN(v) ? !!tr.mgl[node] : v <= tr.thr[node];
  const hot = goLeft ? tr.left[node] : tr.right[node], cold = goLeft ? tr.right[node] : tr.left[node];
  let iz = 1, io = 1, k = -1;
  for (let i = 1; i < m.length; i++) if (m[i].d === f) { k = i; break; }
  if (k >= 0) { iz = m[k].z; io = m[k].o; m = unwind(m, k); }
  recurse(tr, hot, x, phi, m, (iz * tr.cnt[hot]) / tr.cnt[node], io, f);
  recurse(tr, cold, x, phi, m, (iz * tr.cnt[cold]) / tr.cnt[node], 0, f);
}
export function treeExpected(tr, node = 0) {
  if (tr.leaf[node]) return tr.val[node];
  const l = tr.left[node], r = tr.right[node];
  return (treeExpected(tr, l) * tr.cnt[l] + treeExpected(tr, r) * tr.cnt[r]) / tr.cnt[node];
}
/** SHAP values of one tree for sample x (adds into phi). */
export function treeShapSingle(tr, x, phi) { recurse(tr, 0, x, phi, [], 1, 1, -1); }
/** Returns { phi: Float64Array[K][F], expected: Float64Array[K] } in raw (log-odds) space. */
export function shapValues(model, x) {
  const F = model.featureNames.length, K = model.K;
  const phi = Array.from({ length: K }, () => new Float64Array(F)), expected = Float64Array.from(model.baseline);
  if (!model._exp) model._exp = model.trees.map((t) => treeExpected(t));
  model.trees.forEach((tr, ti) => { treeShapSingle(tr, x, phi[tr.k]); expected[tr.k] += model._exp[ti]; });
  return { phi, expected };
}
