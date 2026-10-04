/** Inference for an exported scikit-learn HistGradientBoosting model (format "skyshield-hgb-v1"). Pure JS, no dependencies. */
export class TreeModel {
  constructor(json) {
    this.meta = json; this.featureNames = json.feature_names; this.classes = json.classes; this.K = json.classes.length;
    this.baseline = json.baseline; this.trees = json.trees; this.temperature = json.temperature ?? 1;
    this.stats = json.feature_stats ?? {}; this.threatIdx = json.threat_class_idx ?? [0, 1, 2, 3]; this.threatThreshold = json.threat_threshold ?? 0.5; this.unknownThreshold = json.unknown_maxprob_threshold ?? null;
  }
  static treeValue(tr, x) {
    let i = 0;
    while (!tr.leaf[i]) {
      const v = x[tr.feat[i]];
      i = Number.isNaN(v) ? (tr.mgl[i] ? tr.left[i] : tr.right[i]) : v <= tr.thr[i] ? tr.left[i] : tr.right[i];
    }
    return tr.val[i];
  }
  /** Raw (log-odds) scores, one per class. */
  raw(x) {
    const out = Float64Array.from(this.baseline);
    for (const tr of this.trees) out[tr.k] += TreeModel.treeValue(tr, x);
    return out;
  }
  proba(x, temperature = this.temperature) {
    const r = this.raw(x); const z = Array.from(r, (v) => v / temperature); const m = Math.max(...z);
    const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / s);
  }
  threatProb(p) { return this.threatIdx.reduce((a, i) => a + p[i], 0); }
  predict(x) { const p = this.proba(x); let b = 0; for (let i = 1; i < p.length; i++) if (p[i] > p[b]) b = i; return { cls: b, label: this.classes[b], probs: p, threat: this.threatProb(p) }; }
}
