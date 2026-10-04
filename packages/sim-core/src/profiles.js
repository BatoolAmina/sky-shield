const SHIFT = { droneSpeed: 1.25, birdSpeed: 0.85, droneRcs: 3, birdRcs: 2, emit: -0.15 };
/** Class parameter distributions. Ranges overlap ON PURPOSE (bird vs slow drone, helicopter vs low drone). */
export function sampleClassParams(cls, rng, profile) {
    const sh = profile === 'shifted';
    const dS = sh ? SHIFT.droneSpeed : 1, bS = sh ? SHIFT.birdSpeed : 1;
    const dR = sh ? SHIFT.droneRcs : 0, bR = sh ? SHIFT.birdRcs : 0, em = sh ? SHIFT.emit : 0;
    switch (cls) {
        case 'surveillance_drone': return { speed: rng.uniform(5, 22) * dS, alt: rng.uniform(60, 350), rcsDb: rng.normal(-17, 3) + dR,
            emits: rng.bernoulli(0.85 + em), rfSig: rng.pick([1, 2]), transponderP: 0, maxAccel: 3, maxTurn: 0.6, maxClimb: 4, maxSpeed: 28 * dS };
        case 'fast_drone': return { speed: rng.uniform(26, 55) * dS, alt: rng.uniform(40, 250), rcsDb: rng.normal(-14, 3) + dR,
            emits: rng.bernoulli(0.85 + em), rfSig: rng.bernoulli(0.25) ? 1 : 3, transponderP: 0, maxAccel: 8, maxTurn: 0.9, maxClimb: 8, maxSpeed: 62 * dS };
        case 'low_intruder': return { speed: rng.uniform(8, 30) * dS, alt: rng.uniform(5, 38), rcsDb: rng.normal(-18, 3) + dR,
            emits: rng.bernoulli(0.8 + em), rfSig: rng.pick([1, 2, 5]), transponderP: 0, maxAccel: 5, maxTurn: 1.2, maxClimb: 6, maxSpeed: 34 * dS };
        case 'swarm_member': return { speed: rng.uniform(10, 28) * dS, alt: rng.uniform(40, 160), rcsDb: rng.normal(-19, 2.5) + dR,
            emits: rng.bernoulli(0.9 + em), rfSig: 4, transponderP: 0, maxAccel: 5, maxTurn: 1.0, maxClimb: 5, maxSpeed: 34 * dS };
        case 'bird': {
            const fast = rng.bernoulli(0.15);
            return { speed: (fast ? rng.uniform(20, 28) : rng.uniform(2.5, 22)) * bS, alt: rng.uniform(4, 260), rcsDb: rng.normal(-25, 4) + bR,
                emits: false, rfSig: 0, transponderP: 0, maxAccel: 4, maxTurn: 2.0, maxClimb: 5, maxSpeed: 32 * bS };
        }
        case 'friendly_aircraft': {
            const heli = rng.bernoulli(0.25);
            return heli ? { speed: rng.uniform(18, 45), alt: rng.uniform(40, 400), rcsDb: rng.normal(-2, 3), emits: false, rfSig: 0, transponderP: 0.92, heli, maxAccel: 3, maxTurn: 0.4, maxClimb: 5, maxSpeed: 55 }
                : { speed: rng.uniform(35, 110), alt: rng.uniform(150, 1500), rcsDb: rng.normal(3, 4), emits: false, rfSig: 0, transponderP: 0.92, maxAccel: 4, maxTurn: 0.2, maxClimb: 10, maxSpeed: 130 };
        }
        case 'civil_aircraft': {
            const heli = rng.bernoulli(0.15);
            return heli ? { speed: rng.uniform(20, 60), alt: rng.uniform(80, 900), rcsDb: rng.normal(0, 3), emits: false, rfSig: 0, transponderP: 0.6, heli, maxAccel: 3, maxTurn: 0.3, maxClimb: 5, maxSpeed: 70 }
                : { speed: rng.uniform(60, 160), alt: rng.uniform(300, 3000), rcsDb: rng.normal(8, 4), emits: false, rfSig: 0, transponderP: 0.6, maxAccel: 4, maxTurn: 0.15, maxClimb: 12, maxSpeed: 180 };
        }
    }
}
export function resolveConditions(profile, ov, rng, durationS) {
    const sh = profile === 'shifted';
    const noise = rng.uniform(0.8, 1.4) * (sh ? 1.6 : 1) * (ov.noiseScale ?? 1);
    const clutterRate = rng.uniform(0.3, 0.9) * (sh ? 2.5 : 1) * (ov.clutterScale ?? 1);
    const visibilityM = rng.uniform(2500, 9000) * (sh ? 0.7 : 1) * (ov.visibilityScale ?? 1);
    const pdOffsetDb = (sh ? -3 : 0) + (ov.pdOffsetDb ?? 0);
    const outages = [];
    if (ov.radarOutage && ov.radarOutage > 0) {
        const d = ov.radarOutage * durationS;
        const s = rng.uniform(5, Math.max(6, durationS - d - 5));
        outages.push([s, s + d]);
    }
    return { noise, clutterRate, visibilityM, pdOffsetDb, speedScale: ov.speedScale ?? 1, rcsOffsetDb: ov.rcsOffsetDb ?? 0,
        radarOutages: outages, rfEnabled: !ov.rfDisabled, eoEnabled: !ov.eoDisabled, rfEmitScale: 1 };
}
