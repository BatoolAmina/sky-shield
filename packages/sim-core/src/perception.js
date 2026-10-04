import { Rng, clamp, wrapPi } from './rng.js';
import { ZONES, isThreatClass, zoneOfRange } from './types.js';
export const RADAR_RANGE = 9000, RADAR_DT = 1.0, RF_DT = 0.5, EO_DT = 0.5;
const D2R = Math.PI / 180;
/** One independent 1-D filter per axis. Kalman (constant velocity) or alpha-beta. Classical estimation, not ML. */
class Axis {
    p;
    v = 0;
    p00;
    p01 = 0;
    p11 = 900;
    n = 1;
    constructor(z, R) { this.p = z; this.p00 = R; }
    predict(dt, q, kind) {
        this.p += this.v * dt;
        if (kind === 'kf') {
            const a = this.p00 + dt * (2 * this.p01 + dt * this.p11) + (q * dt ** 4) / 4;
            const b = this.p01 + dt * this.p11 + (q * dt ** 3) / 2;
            this.p00 = a;
            this.p01 = b;
            this.p11 += q * dt * dt;
        }
    }
    update(z, R, dt, kind) {
        if (this.n === 1) {
            this.v = (z - this.p) / dt;
            this.p = z;
            this.p00 = R;
            this.p01 = R / dt;
            this.p11 = (2 * R) / (dt * dt);
            this.n = 2;
            return;
        }
        const r = z - this.p;
        if (kind === 'kf') {
            const S = this.p00 + R, k0 = this.p00 / S, k1 = this.p01 / S;
            this.p += k0 * r;
            this.v += k1 * r;
            this.p11 -= k1 * this.p01;
            this.p01 *= 1 - k0;
            this.p00 *= 1 - k0;
        }
        else {
            this.p += 0.5 * r;
            this.v += (0.2 * r) / dt;
        }
    }
}
export class Track {
    id;
    birthT;
    status = 'tentative';
    ax;
    hits = [];
    misses = 0;
    history = [];
    lastScanT;
    pending = { rf: false, sig: -1, iff: false, eo: -1 };
    constructor(id, birthT, x, y, z, sxy, sz) {
        this.id = id;
        this.birthT = birthT;
        this.ax = [new Axis(x, sxy * sxy), new Axis(y, sxy * sxy), new Axis(z, sz * sz)];
        this.lastScanT = birthT;
    }
    get x() { return this.ax[0].p; }
    get y() { return this.ax[1].p; }
    get z() { return this.ax[2].p; }
    get vx() { return this.ax[0].v; }
    get vy() { return this.ax[1].v; }
    get vz() { return this.ax[2].v; }
    confidence(now) {
        const recent = this.hits.slice(-10);
        const hr = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
        const last = this.history.slice(-3);
        const rf = last.some((s) => s.rf) ? 1 : 0, eo = last.some((s) => s.eo >= 0) ? 1 : 0;
        return clamp(0.6 * hr + 0.15 * rf + 0.1 * eo + 0.15 * Math.min(1, (now - this.birthT) / 10), 0, 1);
    }
}
export class Perception {
    cond;
    filter;
    tracks = [];
    nextTrackId = 1;
    rRadar;
    rRf;
    rEo;
    rClutter;
    nextRadar = 0;
    nextRf = 0.25;
    nextEo = 0.1;
    constructor(seed, cond, filter = 'kf') {
        this.cond = cond;
        this.filter = filter;
        this.rRadar = Rng.stream(seed, 'radar');
        this.rRf = Rng.stream(seed, 'rf');
        this.rEo = Rng.stream(seed, 'eo');
        this.rClutter = Rng.stream(seed, 'clutter');
    }
    tick(w) {
        const t = w.t, eps = 1e-9;
        if (t + eps >= this.nextRadar) {
            this.radarScan(w);
            this.nextRadar += RADAR_DT;
        }
        if (this.cond.rfEnabled && t + eps >= this.nextRf) {
            this.rfScan(w);
            this.nextRf += RF_DT;
        }
        if (this.cond.eoEnabled && t + eps >= this.nextEo) {
            this.eoScan(w);
            this.nextEo += EO_DT;
        }
    }
    radarDown(t) { return this.cond.radarOutages.some(([a, b]) => t >= a && t <= b); }
    radarScan(w) {
        const t = w.t, c = this.cond, rng = this.rRadar, dets = [];
        if (!this.radarDown(t)) {
            for (const e of w.entities) {
                if (e.status !== 'active' && e.status !== 'aborted')
                    continue;
                const { x, y, z } = e.pos, rg = Math.hypot(x, y), r3 = Math.hypot(rg, z);
                if (r3 > RADAR_RANGE || r3 < 30)
                    continue;
                let snr = e.rcsDb + e.rcsBias - 40 * Math.log10(r3 / 1000) + 60 + c.pdOffsetDb;
                if (z < 25 && rg > 2500)
                    snr -= 6 + (4 * clamp(rg - 2500, 0, 3000)) / 3000; // low-altitude shadowing
                const pd = 0.97 / (1 + Math.exp(-(snr - 9) / 2));
                if (!rng.bernoulli(pd))
                    continue;
                const sr = 12 * c.noise, saz = 0.5 * D2R * c.noise, sz = 15 * c.noise + 0.004 * r3;
                const rm = rg + rng.normal(0, sr), az = Math.atan2(y, x) + rng.normal(0, saz);
                dets.push({ x: rm * Math.cos(az), y: rm * Math.sin(az), z: Math.max(0, z + rng.normal(0, sz)), rcs: e.rcsDb + e.rcsBias + rng.normal(0, 3 * c.noise),
                    iff: rg < 8500 && rng.bernoulli(e.transponderP), truth: e.id, sxy: Math.hypot(sr, rg * saz), sz });
            }
            for (let i = this.rClutter.poisson(c.clutterRate); i > 0; i--) {
                const rg = 9000 * Math.sqrt(this.rClutter.next()), az = this.rClutter.uniform(0, 2 * Math.PI);
                dets.push({ x: rg * Math.cos(az), y: rg * Math.sin(az), z: this.rClutter.uniform(0, 200), rcs: this.rClutter.normal(-30, 4), iff: this.rClutter.bernoulli(0.01),
                    truth: -1, sxy: Math.hypot(12 * c.noise, rg * 0.5 * D2R * c.noise), sz: 20 * c.noise });
            }
        }
        // predict
        for (const tr of this.tracks) {
            const dt = Math.max(0.1, t - tr.lastScanT);
            for (const a of tr.ax)
                a.predict(dt, 16, this.filter);
        }
        // greedy nearest-neighbour association with gating
        const pairs = [];
        this.tracks.forEach((tr, ti) => dets.forEach((d, di) => {
            const dist = Math.hypot(tr.x - d.x, tr.y - d.y, (tr.z - d.z) * 0.5), gate = 200 + 3 * d.sxy + 60 * tr.misses;
            if (dist < gate)
                pairs.push({ ti, di, d: dist });
        }));
        pairs.sort((a, b) => a.d - b.d);
        const usedT = new Set(), usedD = new Set(), assign = new Map();
        for (const p of pairs) {
            if (usedT.has(p.ti) || usedD.has(p.di))
                continue;
            usedT.add(p.ti);
            usedD.add(p.di);
            assign.set(p.ti, p.di);
        }
        this.tracks.forEach((tr, ti) => {
            const dt = Math.max(0.1, t - tr.lastScanT), di = assign.get(ti);
            const pend = tr.pending;
            tr.pending = { rf: false, sig: -1, iff: false, eo: -1 };
            if (di !== undefined) {
                const d = dets[di];
                tr.ax[0].update(d.x, d.sxy ** 2, dt, this.filter);
                tr.ax[1].update(d.y, d.sxy ** 2, dt, this.filter);
                tr.ax[2].update(d.z, d.sz ** 2, dt, this.filter);
                tr.hits.push(1);
                tr.misses = 0;
                tr.history.push({ t, x: tr.x, y: tr.y, z: tr.z, vx: tr.vx, vy: tr.vy, vz: tr.vz, hit: true, rcs: d.rcs, rf: pend.rf, sig: pend.sig, iff: pend.iff || d.iff, eo: pend.eo, truth: d.truth });
            }
            else {
                tr.hits.push(0);
                tr.misses++;
                tr.history.push({ t, x: tr.x, y: tr.y, z: tr.z, vx: tr.vx, vy: tr.vy, vz: tr.vz, hit: false, rcs: null, rf: pend.rf, sig: pend.sig, iff: pend.iff, eo: pend.eo, truth: -2 });
            }
            tr.lastScanT = t;
            if (tr.history.length > 30)
                tr.history.shift();
            if (tr.hits.length > 30)
                tr.hits.shift();
            if (tr.status === 'tentative' && tr.hits.slice(-6).reduce((a, b) => a + b, 0) >= 3)
                tr.status = 'confirmed';
        });
        dets.forEach((d, di) => {
            if (usedD.has(di))
                return;
            const tr = new Track(this.nextTrackId++, t, d.x, d.y, d.z, d.sxy, d.sz);
            tr.hits.push(1);
            tr.history.push({ t, x: d.x, y: d.y, z: d.z, vx: 0, vy: 0, vz: 0, hit: true, rcs: d.rcs, rf: false, sig: -1, iff: d.iff, eo: -1, truth: d.truth });
            this.tracks.push(tr);
        });
        this.tracks = this.tracks.filter((tr) => (tr.status === 'tentative' ? tr.misses < 2 : tr.misses < 6));
    }
    bearingAssign(brgRad, gateRad, rangeLimit) {
        let best = null, bd = gateRad;
        for (const tr of this.tracks) {
            const rg = Math.hypot(tr.x, tr.y);
            if (rg > rangeLimit)
                continue;
            const d = Math.abs(wrapPi(Math.atan2(tr.y, tr.x) - brgRad)) + 0 * rg;
            if (d < bd) {
                bd = d;
                best = tr;
            }
        }
        return best;
    }
    rfScan(w) {
        const rng = this.rRf, c = this.cond;
        for (const e of w.entities) {
            if (!e.emits || (e.status !== 'active' && e.status !== 'aborted'))
                continue;
            const r3 = Math.hypot(e.pos.x, e.pos.y, e.pos.z);
            const pd = 0.92 / (1 + Math.exp((r3 - 5500) / 700));
            if (!rng.bernoulli(pd))
                continue;
            const brg = Math.atan2(e.pos.y, e.pos.x) + rng.normal(0, 3 * D2R * c.noise);
            const sig = rng.bernoulli(0.1) ? rng.int(1, 5) : e.rfSig;
            const tr = this.bearingAssign(brg, 7 * D2R * c.noise + 0.02, 10000);
            if (tr) {
                tr.pending.rf = true;
                tr.pending.sig = sig;
            }
        }
        for (let i = rng.poisson(0.03 * c.clutterRate / 0.6); i > 0; i--) { // false RF alarms
            const tr = this.bearingAssign(rng.uniform(-Math.PI, Math.PI), 7 * D2R * c.noise + 0.02, 10000);
            if (tr) {
                tr.pending.rf = true;
                tr.pending.sig = rng.int(1, 5);
            }
        }
    }
    eoScan(w) {
        const rng = this.rEo, c = this.cond;
        for (const e of w.entities) {
            if (e.status !== 'active' && e.status !== 'aborted')
                continue;
            const r3 = Math.hypot(e.pos.x, e.pos.y, e.pos.z);
            const size = clamp(0.35 + (e.rcsDb + 30) / 60, 0.2, 1);
            if (r3 > c.visibilityM * size || !rng.bernoulli(0.85))
                continue;
            const brg = Math.atan2(e.pos.y, e.pos.x) + rng.normal(0, 0.4 * D2R * c.noise);
            const tr = this.bearingAssign(brg, 2 * D2R * c.noise + 0.01, 10000);
            if (!tr)
                continue;
            if (r3 < 0.35 * c.visibilityM) { // classification hint only at short range
                const truth = isThreatClass(e.cls) ? 0 : e.cls === 'bird' ? 1 : 2;
                tr.pending.eo = rng.bernoulli(0.78) ? truth : rng.pick([0, 1, 2].filter((k) => k !== truth));
            }
            else if (tr.pending.eo < 0)
                tr.pending.eo = 3; // visual contact, no class hint
        }
    }
    confirmed() { return this.tracks.filter((t) => t.status === 'confirmed'); }
    perceived(now) {
        return this.confirmed().map((tr) => {
            const rg = Math.hypot(tr.x, tr.y), last = tr.history[tr.history.length - 1];
            const recent = tr.history.slice(-4);
            const eo = [...recent].reverse().find((s) => s.eo >= 0 && s.eo <= 2);
            return { id: tr.id, status: tr.status, x: tr.x, y: tr.y, z: tr.z, vx: tr.vx, vy: tr.vy, vz: tr.vz, speed: Math.hypot(tr.vx, tr.vy, tr.vz), range: rg,
                bearingDeg: (Math.atan2(tr.x, tr.y) / D2R + 360) % 360, confidence: tr.confidence(now), age: now - tr.birthT, zone: zoneOfRange(rg),
                rf: recent.some((s) => s.rf), iff: recent.some((s) => s.iff), eoHint: eo ? eo.eo : -1 };
        });
    }
}
void ZONES;
