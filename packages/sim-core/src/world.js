import { Rng } from './rng.js';
import { updateBehaviour } from './behaviour.js';
import { DEFAULT_DEFENCE, ZONES, isThreatClass, zoneOfRange } from './types.js';
export class World {
    cfg;
    t = 0;
    tick = 0;
    nextId = 1;
    nextGroup = 1;
    entities = [];
    events = [];
    asset = { x: 0, y: 0, z: 0 };
    rngFlight;
    rngSpawn;
    zoneOf = new Map();
    constructor(cfg) {
        this.cfg = cfg;
        this.rngFlight = Rng.stream(cfg.seed, 'flight');
        this.rngSpawn = Rng.stream(cfg.seed, 'spawn');
    }
    newGroup() { return this.nextGroup++; }
    add(e) {
        const ent = { ...e, id: this.nextId++, spawnT: this.t, engaged: 0, status: 'active' };
        this.entities.push(ent);
        this.events.push({ t: this.t, type: 'spawn', entityId: ent.id, cls: ent.cls });
        return ent;
    }
    active() { return this.entities.filter((e) => e.status === 'active' || e.status === 'aborted'); }
    rangeOf(e) { return Math.hypot(e.pos.x - this.asset.x, e.pos.y - this.asset.y); }
    step() {
        const dt = this.cfg.dt;
        const groups = new Map();
        for (const e of this.entities)
            if (e.status === 'active' || e.status === 'aborted') {
                const g = groups.get(e.group);
                if (g)
                    g.push(e);
                else
                    groups.set(e.group, [e]);
            }
        for (const e of this.entities) {
            if (e.status !== 'active' && e.status !== 'aborted')
                continue;
            updateBehaviour(e, { t: this.t, dt, asset: this.asset, rng: this.rngFlight, mates: groups.get(e.group) ?? [], speedScale: this.cfg.cond.speedScale });
            const r = this.rangeOf(e);
            const z = zoneOfRange(r);
            if (this.zoneOf.get(e.id) !== z) {
                this.zoneOf.set(e.id, z);
                this.events.push({ t: this.t, type: 'zone', entityId: e.id, cls: e.cls, info: z });
            }
            if (isThreatClass(e.cls) && e.status === 'active' && r < ZONES.impact && e.pos.z < 300) {
                e.status = 'impact';
                this.events.push({ t: this.t, type: 'impact', entityId: e.id, cls: e.cls });
            }
            else if (r > 10000 && this.t - e.spawnT > 5) {
                e.status = 'exited';
                this.events.push({ t: this.t, type: 'exit', entityId: e.id, cls: e.cls });
            }
        }
        this.t += dt;
        this.tick++;
    }
    /** Ground-truth query used ONLY by scoring, labelling and after-action review. */
    truthById(id) { return this.entities.find((e) => e.id === id); }
    stateHash() {
        let h = 2166136261 >>> 0;
        const mix = (v) => { const s = Math.round(v * 1000) | 0; h ^= s; h = Math.imul(h, 16777619) >>> 0; };
        for (const e of this.entities) {
            mix(e.id);
            mix(e.pos.x);
            mix(e.pos.y);
            mix(e.pos.z);
            mix(e.speed);
            mix(e.psi * 1000);
            mix(e.status === 'active' ? 1 : 0);
        }
        mix(this.tick);
        return h.toString(16).padStart(8, '0');
    }
}
export function defaultWorldConfig(seed, cond, profile = 'train', durationS = 100, dt = 0.05) {
    return { seed, profile, durationS, dt, cond, defence: { ...DEFAULT_DEFENCE } };
}
