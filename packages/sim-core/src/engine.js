import { Rng } from './rng.js';
import { World } from './world.js';
import { resolveConditions } from './profiles.js';
import { spawnGroup } from './spawn.js';
import { DEFAULT_DEFENCE } from './types.js';
export function createWorld(seed, profile, ov, durationS, defence, dt = 0.05) {
    const cond = resolveConditions(profile, ov, Rng.stream(seed, 'cond'), durationS);
    const cfg = { seed, profile, durationS, dt, cond, defence: { ...DEFAULT_DEFENCE, ...defence } };
    return new World(cfg);
}
export class ScenarioEngine {
    def;
    fired = new Set();
    constructor(def) {
        this.def = def;
    }
    step(w, flags) {
        this.def.events.forEach((ev, i) => {
            if (this.fired.has(i) || w.t + 1e-9 < ev.at)
                return;
            if (ev.when === 'if_first_wave_cleared_early' && !flags.firstWaveClearedEarly)
                return;
            this.fired.add(i);
            spawnGroup(w, ev.spec);
        });
    }
}
