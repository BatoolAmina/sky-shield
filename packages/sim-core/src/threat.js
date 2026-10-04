import { readFileSync } from 'node:fs';
import { zoneOfRange } from './types.js';
export const SCORER = JSON.parse(readFileSync(new URL('./model/scorer.json', import.meta.url), 'utf8'));

/** Rule-based hybrid threat score (0-100): classifier threat probability + time to closest approach + zone + distance + group behaviour. */
export function scoreComponents(f, names, pThreat) {
  const g = (n) => f[names.indexOf(n)];
  const tcpa = g('time_to_cpa'), cpa = g('cpa_dist'), range = g('range_to_asset');
  const urgency = Math.exp(-tcpa / 60) * (cpa < 1500 ? 1 : Math.exp(-(cpa - 1500) / 2500));
  return { threat: pThreat, time: urgency, zone: SCORER.zone_values[zoneOfRange(range)], dist: Math.exp(-range / 4000), group: g('group_score') };
}
export function threatScore(f, names, pThreat) {
  const c = scoreComponents(f, names, pThreat), w = SCORER.weights;
  const s = 100 * (w.threat * c.threat + w.time * c.time + w.zone * c.zone + w.dist * c.dist + w.group * c.group);
  return { score: s, parts: c };
}

/** Deterministic mentor recommendation (sits ABOVE the ML output so every suggestion is traceable). Returns { action, reason }. */
export function recommendAction({ threat, thr = 0.5, range, confidence, iff, rf, escalated, classifiedThreat, unknown = false }) {
  const pct = `${Math.round(threat * 100)}%`;
  let r;
  if (iff) r = { action: 'monitor', reason: 'it answers transponder queries, so it is probably friendly or civil traffic' };
  else if (unknown && threat < thr) r = { action: 'monitor', reason: 'the model is unsure what this is: keep watching and look for RF, transponder or camera confirmation' };
  else if (threat < thr) r = { action: 'monitor', reason: `threat probability ${pct} is below the alert threshold` };
  else if (range > 4000) r = { action: 'monitor', reason: `likely threat (${pct}) but still outside the warning zone: keep tracking and prepare` };
  else if (range > 3500) r = { action: 'warn', reason: `likely threat (${pct}) inside the warning zone: hail it first` };
  else if (range > 2500) r = rf ? { action: 'ecm', reason: `likely threat (${pct}) with RF emission inside countermeasure range` } : escalated ? { action: 'warn', reason: `likely threat (${pct}) without RF emission: countermeasures are unlikely to work, keep warning while it closes` } : { action: 'escalate', reason: `likely threat (${pct}) without RF emission: escalate readiness before it reaches intercept range` };
  else if (confidence < 0.5) r = { action: 'escalate', reason: `likely threat (${pct}) but track confidence is only ${confidence.toFixed(2)}: intercept needs 0.5` };
  else if (range > 1500 && !escalated) r = { action: 'escalate', reason: 'rules of engagement require escalated readiness before intercepting outside the restricted zone' };
  else if (threat >= 0.8) r = { action: 'intercept', reason: `high threat probability (${pct}) inside intercept range with adequate track confidence` };
  else r = rf ? { action: 'ecm', reason: `threat probability ${pct} is not high enough for intercept: use a countermeasure` } : { action: 'escalate', reason: `threat probability ${pct} is not high enough for intercept` };
  if ((r.action === 'ecm' || r.action === 'intercept') && !classifiedThreat) r.reason += ' (classify it as a threat first)';
  return r;
}
