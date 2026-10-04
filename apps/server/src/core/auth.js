import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);

export async function hashPassword(pw) {
  const salt = randomBytes(16), key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$'); if (alg !== 'scrypt') return false;
  const key = await scryptAsync(pw, Buffer.from(saltHex, 'hex'), 64), ref = Buffer.from(keyHex, 'hex');
  return key.length === ref.length && timingSafeEqual(key, ref);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Minimal HS256 JWT (no external dependency). */
export function signToken(payload, secret, ttlS = 8 * 3600, now = Date.now()) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ ...payload, exp: Math.floor(now / 1000) + ttlS });
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
export function verifyToken(token, secret, now = Date.now()) {
  try {
    const [h, p, s] = String(token).split('.'); if (!h || !p || !s) return null;
    const ref = createHmac('sha256', secret).update(`${h}.${p}`).digest(), got = Buffer.from(s, 'base64url');
    if (ref.length !== got.length || !timingSafeEqual(ref, got)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()); return payload.exp * 1000 < now ? null : payload;
  } catch { return null; }
}
/** Tiny in-memory token-bucket rate limiter (per key). */
export function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => { const a = (hits.get(key) ?? []).filter((t) => now - t < windowMs); if (a.length >= limit) { hits.set(key, a); return false; } a.push(now); hits.set(key, a); return true; };
}
