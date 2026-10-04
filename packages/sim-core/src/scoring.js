import { isThreatClass } from './types.js';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function kendallOrder(oracle) {            // trainee order is highest-priority first; compare with oracle priorities
  let c = 0, d = 0; for (let i = 0; i < oracle.length; i++) for (let j = i + 1; j < oracle.length; j++) { if (oracle[i] > oracle[j]) c++; else if (oracle[i] < oracle[j]) d++; }
  return c + d ? (c - d) / (c + d) : 0;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Session score 0-100 with a transparent breakdown. Ground truth is used here (server-side, after the fact). */
export function computeScore(s) {
  const w = s.world, threats = w.entities.filter((e) => isThreatClass(e.cls));
  const impacts = w.events.filter((e) => e.type === 'impact').length;
  const cls = s.log.filter((l) => l.kind === 'action' && l.action.type === 'classify' && l.result);
  const acc = cls.length ? mean(cls.map((c) => (c.result.correct ? 1 : 0))) : 0;
  const firstCorrect = new Map();
  for (const c of cls) if (c.result.entityId >= 0 && c.result.truthThreat && c.result.traineeThreat && !firstCorrect.has(c.result.entityId)) firstCorrect.set(c.result.entityId, c.t);
  const seen = threats.filter((e) => s.firstSeen.has(e.id));
  const delays = seen.map((e) => (firstCorrect.has(e.id) ? Math.max(0, firstCorrect.get(e.id) - s.firstSeen.get(e.id)) : null));
  const timeliness = seen.length ? mean(delays.map((d) => (d === null ? 0 : Math.exp(-d / 20)))) : 0;
  const nonThreatCls = cls.filter((c) => !c.result.truthThreat), falseAlarms = nonThreatCls.filter((c) => c.result.traineeThreat).length;
  const faRate = nonThreatCls.length ? falseAlarms / nonThreatCls.length : 0;
  const denied = s.log.filter((l) => l.kind === 'action' && l.result && l.result.denied).length;
  const collateral = s.results.filter((r) => r.outcome === 'collateral').length;
  const missed = seen.filter((e) => !firstCorrect.has(e.id)).length;
  const protect = threats.length ? 1 - impacts / threats.length : 1;
  const roe = clamp(1 - 0.25 * denied - 0.75 * collateral, 0, 1);
  const pri = s.log.filter((l) => l.kind === 'action' && l.action.type === 'prioritise' && l.result?.oracle?.length >= 2);
  const priTau = pri.length ? mean(pri.map((p) => kendallOrder(p.result.oracle))) : null, prioritisation = priTau === null ? 0 : 5 * ((priTau + 1) / 2);
  const raw = 35 * protect + 25 * acc + 10 * timeliness + 10 * (1 - faRate) + 15 * roe + prioritisation;
  const total = priTau === null ? (raw * 100) / 95 : raw;            // prioritisation is only scored if the trainee used it
  const mentor = s.log.filter((l) => l.kind === 'action' && l.action.type === 'mentor' && l.result);
  const mentorRight = mentor.filter((m) => m.result.mentorThreat === m.result.truthThreat);
  const trustCorrect = mentor.filter((m) => (m.result.accepted ? m.result.mentorThreat === m.result.truthThreat : m.result.mentorThreat !== m.result.truthThreat)).length;
  return {
    total: Math.round(total * 10) / 10, parts: { protect: 35 * protect, classification: 25 * acc, timeliness: 10 * timeliness, falseAlarm: 10 * (1 - faRate), roe: 15 * roe, prioritisation },
    stats: { unknownCalls: cls.filter((c) => c.action?.cls === 'unknown' || c.result.unknown).length, prioritisationKendallTau: priTau, threats: threats.length, impacts, classifications: cls.length, classificationAccuracy: acc, falseAlarms, missedThreats: missed, meanDetectionDelayS: mean(delays.filter((d) => d !== null)), roeDenials: denied, collateral,
      mentorDecisions: mentor.length, mentorAdviceCorrect: mentorRight.length, appropriateTrust: mentor.length ? trustCorrect / mentor.length : null },
  };
}
export function eloUpdate(rating, difficulty, scoreTotal, K = 32) {
  const opp = 800 + 300 * difficulty, expected = 1 / (1 + Math.pow(10, (opp - rating) / 400)), actual = scoreTotal / 100;
  return Math.round(rating + K * (actual - expected));
}
