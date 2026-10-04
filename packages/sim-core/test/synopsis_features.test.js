import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, recommendAction, windowTruth, isThreatClass } from '../src/index.js';

const base = { threat: 0.95, thr: 0.14, range: 2000, confidence: 0.8, iff: false, rf: true, escalated: true, classifiedThreat: true };
test('recommended action follows the deterministic ladder and respects ROE', () => {
  assert.equal(recommendAction({ ...base, iff: true }).action, 'monitor');
  assert.equal(recommendAction({ ...base, threat: 0.05 }).action, 'monitor');
  assert.equal(recommendAction({ ...base, range: 6000 }).action, 'monitor');
  assert.equal(recommendAction({ ...base, range: 3800 }).action, 'warn');
  assert.equal(recommendAction({ ...base, range: 3000 }).action, 'ecm');
  assert.equal(recommendAction({ ...base, range: 3000, rf: false, escalated: false }).action, 'escalate');
  assert.equal(recommendAction({ ...base, range: 2000, confidence: 0.3 }).action, 'escalate');
  assert.equal(recommendAction({ ...base, range: 2000, escalated: false }).action, 'escalate');
  assert.equal(recommendAction(base).action, 'intercept');
  assert.ok(recommendAction({ ...base, classifiedThreat: false }).reason.includes('classify it as a threat first'));
});
function runTo(s, t) { while (!s.over && s.t < t) s.step(20); }
test('unknown classification is an abstention: correct only for false alarms, counted in stats', () => {
  const s = new Session({ seed: 4, scenarioId: 'lone-observer' }); runTo(s, 40); const p = s.perceived().tracks[0]; assert.ok(p);
  assert.equal(s.act({ type: 'classify', trackId: p.id, cls: 'unknown' }).ok, true);
  const e = s.log.find((l) => l.action?.type === 'classify'); assert.equal(e.result.unknown, true); assert.equal(e.result.traineeThreat, false);
  assert.equal(e.result.correct, e.result.entityId < 0); assert.ok(s.score().stats.unknownCalls >= 1);
});
test('prioritisation is scored: oracle-ordered list beats the reverse order; skipping it does not penalise', () => {
  const mk = (rev) => { const s = new Session({ seed: 6, scenarioId: 'swarm-in-the-flock' }); runTo(s, 50); const tr = s.per.confirmed().slice(0, 8);
    const ranked = tr.map((t) => ({ id: t.id, o: windowTruth(t, s.t, s.world).oracle })).sort((a, b) => (rev ? a.o - b.o : b.o - a.o)); s.act({ type: 'prioritise', order: ranked.map((r) => r.id) }); return s.score(); };
  const good = mk(false), bad = mk(true); assert.ok(good.stats.prioritisationKendallTau > 0.9 && bad.stats.prioritisationKendallTau < -0.9, `${good.stats.prioritisationKendallTau} ${bad.stats.prioritisationKendallTau}`);
  assert.ok(good.parts.prioritisation > bad.parts.prioritisation);
  const s = new Session({ seed: 6, scenarioId: 'swarm-in-the-flock' }); runTo(s, 50); assert.equal(s.score().stats.prioritisationKendallTau, null);
});
test('live difficulty and sensor-failure injection change the picture and replay exactly', () => {
  const cfg = { seed: 8, scenarioId: 'lone-observer' }, s = new Session(cfg); runTo(s, 20); const n0 = s.world.cfg.cond.noise; s.setDifficulty(5); assert.ok(s.world.cfg.cond.noise > n0 * 0.99 || n0 > 0);
  s.setDifficulty(1); const low = s.world.cfg.cond.noise; s.setDifficulty(5); assert.ok(s.world.cfg.cond.noise > low);
  s.setSensor('radar', false); assert.equal(s.perceived().sensors.radar, false); s.setSensor('rf', false); assert.equal(s.perceived().sensors.rf, false); runTo(s, 70); assert.equal(s.perceived().sensors.radar, true, 'radar outage ends after 45 s');
  while (!s.over) s.step(20); const r = Session.replay(cfg, s.log); assert.equal(r.world.stateHash(), s.world.stateHash());
});
test('live score strip is exposed and bounded', () => {
  const s = new Session({ seed: 2, scenarioId: 'lone-observer' }); runTo(s, 30); const sc = s.perceived().score; assert.ok(sc >= 0 && sc <= 100);
});
