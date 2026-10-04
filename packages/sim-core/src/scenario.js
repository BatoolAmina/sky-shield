import { Rng } from './rng.js';
/** Playable scenario library (6 scenarios; the synopsis asks for 3 in the prototype and 6 in the full version). */
export const SCENARIOS = [
    { id: 'lone-observer', name: 'Lone Observer', difficulty: 1, durationS: 150,
        brief: 'A single surveillance drone is probing the perimeter. Birds and a friendly transit are in the area. Classify carefully and respond proportionately.',
        events: [{ at: 0, spec: { kind: 'surveillance' } }, { at: 3, spec: { kind: 'bird', n: 3 } }, { at: 10, spec: { kind: 'friendly' } }, { at: 20, spec: { kind: 'bird', n: 1 } }] },
    { id: 'low-and-slow', name: 'Low and Slow', difficulty: 2, durationS: 150,
        brief: 'A low-altitude intruder is terrain-hugging toward the site. Radar shadowing is a factor. A civil helicopter and a bird flock add clutter.',
        events: [{ at: 0, spec: { kind: 'low' } }, { at: 5, spec: { kind: 'civil' } }, { at: 8, spec: { kind: 'bird', n: 4 } }, { at: 30, spec: { kind: 'bird', n: 2 } }] },
    { id: 'swarm-in-the-flock', name: 'Swarm in the Flock', difficulty: 3, durationS: 160,
        brief: 'A small swarm approaches with a bird flock moving the same way. Prioritise and avoid collateral on non-threats.',
        events: [{ at: 0, spec: { kind: 'swarm', n: 5 } }, { at: 2, spec: { kind: 'bird', n: 6 } }, { at: 12, spec: { kind: 'friendly' } }, { at: 25, spec: { kind: 'civil' } }] },
    { id: 'fast-strike', name: 'Fast Strike', difficulty: 3, durationS: 120,
        brief: 'A fast drone races straight at the asset while a slow surveillance drone loiters as a distraction. Time is short.',
        events: [{ at: 0, spec: { kind: 'surveillance', decoy: true } }, { at: 18, spec: { kind: 'fast' } }, { at: 4, spec: { kind: 'bird', n: 2 } }, { at: 15, spec: { kind: 'friendly' } }] },
    { id: 'flank-and-decoy', name: 'Flank and Decoy', difficulty: 4, durationS: 150,
        brief: 'Decoys draw attention while the real attacker flanks. A second wave appears if the first is cleared too early.',
        events: [{ at: 0, spec: { kind: 'surveillance', decoy: true, tactic: 'decoy_split' } }, { at: 2, spec: { kind: 'surveillance', decoy: true } }, { at: 10, spec: { kind: 'fast', tactic: 'flank' } },
            { at: 6, spec: { kind: 'bird', n: 3 } }, { at: 40, spec: { kind: 'low', tactic: 'flank' }, when: 'if_first_wave_cleared_early' }] },
    { id: 'saturation-night', name: 'Saturation Night', difficulty: 5, durationS: 140, adaptive: true,
        brief: 'Poor visibility and heavy clutter. The adversary adapts its tactic to your previous sessions: expect something different each time.',
        overrides: { clutterScale: 1.8, visibilityScale: 0.5, noiseScale: 1.2 },
        events: [{ at: 0, spec: { kind: 'bird', n: 5 } }, { at: 5, spec: { kind: 'civil' } }, { at: 10, spec: { kind: 'friendly' } }] },
];
export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id);
/** Random scenario composition used for dataset generation (one per scenario seed). */
export function sampleDatasetScenario(seed, profile, durationS = 100) {
    const rng = Rng.stream(seed, 'composition');
    const sh = profile === 'shifted';
    const events = [];
    const nThreat = rng.int(2, 4);
    const kinds = ['surveillance', 'fast', 'low', 'swarm'];
    const tactics = [undefined, undefined, 'flank', 'low_altitude'];
    for (let i = 0; i < nThreat; i++) {
        const kind = rng.weighted(kinds, [1, 1, 2.2, sh ? 1.6 : 0.9]);
        events.push({ at: rng.uniform(0, 25), spec: { kind, n: kind === 'swarm' ? rng.int(3, 7) : undefined, tactic: rng.pick(tactics), lowAlt: kind === 'fast' && rng.bernoulli(0.2) } });
    }
    const nBird = sh ? rng.int(2, 3) : rng.int(1, 2);
    for (let i = 0; i < nBird; i++)
        events.push({ at: rng.uniform(0, 25), spec: { kind: 'bird' } });
    for (let i = rng.int(0, 1); i > 0; i--)
        events.push({ at: rng.uniform(0, 25), spec: { kind: 'friendly' } });
    for (let i = rng.int(0, 1); i > 0; i--)
        events.push({ at: rng.uniform(0, 25), spec: { kind: 'civil' } });
    return { id: `ds-${seed}`, name: `dataset-${seed}`, brief: '', difficulty: 3, durationS, events };
}
