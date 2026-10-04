import { clamp, wrapPi } from './rng.js';
import { ZONES } from './types.js';
const hyp2 = (x, y) => Math.hypot(x, y);
export function steer(e, psiDes, speedDes, altDes, dt) {
    const maxd = e.maxTurn * dt;
    e.psi = wrapPi(e.psi + clamp(wrapPi(psiDes - e.psi), -maxd, maxd));
    e.speed = clamp(e.speed + clamp(speedDes - e.speed, -e.maxAccel * dt, e.maxAccel * dt), 0, e.maxSpeed);
    const vzDes = clamp((altDes - e.pos.z) * 0.5, -e.maxClimb, e.maxClimb);
    e.vz += (vzDes - e.vz) * Math.min(1, 2 * dt);
    e.pos.x += Math.cos(e.psi) * e.speed * dt;
    e.pos.y += Math.sin(e.psi) * e.speed * dt;
    e.pos.z = Math.max(2, e.pos.z + e.vz * dt);
}
/** Boids rules (separation / alignment / cohesion) + goal attraction. Weights follow the synopsis: 1.5 / 1.0 / 1.0. */
export function boidsHeading(e, mates, goal, w) {
    let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0;
    for (const m of mates) {
        if (m.id === e.id)
            continue;
        const dx = e.pos.x - m.pos.x, dy = e.pos.y - m.pos.y, d = hyp2(dx, dy);
        if (d > 600)
            continue;
        n++;
        cx += m.pos.x;
        cy += m.pos.y;
        ax += Math.cos(m.psi);
        ay += Math.sin(m.psi);
        if (d < 60 && d > 0.1) {
            sx += (dx / d) * (60 / d);
            sy += (dy / d) * (60 / d);
        }
    }
    let vx = 0, vy = 0;
    const sn = hyp2(sx, sy);
    if (sn > 0) {
        const k = Math.min(sn, 2) / sn;
        vx += w.sep * sx * k;
        vy += w.sep * sy * k;
    }
    if (n > 0) {
        const an = hyp2(ax, ay);
        if (an > 1e-6) {
            vx += w.ali * ax / an;
            vy += w.ali * ay / an;
        }
        const ccx = cx / n - e.pos.x, ccy = cy / n - e.pos.y, cd = hyp2(ccx, ccy);
        if (cd > 1e-6) {
            const k = Math.min(1, cd / 200);
            vx += w.coh * k * ccx / cd;
            vy += w.coh * k * ccy / cd;
        }
    }
    const gx = goal.x - e.pos.x, gy = goal.y - e.pos.y, gd = hyp2(gx, gy);
    if (gd > 1e-6) {
        vx += w.goal * gx / gd;
        vy += w.goal * gy / gd;
    }
    return Math.atan2(vy, vx);
}
export function updateBehaviour(e, c) {
    const { t, dt, asset, rng } = c;
    const dx = asset.x - e.pos.x, dy = asset.y - e.pos.y, range = hyp2(dx, dy), brg = Math.atan2(dy, dx);
    const b = e.beh;
    if (e.status === 'aborted') {
        steer(e, Math.atan2(-dy, -dx), e.maxSpeed * 0.9, e.pos.z, dt);
        return;
    }
    if (e.engaged > 0)
        e.engaged = Math.max(0, e.engaged - dt);
    const goalOf = () => {
        if (b.waypoint) {
            if (hyp2(b.waypoint.x - e.pos.x, b.waypoint.y - e.pos.y) < 500)
                b.waypoint = undefined;
            else
                return b.waypoint;
        }
        return asset;
    };
    switch (b.kind) {
        case 'surveillance': {
            const R = b.p.R, dir = b.p.dir;
            if (b.state === 'approach') {
                steer(e, brg, e.speed > 0 ? b.p.v : b.p.v, b.p.alt, dt);
                if (range <= R * 1.05) {
                    b.state = 'loiter';
                    b.tNext = t + b.p.loiterT;
                }
            }
            else if (b.state === 'loiter') {
                const err = clamp((range - R) / R, -1, 1);
                let v = b.p.v;
                if (t > b.p.hoverT0 && t < b.p.hoverT0 + b.p.hoverLen)
                    v = 2 + 2 * rng.next(); // occasional hover
                steer(e, brg + dir * (Math.PI / 2) * (1 - err), v, b.p.alt + 6 * Math.sin(t / 9), dt);
                if (t >= b.tNext)
                    b.state = 'leave';
            }
            else {
                steer(e, Math.atan2(-dy, -dx), e.maxSpeed * 0.8, b.p.alt, dt);
            }
            break;
        }
        case 'fast': {
            const g = goalOf();
            let psi = Math.atan2(g.y - e.pos.y, g.x - e.pos.x);
            b.p.wob = (b.p.wob ?? 0) * 0.98 + rng.normal(0, 0.01);
            psi += b.p.wob;
            if (e.engaged > 0) {
                if (t >= b.tNext) {
                    b.p.jink = -(b.p.jink ?? 1);
                    b.tNext = t + 2;
                }
                psi += (b.p.jink ?? 1) * 0.6;
            }
            steer(e, psi, b.p.v * (e.engaged > 0 ? 1.1 : 1), b.p.alt, dt);
            break;
        }
        case 'low': {
            if (t >= b.tNext) {
                b.p.off = rng.normal(0, 0.6);
                b.tNext = t + rng.uniform(3, 8);
            }
            const g = goalOf();
            steer(e, Math.atan2(g.y - e.pos.y, g.x - e.pos.x) + b.p.off, b.p.v * (1 + 0.1 * Math.sin(t / 3)), b.p.alt + 8 * Math.sin(t / 6 + b.p.ph), dt);
            break;
        }
        case 'swarm': {
            const g = goalOf();
            if (e.leader === e.id) {
                steer(e, Math.atan2(g.y - e.pos.y, g.x - e.pos.x), b.p.v, b.p.alt, dt);
            }
            else {
                const lead = c.mates.find((m) => m.id === e.leader && m.status === 'active');
                const goal = lead ? lead.pos : g;
                const psi = boidsHeading(e, c.mates, goal, { sep: 1.5, ali: 1.0, coh: 1.0, goal: 1.0 });
                steer(e, psi, lead ? clamp(lead.speed + 0.5 * (hyp2(lead.pos.x - e.pos.x, lead.pos.y - e.pos.y) - 40) / 20, 0, e.maxSpeed) : b.p.v, b.p.alt, dt);
            }
            break;
        }
        case 'bird': {
            if (t >= b.tNext) {
                b.p.vt = clamp(b.p.vt + rng.normal(0, 3), 2, e.maxSpeed);
                b.tNext = t + rng.uniform(2, 6);
                b.p.alt = clamp(b.p.alt + rng.normal(0, 30), 4, 280);
            }
            const turnSigma = (1 - b.p.straight) * 1.4;
            let psi = e.psi + rng.normal(0, turnSigma * Math.sqrt(dt)) + 0.3 * wrapPi(b.p.home - e.psi) * dt;
            if (c.mates.length > 1)
                psi = boidsHeading(e, c.mates, { x: e.pos.x + Math.cos(psi) * 300, y: e.pos.y + Math.sin(psi) * 300 }, { sep: 1.5, ali: 0.6, coh: 1.0, goal: 0.8 });
            steer(e, psi, b.p.vt, b.p.alt, dt);
            break;
        }
        case 'transit': {
            const tx = b.waypoint.x - e.pos.x, ty = b.waypoint.y - e.pos.y;
            b.p.wob = (b.p.wob ?? 0) * 0.99 + rng.normal(0, 0.004);
            steer(e, Math.atan2(ty, tx) + b.p.wob, b.p.v, b.p.alt, dt);
            break;
        }
    }
    void ZONES;
}
