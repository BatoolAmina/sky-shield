import { Rng } from './rng.js';
import { Session } from './session.js';
import { TACTICS, isThreatClass } from './types.js';

/** Tactic library: how an adversary group approaches. Expressed as scenario spawn events. */
export function tacticEvents(tactic, seed) {
  const r = Rng.stream(seed, 'tactic'), b0 = r.uniform(0, 360), at = (a, spec) => ({ at: a, spec });
  switch (tactic) {
    case 'direct': return [at(0, { kind: 'fast', brgDeg: b0, range: r.uniform(4000, 6000) }), at(6, { kind: 'fast', brgDeg: b0 + r.uniform(-20, 20), range: r.uniform(4000, 6000) })];
    case 'flank': return [at(0, { kind: 'fast', tactic: 'flank', brgDeg: b0, range: r.uniform(4500, 6000) }), at(5, { kind: 'fast', tactic: 'flank', brgDeg: b0 + 30, range: r.uniform(4500, 6000) })];
    case 'low_altitude': return [at(0, { kind: 'low', brgDeg: b0, range: r.uniform(2800, 3800) }), at(0, { kind: 'low', brgDeg: b0 + 120, range: r.uniform(2800, 3800) }), at(4, { kind: 'fast', lowAlt: true, brgDeg: b0 + 240, range: 4500 })];
    case 'decoy_split': return [at(0, { kind: 'surveillance', decoy: true, brgDeg: b0, range: 3500 }), at(0, { kind: 'surveillance', decoy: true, brgDeg: b0 + 140, range: 3500 }), at(6, { kind: 'fast', tactic: 'flank', brgDeg: b0 + 200, range: 5000 })];
    case 'saturation': return Array.from({ length: 6 }, (_, k) => at(k * 1, { kind: 'fast', brgDeg: b0 + 60 * k, range: r.uniform(4200, 6000) }));
    default: throw new Error(`unknown tactic ${tactic}`);
  }
}
export const BACKGROUND = [{ at: 0, spec: { kind: 'bird', n: 3 } }, { at: 2, spec: { kind: 'bird', n: 2 } }, { at: 5, spec: { kind: 'friendly' } }];

export const DEFENCES = {
  balanced: { maxConcurrent: 2, effMult: 0.55 },
  north_heavy: { maxConcurrent: 3, effMult: 0.8, sectorCenterDeg: 0, sectorWidthDeg: 120, sectorMultIn: 1.2, sectorMultOut: 0.3 },
  low_blind: { maxConcurrent: 3, effMult: 0.7, lowAltMult: 0.2 },
  capacity_limited: { maxConcurrent: 1, effMult: 0.7 },
};

/** Scripted heuristic defender (no ML): used to evaluate adversary adaptation. Acts through the same Session API as a trainee. */
export class ScriptedDefender {
  act(s) {
    const tracks = s.perceived().tracks;
    const threats = tracks.map((p) => ({ p, rr: (p.x * p.vx + p.y * p.vy) / Math.max(p.range, 1) }))
      .filter(({ p, rr }) => !p.iff && (p.rf || (rr < -5 && p.z < 400 && p.speed > 8))).sort((a, b) => a.p.range - b.p.range);
    for (const { p } of threats) {
      if (p.classified !== 'threat') s.act({ type: 'classify', trackId: p.id, cls: 'threat' });
      if (p.range < 3600 && !s.fx.escalated(s.t)) s.act({ type: 'respond', trackId: p.id, response: 'escalate' });
      if (p.responses.length >= 2 && p.responses.at(-1) !== 'intercept' && p.range > 2500) continue;
      const last = p.responses.at(-1);
      if (p.range <= 2450) { if (last !== 'intercept' || s.t % 6 < 1) s.act({ type: 'respond', trackId: p.id, response: 'intercept' }); }
      else if (p.range <= 3400 && p.rf && last !== 'ecm') s.act({ type: 'respond', trackId: p.id, response: 'ecm' });
    }
  }
}

/** One adversary episode against a scripted defender; success = at least one threat reached the asset. */
export function runEpisode({ seed, tactic, defence }) {
  const scenario = { id: `ep-${tactic}`, name: 'episode', brief: '', difficulty: 3, durationS: 220, events: [...BACKGROUND, ...tacticEvents(tactic, seed)] };
  const s = new Session({ seed, scenario, defence: DEFENCES[defence] }), d = new ScriptedDefender();
  while (!s.over) { d.act(s); s.step(20); }
  const th = s.world.entities.filter((e) => isThreatClass(e.cls));
  return { success: s.world.events.some((e) => e.type === 'impact') ? 1 : 0, impacts: s.world.events.filter((e) => e.type === 'impact').length, threats: th.length, neutralised: th.filter((e) => e.status === 'neutralised').length };
}

/** Multi-armed bandits for tactic selection. 'dts' = discounted Thompson sampling (non-stationary). */
export class Bandit {
  constructor(kind, rng, opts = {}) {
    this.kind = kind; this.rng = rng; this.arms = opts.arms ?? [...TACTICS]; this.gamma = opts.gamma ?? 0.95; this.eps = opts.eps ?? 0.1; this.fixed = opts.fixed ?? this.arms[0];
    this.a = this.arms.map(() => 1); this.b = this.arms.map(() => 1); this.n = this.arms.map(() => 0); this.sum = this.arms.map(() => 0); this.t = 0;
  }
  select() {
    this.t++; const K = this.arms.length;
    if (this.kind === 'uniform') return this.rng.int(0, K - 1);
    if (this.kind === 'fixed') return this.arms.indexOf(this.fixed);
    if (this.kind === 'eps') { if (this.rng.next() < this.eps) return this.rng.int(0, K - 1); return this.argmax(this.arms.map((_, i) => (this.n[i] ? this.sum[i] / this.n[i] : 1))); }
    if (this.kind === 'ucb') { const u = this.n.findIndex((x) => x === 0); if (u >= 0) return u; return this.argmax(this.arms.map((_, i) => this.sum[i] / this.n[i] + Math.sqrt((2 * Math.log(this.t)) / this.n[i]))); }
    return this.argmax(this.arms.map((_, i) => this.rng.beta(this.a[i], this.b[i])));   // ts / dts
  }
  update(i, r) {
    this.n[i]++; this.sum[i] += r;
    if (this.kind === 'dts') for (let k = 0; k < this.arms.length; k++) { this.a[k] = 1 + this.gamma * (this.a[k] - 1); this.b[k] = 1 + this.gamma * (this.b[k] - 1); }
    this.a[i] += r; this.b[i] += 1 - r;
  }
  argmax(v) { let b = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[b]) b = i; return b; }
  toJSON() { return { kind: this.kind, arms: this.arms, a: this.a, b: this.b, n: this.n, sum: this.sum, t: this.t, gamma: this.gamma }; }
  static fromJSON(j, rng) { const b = new Bandit(j.kind, rng, { arms: j.arms, gamma: j.gamma }); Object.assign(b, { a: j.a, b: j.b, n: j.n, sum: j.sum, t: j.t }); return b; }
}
