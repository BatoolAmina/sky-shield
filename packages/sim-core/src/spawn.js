import { sampleClassParams } from './profiles.js';
const D2R = Math.PI / 180;
export function spawnGroup(w, spec) {
    const rng = w.rngSpawn, prof = w.cfg.profile, cond = w.cfg.cond, ss = cond.speedScale;
    const group = w.newGroup();
    const brg = (spec.brgDeg ?? rng.uniform(0, 360)) * D2R;
    // start range is drawn from the same wide distribution for EVERY class so that range_to_asset does not leak class identity
    const range = spec.range ?? rng.uniform(1800, 8800);
    const cx = Math.cos(brg) * range, cy = Math.sin(brg) * range;
    const toAsset = Math.atan2(-cy, -cx);
    const out = [];
    const mk = (cls, x, y, psi, cp, beh, speed, leader = -1, decoy = false) => {
        const e = w.add({ cls, group, pos: { x, y, z: Math.max(3, cp.alt) }, psi, speed, vz: 0, emits: cp.emits, rfSig: cp.rfSig, transponderP: cp.transponderP,
            rcsDb: cp.rcsDb + cond.rcsOffsetDb, rcsBias: rng.normal(0, 2), maxSpeed: cp.maxSpeed * ss, maxAccel: cp.maxAccel, maxTurn: cp.maxTurn, maxClimb: cp.maxClimb, beh, leader, decoy });
        if (leader === -1)
            e.leader = e.id;
        return e;
    };
    const flankWp = () => {
        if (spec.tactic !== 'flank' && spec.tactic !== 'decoy_split')
            return undefined;
        const side = rng.bernoulli(0.5) ? 1 : -1, a = brg + side * 70 * D2R;
        return { x: Math.cos(a) * 3500, y: Math.sin(a) * 3500, z: 0 };
    };
    switch (spec.kind) {
        case 'surveillance': {
            const cp = sampleClassParams('surveillance_drone', rng, prof), v = cp.speed * ss;
            out.push(mk('surveillance_drone', cx, cy, toAsset, cp, { kind: 'surveillance', state: 'approach', tNext: 0,
                p: { R: rng.uniform(2500, 5000), dir: rng.bernoulli(0.5) ? 1 : -1, v, alt: cp.alt, loiterT: rng.uniform(25, 60), hoverT0: w.t + rng.uniform(10, 60), hoverLen: rng.uniform(0, 10) } }, v, -1, !!spec.decoy));
            break;
        }
        case 'fast': {
            const cp = sampleClassParams('fast_drone', rng, prof), v = cp.speed * ss;
            const alt = spec.lowAlt ? rng.uniform(15, 35) : cp.alt;
            out.push(mk('fast_drone', cx, cy, toAsset, { ...cp, alt }, { kind: 'fast', state: 'approach', tNext: 0, p: { v, alt }, waypoint: flankWp() }, v));
            break;
        }
        case 'low': {
            const cp = sampleClassParams('low_intruder', rng, prof), v = cp.speed * ss;
            out.push(mk('low_intruder', cx, cy, toAsset, cp, { kind: 'low', state: 'approach', tNext: w.t, p: { v, alt: cp.alt, off: 0, ph: rng.uniform(0, 6.28) }, waypoint: flankWp() }, v));
            break;
        }
        case 'swarm': {
            const n = spec.n ?? rng.int(3, 7), base = sampleClassParams('swarm_member', rng, prof), wp = flankWp();
            let leaderId = -1;
            for (let i = 0; i < n; i++) {
                const cp = { ...base, alt: base.alt + rng.normal(0, 8), rcsDb: base.rcsDb + rng.normal(0, 1.5), emits: rng.bernoulli(prof === 'shifted' ? 0.75 : 0.9) };
                const v = (base.speed + rng.normal(0, 1.2)) * ss;
                const e = mk('swarm_member', cx + rng.normal(0, 80), cy + rng.normal(0, 80), toAsset + rng.normal(0, 0.05), cp, { kind: 'swarm', state: 'approach', tNext: 0, p: { v, alt: cp.alt }, waypoint: i === 0 && wp ? { ...wp } : undefined }, v, leaderId);
                if (i === 0)
                    leaderId = e.id;
                if (wp && i > 0)
                    e.beh.waypoint = undefined;
            }
            break;
        }
        case 'bird': {
            const n = spec.n ?? rng.weighted([1, 2, 3, 4, 5, 6], [0.45, 0.2, 0.15, 0.1, 0.05, 0.05]);
            const home = rng.bernoulli(0.25) ? toAsset + rng.normal(0, 0.7) : rng.uniform(-Math.PI, Math.PI);
            const straight = rng.bernoulli(0.25) ? rng.uniform(0.6, 0.95) : rng.uniform(0, 0.5);
            const base = sampleClassParams('bird', rng, prof);
            for (let i = 0; i < n; i++) {
                const cp = { ...base, alt: base.alt + rng.normal(0, 6), rcsDb: base.rcsDb + rng.normal(0, 1.5) };
                const v = Math.max(2, (base.speed + rng.normal(0, 1.0)) * (prof === 'shifted' ? 1 : 1));
                mk('bird', cx + rng.normal(0, 60), cy + rng.normal(0, 60), home + rng.normal(0, 0.2), cp, { kind: 'bird', state: 'fly', tNext: w.t, p: { vt: v, alt: cp.alt, straight, home } }, v);
            }
            break;
        }
        case 'friendly':
        case 'civil': {
            const cls = spec.kind === 'friendly' ? 'friendly_aircraft' : 'civil_aircraft';
            const cp = sampleClassParams(cls, rng, prof);
            const a1 = brg + Math.PI + rng.uniform(-0.7, 0.7);
            const e = mk(cls, cx, cy, 0, cp, { kind: 'transit', state: 'transit', tNext: 0, p: { v: cp.speed, alt: cp.alt }, waypoint: { x: Math.cos(a1) * 11000, y: Math.sin(a1) * 11000, z: 0 } }, cp.speed);
            e.psi = Math.atan2(e.beh.waypoint.y - e.pos.y, e.beh.waypoint.x - e.pos.x);
            out.push(e);
            break;
        }
    }
    return w.entities.filter((e) => e.group === group);
}
