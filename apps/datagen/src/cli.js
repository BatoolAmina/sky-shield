/* Headless dataset generator. Usage: tsx apps/datagen/src/cli.ts --out data/v1 --seeds 1200 [--shifted 150] [--filter kf|ab] [--sequences] [--robustness] */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FEATURE_NAMES, CLASSES, Rng, runDatasetScenario, SEQ_STEPS, SEQ_CH } from '../../../packages/sim-core/src/index.js';
function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? (process.argv[i + 1]?.startsWith('--') ? 'true' : process.argv[i + 1] ?? 'true') : def; }
const out = arg('out', 'data/v1'), nSeeds = +arg('seeds', '1200'), nShift = +arg('shifted', '150'), master = +arg('master', '20260101');
const windowS = +arg('window', '15'), filter = arg('filter', 'kf'), dur = +arg('duration', '100'), withSeq = arg('sequences') === 'true', withRob = arg('robustness') === 'true';
fs.mkdirSync(out, { recursive: true });
// ---- seed-wise split plan (NEVER random rows) ----
const ids = Array.from({ length: nSeeds }, (_, i) => i + 1);
new Rng(master).shuffle(ids);
const nTrain = Math.round(nSeeds * 0.7), nVal = Math.round(nSeeds * 0.15);
const split = { train: ids.slice(0, nTrain), valA: ids.slice(nTrain, nTrain + Math.floor(nVal / 2)), valB: ids.slice(nTrain + Math.floor(nVal / 2), nTrain + nVal), test: ids.slice(nTrain + nVal),
    shifted: Array.from({ length: nShift }, (_, i) => 5_000_000 + i) };
const HEADER = ['split', 'seed', 't', 'track', 'label', 'threat', 'purity', 'oracle', 'true_range', 'true_tti', ...FEATURE_NAMES].join(',');
const f4 = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(4));
function writeSet(file, groups, seq) {
    const ws = fs.createWriteStream(path.join(out, file));
    ws.write(HEADER + '\n');
    const sq = seq ? fs.createWriteStream(path.join(out, file.replace('.csv', '.seq.f32'))) : null;
    const counts = {};
    for (const g of groups) {
        counts[g.name] = {};
        for (const seed of g.seeds) {
            const { rows } = runDatasetScenario({ seed, profile: g.profile, overrides: g.ov, filter, durationS: dur, sequences: seq, windowS });
            const lines = [];
            for (const r of rows) {
                counts[g.name][r.label] = (counts[g.name][r.label] ?? 0) + 1;
                lines.push([g.name, r.seed, r.t, r.track, r.label, r.threat, f4(r.purity), f4(r.oracle), f4(r.trueRange), f4(r.trueTti), ...r.feats.map(f4)].join(','));
                if (sq && r.seq)
                    sq.write(Buffer.from(new Float32Array(r.seq).buffer));
            }
            if (lines.length)
                ws.write(lines.join('\n') + '\n');
        }
    }
    ws.end();
    sq?.end();
    return counts;
}
const t0 = Date.now(), counts = {};
counts.train = writeSet('train.csv', [{ name: 'train', seeds: split.train, profile: 'train' }], withSeq);
counts.val = writeSet('val.csv', [{ name: 'valA', seeds: split.valA, profile: 'train' }, { name: 'valB', seeds: split.valB, profile: 'train' }], withSeq);
counts.test = writeSet('test.csv', [{ name: 'test', seeds: split.test, profile: 'train' }], withSeq);
counts.shifted = writeSet('shifted.csv', [{ name: 'shifted', seeds: split.shifted, profile: 'shifted' }], withSeq);
// ---- robustness sets: TEST seeds only, with controlled perturbations ----
const robustness = [];
if (withRob) {
    const add = (sweep, levels, mk) => levels.forEach((l) => robustness.push({ name: `${sweep}_${l}`, sweep, level: l, ov: mk(l) }));
    add('noise', [0.7, 1, 1.5, 2, 3], (l) => ({ noiseScale: l }));
    add('clutter', [0.5, 1, 2, 4, 8], (l) => ({ clutterScale: l }));
    add('speed', [0.7, 0.85, 1, 1.2, 1.5], (l) => ({ speedScale: l }));
    add('radar_outage', [0, 0.1, 0.25, 0.4], (l) => ({ radarOutage: l }));
    add('visibility', [1, 0.5, 0.25], (l) => ({ visibilityScale: l }));
    robustness.push({ name: 'rf_off_1', sweep: 'rf_off', level: 1, ov: { rfDisabled: true } }, { name: 'eo_off_1', sweep: 'eo_off', level: 1, ov: { eoDisabled: true } });
    fs.mkdirSync(path.join(out, 'robustness'), { recursive: true });
    for (const r of robustness) {
        const f = path.join('robustness', `${r.name}.csv`);
        writeSet(f, [{ name: r.name, seeds: split.test, profile: 'train', ov: r.ov }], false);
    }
}
// ---- determinism self-check + manifest ----
const hashes = [1, 2, 3].map((s) => runDatasetScenario({ seed: s, profile: 'train', filter, durationS: dur }).hash);
const manifest = { version: path.basename(out), generator: 'skyshield-sim-core@1.0.0', filter, durationS: dur, strideS: 3, windowS: windowS, masterSeed: master, feature_names: FEATURE_NAMES, classes: CLASSES,
    threat_classes: CLASSES.slice(0, 4), seq_shape: withSeq ? [SEQ_STEPS, SEQ_CH] : null, split_seeds: split, counts, robustness: robustness.map(({ name, sweep, level }) => ({ name, sweep, level })),
    determinism_hashes_seed_1_2_3: hashes, node: process.version, generated_seconds: (Date.now() - t0) / 1000 };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`[datagen] ${out} done in ${manifest.generated_seconds}s; train windows by label:`, counts.train.train);
