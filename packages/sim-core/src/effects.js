import { Rng, clamp } from './rng.js';
import { ZONES, isThreatClass } from './types.js';

/** Abstract response layer: probabilities and delays only (no weapon-specific modelling). Illustrative parameters. */
export const RESPONSES = {
  monitor: { delay: 0, label: 'Monitor' }, warn: { delay: 1, label: 'Warn / hail' }, escalate: { delay: 0, label: 'Escalate readiness' },
  ecm: { delay: 3, label: 'Electronic countermeasure' }, intercept: { delay: 4, label: 'Intercept' },
};
export function roeCheck(response, track, st) {
  if (response === 'monitor') return { ok: true };
  if (!track) return { ok: false, reason: 'unknown track' };
  if (response === 'escalate') return { ok: true };
  if (response === 'warn') return track.range <= ZONES.warning ? { ok: true } : { ok: false, reason: 'target is outside the warning zone' };
  if (!st.classifiedThreat) return { ok: false, reason: 'classify the track as a threat before engaging' };
  if (response === 'ecm') return track.range <= 3500 ? { ok: true } : { ok: false, reason: 'out of countermeasure range (3.5 km)' };
  if (response === 'intercept') {
    if (track.range > 2500) return { ok: false, reason: 'out of intercept range (2.5 km)' };
    if (track.confidence < 0.5) return { ok: false, reason: 'track confidence below 0.5' };
    if (track.range > ZONES.restricted && !st.escalated) return { ok: false, reason: 'outside restricted zone: escalate readiness first' };
    return { ok: true };
  }
  return { ok: false, reason: 'unknown response' };
}
export class EffectsEngine {
  constructor(world, seed) { this.w = world; this.rng = Rng.stream(seed, 'effects'); this.queue = []; this.escalatedUntil = -1; }
  escalated(t) { return t < this.escalatedUntil; }
  inFlight() { return this.queue.filter((q) => q.response === 'ecm' || q.response === 'intercept').length; }
  request(t, response, trackId, targetEntityId) {
    const d = this.w.cfg.defence;
    if ((response === 'ecm' || response === 'intercept') && this.inFlight() >= d.maxConcurrent) return { ok: false, reason: `engagement capacity reached (${d.maxConcurrent})` };
    if (response === 'escalate') { this.escalatedUntil = t + 30; return { ok: true, events: [{ t, kind: 'escalated' }] }; }
    const delay = RESPONSES[response].delay * (this.escalated(t) ? 0.7 : 1);
    this.queue.push({ due: t + delay, response, trackId, entityId: targetEntityId });
    const e = this.w.truthById(targetEntityId); if (e && (response === 'intercept' || response === 'ecm')) e.engaged = 8;
    return { ok: true, eta: delay };
  }
  step(t) {
    const out = [], rest = [];
    for (const q of this.queue) { if (q.due <= t + 1e-9) out.push(this.resolve(t, q)); else rest.push(q); }
    this.queue = rest; return out;
  }
  resolve(t, q) {
    const e = this.w.truthById(q.entityId), base = { t, kind: 'response_result', trackId: q.trackId, response: q.response, entityId: q.entityId };
    if (!e || e.status !== 'active') return { ...base, outcome: 'no_target' };
    const r = this.w.rangeOf(e), d = this.w.cfg.defence, threat = isThreatClass(e.cls);
    const brg = ((Math.atan2(e.pos.x, e.pos.y) * 180) / Math.PI + 360) % 360;
    let dAng = Math.abs(brg - d.sectorCenterDeg); if (dAng > 180) dAng = 360 - dAng;
    let mod = dAng <= d.sectorWidthDeg / 2 ? d.sectorMultIn : d.sectorMultOut;
    if (e.pos.z < 40) mod *= d.lowAltMult;
    let p = 0, res = 'aborted';
    if (q.response === 'warn') p = e.cls === 'surveillance_drone' ? 0.25 : threat ? 0.06 : e.cls === 'bird' ? 0.1 : 0.02;
    if (q.response === 'ecm') {
      if (r < 300 || r > 3500) p = 0.02; else { p = (e.emits ? 0.7 : 0.1) * (1 - 0.5 * clamp((r - 1500) / 2000, 0, 1)); if (e.cls === 'swarm_member') p *= 0.8; if (!threat) p = 0; }
      p = clamp(p * (mod > 1 ? 1 : mod < 1 ? 0.8 + 0.2 * mod : 1), 0, 0.95);
    }
    if (q.response === 'intercept') {
      if (r < 200 || r > 2500) p = 0.02; else { p = 0.8 * (e.speed > 35 ? 0.6 : e.speed > 25 ? 0.8 : 1); p = clamp(p * mod, 0, 0.95); }
      res = 'neutralised';
    }
    if (q.response === 'ecm' && this.rng.bernoulli(0.4)) res = 'neutralised';
    p = clamp(p * (d.effMult ?? 1), 0, 0.95);
    if (!this.rng.bernoulli(p)) return { ...base, outcome: 'failed', p };
    e.status = res === 'neutralised' ? 'neutralised' : 'aborted';
    this.w.events.push({ t, type: res === 'neutralised' ? 'neutralised' : 'aborted', entityId: e.id, cls: e.cls });
    return { ...base, outcome: threat ? res : 'collateral', p, cls: e.cls };
  }
}
