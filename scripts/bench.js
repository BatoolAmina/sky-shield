// Usage: node scripts/bench.js [outfile]   Measures simulator + perception + mentor cost with 30 and 50+ simultaneous objects (headless; browser FPS is NOT measured here).
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { Session, TreeModel } from '../packages/sim-core/src/index.js';
const mp = 'results/v1/model/model.json', model = existsSync(mp) ? new TreeModel(JSON.parse(readFileSync(mp, 'utf8'))) : null;
const mk = (name, swarm, birds) => ({ id: name, name, brief: '', difficulty: 3, durationS: 70, events: [{ at: 0, spec: { kind: 'swarm', n: swarm, brgDeg: 40, range: 4500 } }, ...Array.from({ length: birds }, (_, i) => ({ at: 0, spec: { kind: 'bird', n: 5, brgDeg: 60 + i * 40 } })), { at: 0, spec: { kind: 'friendly' } }, { at: 0, spec: { kind: 'civil' } }, { at: 0, spec: { kind: 'low' } }, { at: 0, spec: { kind: 'fast' } }] });
const out = {};
for (const [name, swarm, birds] of [['~30 objects', 14, 3], ['~50 objects', 26, 5], ['~80 objects (stress)', 44, 8]]) {
  const s = new Session({ seed: 3, scenario: mk(name, swarm, birds), model }), objs = s.world.entities.length;
  let peakTracks = 0, simMs = 0, perMs = [], t0 = process.hrtime.bigint();
  for (let sec = 0; sec < 60; sec++) { const a = process.hrtime.bigint(); s.step(20); const ms = Number(process.hrtime.bigint() - a) / 1e6; perMs.push(ms); const p = s.perceived(); peakTracks = Math.max(peakTracks, p.tracks.length); }
  const total = Number(process.hrtime.bigint() - t0) / 1e6, sorted = perMs.slice(10).sort((a, b) => a - b), t1 = process.hrtime.bigint(); const json = JSON.stringify(s.perceived()); const payloadMs = Number(process.hrtime.bigint() - t1) / 1e6;
  out[name] = { entities: s.world.entities.length, peak_confirmed_tracks: peakTracks, simulated_seconds: 60, wall_seconds: total / 1000, realtime_factor: 60000 / total, ms_per_simulated_second_median: sorted[Math.floor(sorted.length / 2)], ms_per_simulated_second_p95: sorted[Math.floor(sorted.length * 0.95)], frame_payload_kb: json.length / 1024, serialise_ms: payloadMs, mentor_loaded: !!model };
  console.log(name, out[name]);
}
writeFileSync(process.argv[2] ?? 'results/v1/metrics/performance.json', JSON.stringify({ note: 'headless Node benchmark on the build machine (single CPU core); rendering FPS in a browser is not measured', node: process.version, results: out }, null, 1));
