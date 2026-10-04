// Usage: node scripts/adversary_eval.js <outdir> [episodesPerCell=60] [repeats=300]
// 1) Build outcome pools by running REAL simulator episodes: every (defence x tactic) cell, scripted defender, different scenario seeds.
// 2) Trace-driven bandit comparison: rewards are resampled from those real outcomes (stationary and regime-change experiments).
// 3) Closed-loop check: bandits choose tactics and play REAL simulator episodes directly (single run, regime change halfway).
import { mkdirSync, writeFileSync } from 'node:fs';
import { Bandit, DEFENCES, TACTICS, Rng, runEpisode } from '../packages/sim-core/src/index.js';
const out = process.argv[2] ?? 'results/v1/metrics', N = +(process.argv[3] ?? 60), R = +(process.argv[4] ?? 300);
mkdirSync(out, { recursive: true }); const t0 = Date.now(), K = TACTICS.length, defs = Object.keys(DEFENCES);
const pools = {}, table = {};
for (const d of defs) { pools[d] = {}; table[d] = {}; for (const t of TACTICS) { const o = []; for (let i = 0; i < N; i++) o.push(runEpisode({ seed: 100000 + i, tactic: t, defence: d }).success); pools[d][t] = o; table[d][t] = o.reduce((a, b) => a + b, 0) / N; } }
console.log(`[adversary] pools built in ${(Date.now() - t0) / 1000}s`, JSON.stringify(table));
const best = (d) => Math.max(...TACTICS.map((t) => table[d][t]));
const algos = [['uniform random', 'uniform', {}], ['fixed: direct', 'fixed', { fixed: 'direct' }], ['epsilon-greedy (0.1)', 'eps', {}], ['UCB1', 'ucb', {}], ['Thompson (stationary)', 'ts', {}], ['Discounted Thompson (gamma 0.95)', 'dts', { gamma: 0.95 }], ['Discounted Thompson (gamma 0.90)', 'dts', { gamma: 0.9 }], ['Discounted Thompson (gamma 0.80)', 'dts', { gamma: 0.8 }]];
function simulate(schedule, name, kind, opts, seed) {
  const rng = Rng.stream(seed, 'bandit-eval'), b = new Bandit(kind, rng, opts), T = schedule.length, rew = [], reg = [], arm = [];
  for (let e = 0; e < T; e++) { const d = schedule[e], i = b.select(), pool = pools[d][TACTICS[i]], r = pool[rng.int(0, pool.length - 1)]; b.update(i, r); rew.push(r); reg.push(best(d) - table[d][TACTICS[i]]); arm.push(i); }
  return { rew, reg, arm };
}
const results = {};
const fast = []; ['low_blind', 'north_heavy', 'capacity_limited', 'low_blind', 'north_heavy', 'capacity_limited', 'low_blind', 'north_heavy'].forEach((d) => fast.push(...Array(30).fill(d)));
const experiments = { fast_switching: fast, regime_change: [...Array(150).fill('low_blind'), ...Array(150).fill('north_heavy')], stationary_low_blind: Array(150).fill('low_blind'), stationary_capacity_limited: Array(150).fill('capacity_limited'), stationary_balanced: Array(150).fill('balanced') };
for (const [ename, sched] of Object.entries(experiments)) {
  results[ename] = { schedule_regimes: [...new Set(sched)], T: sched.length, algos: {} };
  for (const [label, kind, opts] of algos) {
    const T = sched.length, rew = Array(T).fill(0), cum = Array(T).fill(0), freq = Array.from({ length: T }, () => Array(K).fill(0)), rr = [];
    for (let r = 0; r < R; r++) { const s = simulate(sched, label, kind, opts, 1000 + r); let c = 0; s.rew.forEach((x, e) => { rew[e] += x / R; c += s.reg[e]; cum[e] += c / R; freq[e][s.arm[e]] += 1 / R; }); rr.push(s.reg.reduce((a, b) => a + b, 0)); }
    const m = rr.reduce((a, b) => a + b, 0) / R, sd = Math.sqrt(rr.reduce((a, b) => a + (b - m) ** 2, 0) / (R - 1));
    results[ename].algos[label] = { mean_reward: rew, cumulative_regret: cum, arm_freq: freq, final_regret_mean: m, final_regret_ci95: 1.96 * sd / Math.sqrt(R), last50_success: rew.slice(-50).reduce((a, b) => a + b, 0) / 50 };
  }
}
// closed loop against the real simulator
const closed = {};
for (const [label, kind, opts] of [algos[0], algos[5]]) {
  const rng = Rng.stream(7, 'closed'), b = new Bandit(kind, rng, opts), rew = [], arms = [];
  for (let e = 0; e < 240; e++) { const d = e < 120 ? 'low_blind' : 'north_heavy', i = b.select(), r = runEpisode({ seed: 500000 + e, tactic: TACTICS[i], defence: d }).success; b.update(i, r); rew.push(r); arms.push(i); }
  closed[label] = { reward: rew, arms };
}
writeFileSync(`${out}/adversary_eval.json`, JSON.stringify({ tactics: TACTICS, defences: defs, episodes_per_cell: N, repeats: R, success_table: table, pools_note: 'each cell = real simulator episodes vs scripted defender', results, closed_loop: closed, seconds: (Date.now() - t0) / 1000 }));
console.log(`[adversary] done in ${(Date.now() - t0) / 1000}s`);
