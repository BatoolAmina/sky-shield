import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Session, SCENARIOS, scenarioById, buildAAR, eloUpdate, Bandit, Rng, TACTICS, tacticEvents, CLASSES, RESPONSES } from '../../../../packages/sim-core/src/index.js';

const CLS = new Set(['threat', 'nonthreat', 'unknown', ...CLASSES]), RESP = new Set(Object.keys(RESPONSES));
const isId = (x) => Number.isInteger(x) && x >= 0 && x < 1e9;
/** Whitelist validation of trainee actions (never trust the client). */
export function validateAction(a) {
  if (!a || typeof a !== 'object') return 'bad action';
  if (a.type === 'classify') return isId(a.trackId) && CLS.has(a.cls) ? null : 'bad classify';
  if (a.type === 'respond') return isId(a.trackId) && RESP.has(a.response) ? null : 'bad respond';
  if (a.type === 'mentor') return isId(a.trackId) && typeof a.accept === 'boolean' ? null : 'bad mentor';
  if (a.type === 'prioritise') return Array.isArray(a.order) && a.order.length <= 50 && a.order.every(isId) ? null : 'bad prioritise';
  return 'unknown action type';
}
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));
/** Adaptive difficulty: the Elo rating scales sensor noise, clutter and the number of distractors (time pressure comes from extra arrivals). */
export function difficultyFor(rating) {
  const skill = clampN((rating - 1000) / 400, -1, 1.5), extra = [];
  if (skill > 0.5) extra.push({ at: 15, spec: { kind: 'bird', n: 4 } });
  if (skill > 1) extra.push({ at: 25, spec: { kind: 'civil' } }, { at: 35, spec: { kind: 'bird', n: 3 } });
  return { skill, noiseScale: 1 + 0.15 * skill, clutterScale: 1 + 0.4 * skill, extra };
}
/** Scenario whose nominal opponent rating (800 + 300 x difficulty) is closest to the trainee rating. */
export function recommendScenario(rating) { return [...SCENARIOS].sort((a, b) => Math.abs(800 + 300 * a.difficulty - rating) - Math.abs(800 + 300 * b.difficulty - rating))[0]; }
const isStaff = (u) => u.role === 'instructor' || u.role === 'admin';
const SPAWN_KINDS = new Set(['surveillance', 'fast', 'low', 'swarm', 'bird', 'friendly', 'civil']);

export class SessionManager {
  constructor({ store, model = null, tickMs = 200, ticksPerStep = 4, idleMs = 5 * 60 * 1000 }) { this.store = store; this.model = model; this.tickMs = tickMs; this.ticksPerStep = ticksPerStep; this.idleMs = idleMs; this.live = new Map(); this.dashboardEvents = new EventEmitter(); this.dashboardEvents.setMaxListeners(0); this.progressPushAt = new Map(); }
  subscribeDashboard(listener) { this.dashboardEvents.on('change', listener); return () => this.dashboardEvents.off('change', listener); }
  notifyDashboard(event = {}) {
    const at = Date.now();
    if (event.kind === 'session-progress' && event.userId) {
      if (at - (this.progressPushAt.get(event.userId) ?? 0) < 1000) return;
      this.progressPushAt.set(event.userId, at);
    }
    this.dashboardEvents.emit('change', { at, ...event });
  }

