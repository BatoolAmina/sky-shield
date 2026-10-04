/** Deterministic seeded PRNG (sfc32 seeded through splitmix32). Never use Math.random() in sim-core. */
export function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
function splitmix32(seed) {
    let a = seed | 0;
    return () => {
        a = (a + 0x9e3779b9) | 0;
        let t = a ^ (a >>> 16);
        t = Math.imul(t, 0x21f0aaad);
        t = t ^ (t >>> 15);
        t = Math.imul(t, 0x735a2d97);
        return (t ^ (t >>> 15)) >>> 0;
    };
}
export class Rng {
    a;
    b;
    c;
    d;
    spare = null;
    constructor(seed) {
        const sm = splitmix32(seed);
        this.a = sm();
        this.b = sm();
        this.c = sm();
        this.d = sm();
        for (let i = 0; i < 16; i++)
            this.u32();
    }
    /** Independent stream per (seed,label): adding draws in one subsystem never shifts another. */
    static stream(seed, label) { return new Rng((hashStr(label) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0); }
    u32() {
        let t = (this.a + this.b) | 0;
        this.a = this.b ^ (this.b >>> 9);
        this.b = (this.c + (this.c << 3)) | 0;
        this.c = (this.c << 21) | (this.c >>> 11);
        this.d = (this.d + 1) | 0;
        t = (t + this.d) | 0;
        this.c = (this.c + t) | 0;
        return t >>> 0;
    }
    next() { return this.u32() / 4294967296; }
    uniform(a, b) { return a + (b - a) * this.next(); }
    int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
    bernoulli(p) { return this.next() < p; }
    normal(mu = 0, sd = 1) {
        if (this.spare !== null) {
            const s = this.spare;
            this.spare = null;
            return mu + sd * s;
        }
        let u = 0;
        while (u < 1e-12)
            u = this.next();
        const v = this.next(), m = Math.sqrt(-2 * Math.log(u));
        this.spare = m * Math.sin(2 * Math.PI * v);
        return mu + sd * m * Math.cos(2 * Math.PI * v);
    }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    weighted(items, w) {
        let s = 0;
        for (const x of w)
            s += x;
        let r = this.next() * s;
        for (let i = 0; i < items.length; i++) {
            r -= w[i];
            if (r <= 0)
                return items[i];
        }
        return items[items.length - 1];
    }
    poisson(lambda) {
        const L = Math.exp(-lambda);
        let k = 0, p = 1;
        do {
            k++;
            p *= this.next();
        } while (p > L && k < 100);
        return k - 1;
    }
    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
    beta(a, b) {
        const x = this.gamma(a), y = this.gamma(b);
        return x / (x + y);
    }
    gamma(k) {
        if (k < 1)
            return this.gamma(k + 1) * Math.pow(this.next(), 1 / k);
        const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
        for (;;) {
            let x, v;
            do {
                x = this.normal();
                v = 1 + c * x;
            } while (v <= 0);
            v = v * v * v;
            const u = this.next();
            if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v)))
                return d * v;
        }
    }
}
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const wrapPi = (a) => { while (a > Math.PI)
    a -= 2 * Math.PI; while (a < -Math.PI)
    a += 2 * Math.PI; return a; };
