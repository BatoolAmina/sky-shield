import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, scenarioById, SCENARIOS, runEpisode, Bandit, Rng, TACTICS, buildAAR } from '../src/index.js';

function play(s, script) {
  while (!s.over) { script(s); s.step(20); }
  return s;
}
const scriptA = (s) => { const t = Math.round(s.t); if (t % 10 === 0 && s.t - t < 0.01) { for (const p of s.perceived().tracks.slice(0, 3)) { s.act({ type: 'classify', trackId: p.id, cls: p.rf ? 'threat' : 'nonthreat' }); if (p.range < 3000) s.act({ type: 'respond', trackId: p.id, response: 'warn' }); } } };

test('all six scenarios run to completion and produce a score + AAR', () => {
  assert.equal(SCENARIOS.length, 6);
  for (const sc of SCENARIOS) { const s = play(new Session({ seed: 3, scenarioId: sc.id }), scriptA); const sco = s.score(); assert.ok(sco.total >= 0 && sco.total <= 100, sc.id); const a = buildAAR(s, sco); assert.ok(a.summary.length > 10 && a.lessons.length >= 1); }
});
test('replay: (config + action log) reproduces the session exactly', () => {
  const cfg = { seed: 9, scenarioId: 'swarm-in-the-flock' }; const a = play(new Session(cfg), scriptA), b = Session.replay(cfg, a.log);
  assert.equal(a.world.stateHash(), b.world.stateHash()); assert.equal(a.score().total, b.score().total); assert.equal(a.tick, b.tick);
});
test('perceived picture never leaks ground truth', () => {
  const s = new Session({ seed: 4, scenarioId: 'lone-observer' }); s.step(20 * 40); const json = JSON.stringify(s.perceived());
  for (const k of ['truth', 'cls"', 'entityId', 'surveillance_drone', 'rcsDb', 'emits']) assert.ok(!json.includes(k), `leaked ${k}`);
});
test('ROE: engaging before classifying is denied; unknown track rejected', () => {
  const s = new Session({ seed: 2, scenarioId: 'fast-strike' }); s.step(20 * 60); const tr = s.perceived().tracks[0]; assert.ok(tr);
  const r = s.act({ type: 'respond', trackId: tr.id, response: 'intercept' }); assert.equal(r.ok, false); assert.equal(s.act({ type: 'respond', trackId: 99999, response: 'warn' }).ok, false);
});
test('scripted defender episode is deterministic; bandit state round-trips', () => {
  const a = runEpisode({ seed: 5, tactic: 'saturation', defence: 'balanced' }), b = runEpisode({ seed: 5, tactic: 'saturation', defence: 'balanced' }); assert.deepEqual(a, b);
  const bd = new Bandit('dts', new Rng(1)); for (let i = 0; i < 20; i++) { const k = bd.select(); bd.update(k, i % 2); } const j = JSON.parse(JSON.stringify(bd)); const bd2 = Bandit.fromJSON(j, new Rng(1));
  assert.deepEqual(bd2.a, bd.a); assert.equal(TACTICS.length, 5);
});
