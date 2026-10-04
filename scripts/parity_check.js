// Usage: node scripts/parity_check.js <model.json> <parity.json> <out.json>
// Checks that the JS tree runtime reproduces scikit-learn raw scores on held-out rows.
import { readFileSync, writeFileSync } from 'node:fs';
import { TreeModel } from '../packages/sim-core/src/model/treeModel.js';
const [mp, pp, op] = process.argv.slice(2);
const model = new TreeModel(JSON.parse(readFileSync(mp, 'utf8'))), { X, raw } = JSON.parse(readFileSync(pp, 'utf8'));
let maxErr = 0, argmaxMatch = 0; const t0 = process.hrtime.bigint();
X.forEach((x, i) => { const r = model.raw(x); raw[i].forEach((v, k) => (maxErr = Math.max(maxErr, Math.abs(v - r[k])))); const a = raw[i].indexOf(Math.max(...raw[i])), b = Array.from(r).indexOf(Math.max(...r)); if (a === b) argmaxMatch++; });
const us = Number(process.hrtime.bigint() - t0) / 1000 / X.length;
const res = { n: X.length, max_abs_raw_error_vs_sklearn: maxErr, argmax_agreement: argmaxMatch / X.length, js_microseconds_per_prediction: us };
writeFileSync(op, JSON.stringify(res, null, 1)); console.log('[parity]', res);
