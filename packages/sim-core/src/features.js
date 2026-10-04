import { wrapPi } from './rng.js';
import { CLASSES, isThreatClass } from './types.js';
export const WINDOW_S = 15, MIN_SAMPLES = 5, SEQ_STEPS = 15, SEQ_CH = 8;
export const FEATURE_NAMES = [
    'speed_mean', 'speed_std', 'alt_mean', 'alt_std', 'vert_rate_abs', 'heading_rate_abs', 'curvature', 'radial_rate', 'range_to_asset',
    'cpa_dist', 'time_to_cpa', 'heading_to_asset_cos', 'rcs_mean', 'rcs_std', 'rf_frac', 'rf_sig', 'iff_frac', 'eo_drone_frac', 'eo_bird_frac',
    'eo_air_frac', 'n_sensor_types', 'track_age', 'fusion_conf', 'hit_rate', 'group_count', 'group_score',
];
/** Feature groups for the ablation study. */
export const FEATURE_GROUPS = {
    fusion: ['rf_frac', 'rf_sig', 'iff_frac', 'eo_drone_frac', 'eo_bird_frac', 'eo_air_frac', 'n_sensor_types', 'fusion_conf'],
    group: ['group_count', 'group_score'],
    rcs: ['rcs_mean', 'rcs_std'],
    geometry: ['radial_rate', 'range_to_asset', 'cpa_dist', 'time_to_cpa', 'heading_to_asset_cos'],
    kinematics: ['speed_mean', 'speed_std', 'alt_mean', 'alt_std', 'vert_rate_abs', 'heading_rate_abs', 'curvature'],
};
export const CATEGORICAL = ['rf_sig'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { if (a.length < 2)
    return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export function windowSamples(tr, now, W = WINDOW_S) { return tr.history.filter((s) => s.t > now - W - 1e-6 && s.t <= now + 1e-6); }
/** Features are computed ONLY from the perceived track (never from ground truth). Returns null if the window is too short. */
export function extractFeatures(tr, now, others, W = WINDOW_S) {
    const S = windowSamples(tr, now, W);
    if (S.length < MIN_SAMPLES)
        return null;
    const sp = S.map((s) => Math.hypot(s.vx, s.vy, s.vz)), al = S.map((s) => s.z), vz = S.map((s) => Math.abs(s.vz));
    const dh = [];
    for (let i = 1; i < S.length; i++)
        dh.push(Math.abs(wrapPi(Math.atan2(S[i].vy, S[i].vx) - Math.atan2(S[i - 1].vy, S[i - 1].vx))) / Math.max(0.1, S[i].t - S[i - 1].t));
    const hr = mean(dh), spm = mean(sp);
    const rg = S.map((s) => Math.hypot(s.x, s.y)), tm = mean(S.map((s) => s.t)), rm = mean(rg);
    let num = 0, den = 0;
    for (let i = 0; i < S.length; i++) {
        num += (S[i].t - tm) * (rg[i] - rm);
        den += (S[i].t - tm) ** 2;
    }
    const radial = den > 0 ? num / den : 0;
    const L = S[S.length - 1], rx = L.x, ry = L.y, rr = Math.hypot(rx, ry), vv = Math.hypot(L.vx, L.vy);
    let cpa = rr, tcpa = 300, cosA = 0;
    if (vv > 0.5) {
        const t = -(rx * L.vx + ry * L.vy) / (vv * vv);
        cosA = -(rx * L.vx + ry * L.vy) / (Math.max(rr, 1) * vv);
        if (t > 0) {
            tcpa = Math.min(t, 300);
            cpa = Math.hypot(rx + L.vx * t, ry + L.vy * t);
        }
    }
    const rcs = S.filter((s) => s.rcs !== null).map((s) => s.rcs);
    const rfS = S.filter((s) => s.rf);
    const sigCount = new Map();
    rfS.forEach((s) => { if (s.sig >= 0)
        sigCount.set(s.sig, (sigCount.get(s.sig) ?? 0) + 1); });
    let sig = -1, sc = 0;
    sigCount.forEach((c, k) => { if (c > sc) {
        sc = c;
        sig = k;
    } });
    const n = S.length, frac = (f) => S.filter(f).length / n;
    const sims = [];
    for (const o of others) {
        if (o.id === tr.id)
            continue;
        const ol = o.history[o.history.length - 1];
        if (!ol)
            continue;
        const dist = Math.hypot(ol.x - L.x, ol.y - L.y, ol.z - L.z);
        if (dist > 2500)
            continue;
        sims.push(Math.exp(-Math.hypot(ol.vx - L.vx, ol.vy - L.vy, ol.vz - L.vz) / 4) * Math.exp(-dist / 1500));
    }
    sims.sort((a, b) => b - a);
    const groupScore = Math.min(1, (sims.slice(0, 3).reduce((a, b) => a + b, 0)) / 2);
    const nTypes = 1 + (rfS.length > 0 ? 1 : 0) + (S.some((s) => s.eo >= 0) ? 1 : 0) + (S.some((s) => s.iff) ? 1 : 0);
    const f = [spm, std(sp), mean(al), std(al), mean(vz), (hr * 180) / Math.PI, (hr / Math.max(spm, 1)) * 1000, radial, rr, Math.min(cpa, 10000), tcpa, cosA,
        rcs.length ? mean(rcs) : -40, std(rcs), frac((s) => s.rf), sig, frac((s) => s.iff), frac((s) => s.eo === 0), frac((s) => s.eo === 1), frac((s) => s.eo === 2),
        nTypes, now - tr.birthT, tr.confidence(now), frac((s) => s.hit), Math.min(10, sims.filter((x) => x > 0.15).length), groupScore];
    return f.map((x) => (Number.isFinite(x) ? x : 0));
}
/** Raw per-step window for the optional sequence model: [speed, alt, heading-rate, radial-rate, rcs, hit, rf, iff], left-padded with zeros. */
export function extractSequence(tr, now) {
    const S = windowSamples(tr, now, WINDOW_S);
    const out = new Array(SEQ_STEPS * SEQ_CH).fill(0);
    const off = SEQ_STEPS - Math.min(SEQ_STEPS, S.length), use = S.slice(-SEQ_STEPS);
    use.forEach((s, i) => {
        const p = i > 0 ? use[i - 1] : null, dt = p ? Math.max(0.1, s.t - p.t) : 1;
        const hrate = p ? (Math.abs(wrapPi(Math.atan2(s.vy, s.vx) - Math.atan2(p.vy, p.vx))) / dt) * 180 / Math.PI : 0;
        const rad = p ? (Math.hypot(s.x, s.y) - Math.hypot(p.x, p.y)) / dt : 0;
        const o = (off + i) * SEQ_CH;
        out[o] = Math.hypot(s.vx, s.vy, s.vz);
        out[o + 1] = s.z;
        out[o + 2] = hrate;
        out[o + 3] = rad;
        out[o + 4] = s.rcs ?? -40;
        out[o + 5] = s.hit ? 1 : 0;
        out[o + 6] = s.rf ? 1 : 0;
        out[o + 7] = s.iff ? 1 : 0;
    });
    return out;
}
/** Ground-truth label for a window (dominant truth id among hit samples). Used for dataset labels / scoring only, never as a feature. */
export function windowTruth(tr, now, w, W = WINDOW_S) {
    const S = windowSamples(tr, now, W).filter((s) => s.hit);
    const cnt = new Map();
    S.forEach((s) => cnt.set(s.truth, (cnt.get(s.truth) ?? 0) + 1));
    let best = -2, bc = 0;
    cnt.forEach((c, k) => { if (c > bc) {
        bc = c;
        best = k;
    } });
    const purity = S.length ? bc / S.length : 0;
    if (best === -1)
        return { label: 'clutter', purity, entityId: -1, threat: 0, oracle: 0, trueRange: 0, trueTti: 1e4 };
    const ent = w.truthById(best);
    if (!ent || purity < 0.6)
        return { label: 'mixed', purity, entityId: best, threat: 0, oracle: 0, trueRange: 0, trueTti: 1e4 };
    const rr = Math.hypot(ent.pos.x, ent.pos.y), vr = (ent.pos.x * Math.cos(ent.psi) + ent.pos.y * Math.sin(ent.psi)) / Math.max(rr, 1) * ent.speed;
    const closing = -vr, tti = closing > 0.5 ? rr / closing : 1e4, thr = isThreatClass(ent.cls) ? 1 : 0;
    const oracle = thr ? 100 * Math.exp(-tti / 60) * (0.5 + 0.5 * Math.exp(-rr / 4000)) : 5 * Math.exp(-tti / 120);
    return { label: ent.cls, purity, entityId: best, threat: thr, oracle, trueRange: rr, trueTti: Math.min(tti, 1e4) };
}
export const CLASS_INDEX = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