  async create(user, { scenarioId, scenario: configuredScenario, seed, speed = 1, autoRun = true, options = {} }) {
    const baseScenario = scenarioById(scenarioId);
    const sc = configuredScenario?.id === scenarioId ? configuredScenario : baseScenario;
    if (!sc) throw Object.assign(new Error('unknown scenario'), { status: 400 });
    seed = Number.isInteger(seed) ? seed : randomInt(1, 2 ** 31 - 1);
    const fresh = await this.store.findOne('users', { _id: user._id }), diff = difficultyFor(fresh?.rating ?? 1000), ov = { ...(sc.overrides ?? {}) };
    ov.noiseScale = (ov.noiseScale ?? 1) * diff.noiseScale * (isStaff(user) && isFinite(+options.noiseScale) ? clampN(+options.noiseScale, 0.5, 3) : 1);
    ov.clutterScale = (ov.clutterScale ?? 1) * diff.clutterScale * (isStaff(user) && isFinite(+options.clutterScale) ? clampN(+options.clutterScale, 0.5, 8) : 1);
    if (isStaff(user) && isFinite(+options.visibilityScale)) ov.visibilityScale = clampN(+options.visibilityScale, 0.2, 2);
    const cfg = { seed, scenarioId, model: this.model, scenario: { ...sc, overrides: ov }, extraEvents: diff.extra.length ? [...diff.extra] : undefined }; let tactic = null, bandit = null;
    if (sc.adaptive) {
      const rec = await this.store.findOne('bandits', { userId: user._id }); bandit = rec ? Bandit.fromJSON(rec.state, Rng.stream(seed, 'bandit')) : new Bandit('dts', Rng.stream(seed, 'bandit'), { gamma: 0.95 });
      tactic = TACTICS[bandit.select()]; cfg.extraEvents = [...(cfg.extraEvents ?? []), ...tacticEvents(tactic, seed)];
    }
    const id = (await this.store.insert('sessions', { userId: user._id, username: user.username, scenarioId, scenarioName: sc.name, scenarioDifficulty: sc.difficulty, seed, status: 'running', createdAt: Date.now(), tactic })) ._id;
    const live = { id, user, scenarioId, seed, tactic, bandit, cfg, session: new Session(cfg), speed: Math.min(4, Math.max(1, speed)), frames: [], coachNotes: [], lastFrameT: -1, subs: new Set(), obs: new Set(), timer: null, paused: false, finished: false, last: Date.now(), report: null };
    this.live.set(id, live); this.snap(live); this.notifyDashboard({ userId: user._id, kind: 'session-started' }); if (autoRun) this.start(live); return { id, seed, scenarioId, tactic: undefined };
  }
  start(live) { if (live.timer || live.finished) return; live.paused = false; live.timer = setInterval(() => this.tick(live, this.ticksPerStep * live.speed), this.tickMs); live.timer.unref?.(); }
  pause(live) { live.paused = true; if (live.timer) clearInterval(live.timer); live.timer = null; this.broadcast(live); }
  snap(live) { const f = live.session.frame(); if (f.t - live.lastFrameT >= 1 - 1e-6 || live.frames.length === 0) { live.frames.push(f); live.lastFrameT = f.t; } }
  /** Advance n ticks (used by the timer; tests call it directly for deterministic stepping). */
  tick(live, n) {
    if (live.finished) return; live.session.step(n); this.snap(live); this.broadcast(live);
    if (live.session.over) this.finish(live).catch(() => {});
    else if (Date.now() - live.last > this.idleMs && live.subs.size === 0) { live.session.over = true; this.finish(live).catch(() => {}); }
  }
  broadcast(live) {
    const pv = { ...live.session.perceived(), paused: live.paused, speed: live.speed };
    for (const s of live.subs) s({ type: 'frame', data: pv });
    if (live.obs.size) { const truth = live.session.frame().truth; for (const s of live.obs) s({ type: 'frame', data: { ...pv, truth } }); }
    this.notifyDashboard({ userId: live.user._id, kind: 'session-progress' });
  }
  finish(live) { if (!live.finishing) { live.finished = true; live.finishing = this._finish(live); } return live.finishing; }
  async _finish(live) {
    live.finished = true; if (live.timer) clearInterval(live.timer); live.timer = null;
    const s = live.session, score = s.score(), aar = buildAAR(s, score), sc = live.cfg.scenario;
    const u = await this.store.findOne('users', { _id: live.user._id }); let rating = u?.rating ?? 1000;
    const newRating = eloUpdate(rating, sc.difficulty, score.total);
    if (u) await this.store.update('users', u._id, { rating: newRating, history: [...(u.history ?? []), { sessionId: live.id, scenarioId: live.scenarioId, score: score.total, rating: newRating, t: Date.now() }].slice(-100) });
    if (live.bandit) { live.bandit.update(TACTICS.indexOf(live.tactic), s.world.events.some((e) => e.type === 'impact') ? 1 : 0); await this.store.upsert('bandits', { userId: live.user._id }, { state: live.bandit.toJSON() }); }
    live.report = { score, aar, rating: newRating, previousRating: rating, tactic: live.tactic };
    await this.store.update('sessions', live.id, { status: 'finished', finishedAt: Date.now(), score, aar, rating: newRating, log: s.log, frames: live.frames, coachNotes: live.coachNotes, durationS: s.t, impacts: score.stats.impacts, tactic: live.tactic, cfg: { seed: live.seed, scenarioId: live.scenarioId, extraEvents: live.cfg.extraEvents ?? null, overrides: live.cfg.scenario.overrides } });
    for (const sub of [...live.subs, ...live.obs]) sub({ type: 'ended', report: live.report }); this.live.delete(live.id); this.progressPushAt.delete(live.user._id); this.notifyDashboard({ userId: live.user._id, kind: 'session-finished' }); return live.report;
  }
  /** Attach a websocket-like connection. mode 'play' (owner) or 'observe' (instructor). `send` receives JSON-able messages. */
  attach({ user, sessionId, mode = 'play', send }) {
    const live = this.live.get(sessionId); if (!live) { send({ type: 'error', error: 'session not live' }); return null; }
    const isOwner = live.user._id === user._id, isInstr = isStaff(user);
    if (mode === 'play' && !isOwner) { send({ type: 'error', error: 'not your session' }); return null; }
    if (mode === 'observe' && !isInstr) { send({ type: 'error', error: 'instructor only' }); return null; }
    (mode === 'observe' ? live.obs : live.subs).add(send); live.last = Date.now(); this.broadcast(live);
    if (mode === 'play') for (const note of live.coachNotes) send({ type: 'coach', data: note });
    const onMessage = (m) => {
      live.last = Date.now(); if (!m || typeof m !== 'object') return;
      if (m.type === 'action' && isOwner) { const err = validateAction(m.action); if (err) return send({ type: 'ack', ok: false, reason: err }); const r = live.session.act(m.action); send({ type: 'ack', ok: r.ok, reason: r.reason, id: m.id }); this.broadcast(live); }
      else if (m.type === 'explain' && isId(m.trackId)) send({ type: 'explanation', trackId: m.trackId, data: live.session.explainTrack(m.trackId) });
      else if (m.type === 'coach' && isInstr && mode === 'observe') {
        const text = typeof m.text === 'string' ? m.text.trim() : '';
        if (!text || text.length > 400) return send({ type: 'coach-ack', ok: false, reason: 'Coach note must be between 1 and 400 characters.' });
        const note = { t: live.session.t, by: user.displayName || user.username, text };
        live.coachNotes.push(note);
        live.session.log.push({ tick: live.session.tick, t: live.session.t, kind: 'coach_note', by: note.by, text });
        for (const trainee of live.subs) trainee({ type: 'coach', data: note });
        send({ type: 'coach-ack', ok: true });
      }
      else if (m.type === 'cmd') {
        if (m.cmd === 'pause' && (isOwner || isInstr)) this.pause(live); else if (m.cmd === 'resume' && (isOwner || isInstr)) this.start(live);
        else if (m.cmd === 'speed' && (isOwner || isInstr)) { live.speed = Math.min(4, Math.max(1, +m.value || 1)); this.broadcast(live); }
        else if (m.cmd === 'inject' && isInstr && SPAWN_KINDS.has(m.spec?.kind)) { live.session.inject({ kind: m.spec.kind, n: Math.min(8, +m.spec.n || undefined), range: Math.min(8800, Math.max(1500, +m.spec.range || 6000)), brgDeg: isFinite(+m.spec.brgDeg) ? +m.spec.brgDeg : undefined }); this.broadcast(live); }
        else if (m.cmd === 'defence' && isInstr) { const d = {}; for (const k of ['maxConcurrent', 'effMult']) if (isFinite(+m.mods?.[k])) d[k] = +m.mods[k]; live.session.setDefence(d); }
        else if (m.cmd === 'difficulty' && isInstr) { live.session.setDifficulty(clampN(+m.level || 3, 1, 5)); this.broadcast(live); }
        else if (m.cmd === 'sensor' && isInstr && ['radar', 'rf', 'eo'].includes(m.sensor)) { live.session.setSensor(m.sensor, !!m.on); this.broadcast(live); }
        else if (m.cmd === 'end' && isOwner) { live.session.over = true; this.finish(live).catch(() => {}); }
      }
    };
    return { onMessage, close: () => { live.subs.delete(send); live.obs.delete(send); } };
  }
  liveList() { return [...this.live.values()].map((l) => ({ id: l.id, username: l.user.username, scenarioId: l.scenarioId, scenarioName: l.cfg.scenario.name, t: l.session.t, paused: l.paused })); }
}
