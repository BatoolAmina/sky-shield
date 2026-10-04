import { createWorld, ScenarioEngine } from './engine.js';
import { Perception } from './perception.js';
import { extractFeatures, FEATURE_NAMES, windowTruth } from './features.js';
import { EffectsEngine, roeCheck } from './effects.js';
import { threatScore, recommendAction } from './threat.js';
import { scenarioById } from './scenario.js';
import { spawnGroup } from './spawn.js';
import { explain } from './model/explain.js';
import { isThreatClass, ZONES } from './types.js';
import { computeScore } from './scoring.js';

/** One training session. Deterministic: (config, action log) fully reproduces it. The perceived picture NEVER contains ground truth. */
export class Session {
  constructor(cfg) {
    this.cfg = cfg;
    const base = cfg.scenario ?? scenarioById(cfg.scenarioId);
    if (!base) throw new Error(`unknown scenario ${cfg.scenarioId}`);
    this.def = cfg.extraEvents ? { ...base, events: [...base.events, ...cfg.extraEvents] } : base;
    this.seed = cfg.seed; this.model = cfg.model ?? null;
    this.world = createWorld(cfg.seed, cfg.profile ?? 'train', this.def.overrides ?? {}, this.def.durationS, cfg.defence);
    this.engine = new ScenarioEngine(this.def); this.per = new Perception(cfg.seed, this.world.cfg.cond, 'kf'); this.fx = new EffectsEngine(this.world, cfg.seed);
    this.log = []; this.tick = 0; this.over = false; this.nextMentorT = 0; this.assess = new Map(); this.tstate = new Map(); this.firstSeen = new Map();
    this.liveScore = 0; this.baseCond = { noise: this.world.cfg.cond.noise, clutter: this.world.cfg.cond.clutterRate }; this.flags = { firstWaveClearedEarly: false }; this.feed = []; this.zoneLast = new Map(); this.seen = new Set(); this.explainCache = new Map(); this.results = [];
  }
  get t() { return this.world.t; }
  state(id) { let s = this.tstate.get(id); if (!s) { s = { cls: null, classifiedThreat: false, responses: [] }; this.tstate.set(id, s); } return s; }
  trackById(id) { return this.per.confirmed().find((t) => t.id === id); }
  truthOf(id) {
    const tr = this.per.tracks.find((t) => t.id === id); if (!tr) return null;
    const cnt = new Map(); tr.history.filter((s) => s.hit).slice(-6).forEach((s) => cnt.set(s.truth, (cnt.get(s.truth) ?? 0) + 1));
    let best = -2, bc = 0; cnt.forEach((c, k) => { if (c > bc) { bc = c; best = k; } });
    return best >= 0 ? this.world.truthById(best) ?? null : null;
  }
  step(n = 1) {
    for (let i = 0; i < n && !this.over; i++) {
      const w = this.world;
      this.engine.step(w, this.flags); this.per.tick(w);
      for (const r of this.fx.step(w.t)) { this.results.push(r); this.log.push({ tick: this.tick, ...r }); }
      if (w.t + 1e-9 >= this.nextMentorT) { this.nextMentorT += 1; this.bookkeeping(); }
      w.step(); this.tick++; this.checkEnd();
    }
  }
  bookkeeping() {
    const w = this.world, conf = this.per.confirmed();
    if (!this.flags.firstWaveClearedEarly && w.t < 45) {
      const th = w.entities.filter((e) => isThreatClass(e.cls));
      if (th.length && th.every((e) => e.status !== 'active')) this.flags.firstWaveClearedEarly = true;
    }
    const pv = this.per.perceived(w.t);
    for (const tr of conf) {
      const p = pv.find((x) => x.id === tr.id);
      if (!this.seen.has(tr.id)) { this.seen.add(tr.id); this.feed.push({ t: w.t, text: `New track T${tr.id} confirmed`, tone: 'info' }); }
      if (p && this.zoneLast.get(tr.id) !== p.zone) { if (this.zoneLast.has(tr.id) || p.zone !== 'safe') this.feed.push({ t: w.t, text: `T${tr.id} entered ${p.zone} zone`, tone: p.zone === 'restricted' ? 'alert' : p.zone === 'warning' ? 'warn' : 'info' }); this.zoneLast.set(tr.id, p.zone); }
      const ent = this.truthOf(tr.id); if (ent && !this.firstSeen.has(ent.id)) this.firstSeen.set(ent.id, w.t);
      if (this.model) {
        const f = extractFeatures(tr, w.t, conf); if (!f) continue;
        const pr = this.model.predict(f), sc = threatScore(f, FEATURE_NAMES, pr.threat);
        this.assess.set(tr.id, { t: w.t, f, label: pr.label, probs: pr.probs, threat: pr.threat, score: sc.score, parts: sc.parts });
      }
    }
    this.liveScore = this.score().total;
    if (this.feed.length > 60) this.feed.splice(0, this.feed.length - 60);
  }
  checkEnd() {
    const w = this.world, d = this.def;
    if (w.t >= d.durationS - 1e-9) { this.over = true; return; }
    if (w.t > 20) {
      const active = w.entities.filter((e) => isThreatClass(e.cls) && e.status === 'active').length;
      const plain = d.events.filter((e) => !e.when).length, firedPlain = [...this.engine.fired].filter((i) => !d.events[i].when).length;
      const condPending = d.events.some((e, i) => e.when && !this.engine.fired.has(i)) && w.t < 60;
      if (active === 0 && firedPlain >= plain && !condPending) this.over = true;
    }
  }
  perceived() {
    const w = this.world;
    const tracks = this.per.perceived(w.t).map((p) => {
      const a = this.assess.get(p.id), s = this.state(p.id);
      const unk = a && this.model?.unknownThreshold != null ? Math.max(...a.probs) < this.model.unknownThreshold : false;
      const rec = a ? recommendAction({ threat: a.threat, thr: this.model?.threatThreshold ?? 0.5, range: p.range, confidence: p.confidence, iff: p.iff, rf: p.rf, escalated: this.fx.escalated(w.t), classifiedThreat: s.classifiedThreat, unknown: unk }) : null;
      return { ...p, mentor: a ? { label: a.label, probs: a.probs, threat: a.threat, score: a.score, parts: a.parts, unknown: unk, recommended: rec } : null, classified: s.cls, responses: s.responses };
    });
    return { t: w.t, tick: this.tick, over: this.over, duration: this.def.durationS, tracks, zones: { restricted: ZONES.restricted, warning: ZONES.warning, outer: ZONES.outer }, feed: this.feed.slice(-12),
      score: this.liveScore, sensors: { radar: !this.per.radarDown(w.t), rf: w.cfg.cond.rfEnabled, eo: w.cfg.cond.eoEnabled }, escalated: this.fx.escalated(w.t), inFlight: this.fx.inFlight(), capacity: w.cfg.defence.maxConcurrent, impacts: w.events.filter((e) => e.type === 'impact').length };
  }
  explainTrack(id) {
    const a = this.assess.get(id); if (!a || !this.model) return null;
    const key = `${id}:${Math.floor(a.t / 3)}`; if (!this.explainCache.has(key)) this.explainCache.set(key, explain(this.model, a.f, 3));
    const e = this.explainCache.get(key); return { sentence: e.sentence, top: e.top, label: e.label, probs: e.probs };
  }
  act(a) {
    const w = this.world, entry = { tick: this.tick, t: w.t, kind: 'action', action: a };
    const p = this.per.perceived(w.t).find((x) => x.id === a.trackId), tr = this.trackById(a.trackId);
    let ret = { ok: true };
    if (a.type === 'prioritise') {
      const ranks = (a.order ?? []).map((id) => { const t = this.trackById(id); return t ? windowTruth(t, w.t, w).oracle : 0; });
      entry.result = { oracle: ranks }; 
    } else if (!tr || !p) ret = { ok: false, reason: 'no such track' };
    else if (a.type === 'classify') {
      const ent = this.truthOf(tr.id), s = this.state(tr.id), m = this.assess.get(tr.id);
      s.cls = a.cls; s.classifiedThreat = a.cls === 'threat' || isThreatClass(a.cls);
      const truthThreat = ent ? isThreatClass(ent.cls) : false, unknown = a.cls === 'unknown';
      entry.result = { entityId: ent ? ent.id : -1, truthCls: ent ? ent.cls : 'clutter', truthThreat, traineeThreat: s.classifiedThreat, unknown, correct: unknown ? !ent : s.classifiedThreat === truthThreat, exact: ent ? ent.cls === a.cls : false,
        mentor: m ? { label: m.label, threat: m.threat } : null };
    } else if (a.type === 'respond') {
      const s = this.state(tr.id), chk = roeCheck(a.response, p, { classifiedThreat: s.classifiedThreat, escalated: this.fx.escalated(w.t) });
      if (!chk.ok) { entry.result = { denied: chk.reason }; ret = { ok: false, reason: chk.reason }; this.feed.push({ t: w.t, text: `ROE: ${chk.reason}`, tone: 'warn' }); }
      else { const ent = this.truthOf(tr.id), r = this.fx.request(w.t, a.response, tr.id, ent ? ent.id : -1); entry.result = r.ok ? { eta: r.eta ?? 0, entityId: ent ? ent.id : -1 } : { denied: r.reason }; if (r.ok) s.responses.push(a.response); else { ret = { ok: false, reason: r.reason }; this.feed.push({ t: w.t, text: r.reason, tone: 'warn' }); } }
    } else if (a.type === 'mentor') {
      const m = this.assess.get(tr.id), ent = this.truthOf(tr.id);
      entry.result = { accepted: !!a.accept, mentorThreat: m ? m.threat >= (this.model?.threatThreshold ?? 0.5) : null, truthThreat: ent ? isThreatClass(ent.cls) : false };
    }
    this.log.push(entry); return ret;
  }
  /** Instructor: live difficulty 1-5 (scales sensor noise and clutter). */
  setDifficulty(level) {
    const L = Math.min(5, Math.max(1, Math.round(level))), c = this.world.cfg.cond; c.noise = this.baseCond.noise * (0.7 + 0.2 * (L - 1)); c.clutterRate = this.baseCond.clutter * (0.5 + 0.5 * (L - 1));
    this.log.push({ tick: this.tick, t: this.t, kind: 'difficulty', level: L });
  }
  /** Instructor: sensor failure injection. radar: 45 s outage; rf/eo: switched off/on. */
  setSensor(sensor, on) {
    const c = this.world.cfg.cond;
    if (sensor === 'radar') { if (!on) c.radarOutages.push([this.t, this.t + 45]); } else if (sensor === 'rf') c.rfEnabled = !!on; else if (sensor === 'eo') c.eoEnabled = !!on; else return;
    this.log.push({ tick: this.tick, t: this.t, kind: 'sensor', sensor, on: !!on });
    this.feed.push({ t: this.t, text: `${sensor.toUpperCase()} ${on ? 'restored' : 'FAILED'}`, tone: on ? 'info' : 'alert' });
  }
  inject(spec) { spawnGroup(this.world, spec); this.log.push({ tick: this.tick, t: this.t, kind: 'inject', spec }); }
  setDefence(mods) { Object.assign(this.world.cfg.defence, mods); this.log.push({ tick: this.tick, t: this.t, kind: 'defence', mods }); }
  frame() {
    const w = this.world;
    return { t: w.t, tracks: this.per.perceived(w.t).map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), zone: p.zone })),
      truth: w.entities.filter((e) => e.status === 'active' || e.status === 'aborted').map((e) => ({ id: e.id, cls: e.cls, x: Math.round(e.pos.x), y: Math.round(e.pos.y), z: Math.round(e.pos.z), status: e.status })) };
  }
  score() { return computeScore(this); }
  static replay(cfg, log) {
    const s = new Session(cfg);
    for (const e of [...log].filter((l) => l.kind === 'action' || l.kind === 'inject' || l.kind === 'defence' || l.kind === 'difficulty' || l.kind === 'sensor').sort((a, b) => a.tick - b.tick)) {
      while (s.tick < e.tick && !s.over) s.step(1);
      if (e.kind === 'action') s.act(e.action); else if (e.kind === 'inject') s.inject(e.spec); else if (e.kind === 'difficulty') s.setDifficulty(e.level); else if (e.kind === 'sensor') s.setSensor(e.sensor, e.on); else s.setDefence(e.mods);
    }
    while (!s.over) s.step(1);
    return s;
  }
}
