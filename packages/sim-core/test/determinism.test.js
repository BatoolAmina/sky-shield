import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng, runDatasetScenario, createWorld, ScenarioEngine, sampleDatasetScenario, Perception, FEATURE_NAMES, extractFeatures } from '../src/index.js';

test('same seed -> identical simulation state hash and identical rows; different seed differs', () => {
  const a = runDatasetScenario({ seed: 11, profile: 'train' }), b = runDatasetScenario({ seed: 11, profile: 'train' }), c = runDatasetScenario({ seed: 12, profile: 'train' });
  assert.equal(a.hash, b.hash); assert.deepEqual(a.rows.map((r) => r.feats), b.rows.map((r) => r.feats)); assert.notEqual(a.hash, c.hash);
});
test('independent RNG streams: extra draws in one subsystem do not shift another', () => {
  const r1 = Rng.stream(5, 'flight'), r2 = Rng.stream(5, 'radar'); const before = r1.next(); r2.next(); r2.next();
  const r1b = Rng.stream(5, 'flight'); assert.equal(r1b.next(), before);
});
test('RNG sanity: uniform mean and normal moments', () => {
  const r = new Rng(1); let s = 0, m = 0, v = 0; const n = 20000; for (let i = 0; i < n; i++) s += r.next(); assert.ok(Math.abs(s / n - 0.5) < 0.01);
  const xs = Array.from({ length: n }, () => r.normal(2, 3)); m = xs.reduce((a, b) => a + b) / n; v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / n; assert.ok(Math.abs(m - 2) < 0.1 && Math.abs(Math.sqrt(v) - 3) < 0.1);
});
test('features are a pure function of the perceived track history (no ground truth access)', () => {
  const def = sampleDatasetScenario(3, 'train'), w = createWorld(3, 'train', {}, 100), eng = new ScenarioEngine(def), per = new Perception(3, w.cfg.cond);
  for (let i = 0; i < 1000; i++) { eng.step(w, {}); per.tick(w); w.step(); }
  const conf = per.confirmed(); assert.ok(conf.length > 0);
  const f1 = extractFeatures(conf[0], w.t, conf); w.entities.forEach((e) => { e.cls = 'bird'; e.rcsDb = 99; }); const f2 = extractFeatures(conf[0], w.t, conf);
  assert.deepEqual(f1, f2); assert.equal(f1.length, FEATURE_NAMES.length); assert.ok(f1.every(Number.isFinite));
});
