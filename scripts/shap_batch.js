// Usage: node scripts/shap_batch.js <model.json> <input.json {X:[[...]]}> <out.json>
// Computes TreeSHAP (raw log-odds space) with the SAME JS implementation the app uses. Output: phi[sample][class][feature], expected[class], raw[sample][class].
import { readFileSync, writeFileSync } from 'node:fs';
import { TreeModel } from '../packages/sim-core/src/model/treeModel.js';
import { shapValues } from '../packages/sim-core/src/model/treeshap.js';
const [mp, ip, op] = process.argv.slice(2);
const model = new TreeModel(JSON.parse(readFileSync(mp, 'utf8'))), { X } = JSON.parse(readFileSync(ip, 'utf8'));
const t0 = Date.now(); const phi = [], raw = []; let maxErr = 0, expected = null;
for (const x of X) {
  const r = shapValues(model, x); expected = Array.from(r.expected); const rw = model.raw(x);
  phi.push(r.phi.map((a) => Array.from(a, (v) => +v.toFixed(6)))); raw.push(Array.from(rw));
  for (let k = 0; k < model.K; k++) maxErr = Math.max(maxErr, Math.abs(r.phi[k].reduce((a, b) => a + b, 0) + r.expected[k] - rw[k]));
}
writeFileSync(op, JSON.stringify({ phi, expected, raw, local_accuracy_max_abs_error: maxErr, seconds: (Date.now() - t0) / 1000, n: X.length }));
console.log(`[shap] ${X.length} samples, local-accuracy max |sum(phi)+E-raw| = ${maxErr.toExponential(2)}, ${(Date.now() - t0) / 1000}s`);
