import { CLASS_LABEL, isThreatClass } from './types.js';
const pct = (x) => `${Math.round(x * 100)}%`;

/** Template-based after-action review (no LLM): a timeline from the action log + ground truth, with targeted lessons. */
export function buildAAR(s, score) {
  const tl = [], lessons = [];
  for (const e of s.world.events) {
    if (e.type === 'spawn' && isThreatClass(e.cls)) tl.push({ t: e.t, tone: 'info', text: `A ${CLASS_LABEL[e.cls].toLowerCase()} (entity ${e.entityId}) entered the scenario.` });
    if (e.type === 'impact') tl.push({ t: e.t, tone: 'bad', text: `A ${CLASS_LABEL[e.cls].toLowerCase()} reached the protected asset.` });
    if (e.type === 'neutralised') tl.push({ t: e.t, tone: 'good', text: `A ${CLASS_LABEL[e.cls].toLowerCase()} was neutralised.` });
    if (e.type === 'aborted' && isThreatClass(e.cls)) tl.push({ t: e.t, tone: 'good', text: `A ${CLASS_LABEL[e.cls].toLowerCase()} aborted its approach.` });
  }
  for (const l of s.log) {
    if (l.kind === 'action' && l.action.type === 'classify' && l.result) {
      const r = l.result, m = r.mentor ? ` Mentor estimated ${pct(r.mentor.threat)} threat probability.` : '';
      tl.push({ t: l.t, tone: r.correct ? 'good' : 'bad', text: `You classified T${l.action.trackId} as ${l.action.cls}. Truth: ${r.truthCls === 'clutter' ? 'false alarm' : CLASS_LABEL[r.truthCls]} - ${r.correct ? 'correct' : 'incorrect'}.${m}` });
      if (!r.correct && r.truthThreat) lessons.push(`T${l.action.trackId} was a real ${CLASS_LABEL[r.truthCls].toLowerCase()} that you did not flag as a threat. Check radar signature, RF presence and whether the heading converges on the asset.`);
      if (!r.correct && !r.truthThreat) lessons.push(`T${l.action.trackId} (${r.truthCls === 'clutter' ? 'a false alarm' : CLASS_LABEL[r.truthCls].toLowerCase()}) was not a threat. A transponder reply or irregular motion without RF is usually benign.`);
    }
    if (l.kind === 'action' && l.action.type === 'respond' && l.result?.denied) { tl.push({ t: l.t, tone: 'warn', text: `${l.action.response} on T${l.action.trackId} was denied: ${l.result.denied}.` }); lessons.push(`Rules of engagement blocked "${l.action.response}": ${l.result.denied}.`); }
    if (l.kind === 'response_result') tl.push({ t: l.t, tone: l.outcome === 'collateral' ? 'bad' : l.outcome === 'failed' || l.outcome === 'no_target' ? 'warn' : 'good', text: `${l.response} on T${l.trackId}: ${l.outcome === 'collateral' ? 'a NON-threat was affected (collateral)' : l.outcome}.` });
    if (l.kind === 'action' && l.action.type === 'mentor' && l.result) tl.push({ t: l.t, tone: 'info', text: `You ${l.result.accepted ? 'accepted' : 'overrode'} the mentor on T${l.action.trackId}.` });
  }
  tl.sort((a, b) => a.t - b.t);
  const st = score.stats;
  if (st.collateral) lessons.push('A non-threat was engaged. Confirm class with a second sensor (transponder/EO) before using intercept.');
  if (st.missedThreats) lessons.push(`${st.missedThreats} threat(s) were never flagged. Prioritise fast closers and tracks with RF emission and no transponder.`);
  if (st.falseAlarms > 1) lessons.push('Several false alarms: birds and civil helicopters can look like slow drones; look for RF emission and group motion.');
  if (!lessons.length) lessons.push('Clean run: no major decision errors detected.');
  const summary = `Score ${score.total}/100. ${st.impacts} of ${st.threats} threats reached the asset; classification accuracy ${pct(st.classificationAccuracy)}; ${st.falseAlarms} false alarm(s); ${st.collateral} collateral event(s).`;
  return { summary, timeline: tl, lessons: [...new Set(lessons)] };
}
