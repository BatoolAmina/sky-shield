import { createWorld, ScenarioEngine } from './engine.js';
import { Perception } from './perception.js';
import { FEATURE_NAMES, extractFeatures, extractSequence, windowTruth } from './features.js';
import { sampleDatasetScenario } from './scenario.js';
/** Run one dataset scenario headlessly and emit one row per confirmed track every `strideS` seconds. */
export function runDatasetScenario(o) {
    const dur = o.durationS ?? 100, stride = o.strideS ?? 3;
    const def = sampleDatasetScenario(o.seed, o.profile, dur);
    const w = createWorld(o.seed, o.profile, o.overrides ?? {}, dur);
    const eng = new ScenarioEngine(def), per = new Perception(o.seed, w.cfg.cond, o.filter ?? 'kf');
    const rows = [], dt = w.cfg.dt, nSteps = Math.round(dur / dt);
    let nextEmit = 8;
    for (let i = 0; i < nSteps; i++) {
        eng.step(w, { firstWaveClearedEarly: false });
        per.tick(w);
        if (w.t + 1e-9 >= nextEmit) {
            nextEmit += stride;
            const conf = per.confirmed();
            for (const tr of conf) {
                const last = tr.history[tr.history.length - 1];
                if (!last || last.t < w.t - 1.01)
                    continue;
                const f = extractFeatures(tr, w.t, conf, o.windowS ?? 15);
                if (!f)
                    continue;
                const tru = windowTruth(tr, w.t, w, o.windowS ?? 15);
                rows.push({ seed: o.seed, t: Math.round(w.t * 10) / 10, track: tr.id, label: tru.label, threat: tru.threat, purity: tru.purity, oracle: tru.oracle, trueRange: tru.trueRange, trueTti: tru.trueTti, feats: f,
                    seq: o.sequences ? extractSequence(tr, w.t) : undefined });
            }
        }
        w.step();
    }
    return { rows, hash: w.stateHash() };
}
export { FEATURE_NAMES };
