import { createPublicKey, verify } from 'node:crypto';

let cachedKeys = null;
let keysExpireAt = 0;

async function googleKeys(now, fetchImpl) {
  if (cachedKeys && keysExpireAt > now) return cachedKeys;
  const response = await fetchImpl('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Google public key request failed (${response.status})`);
  const { keys } = await response.json();
  if (!Array.isArray(keys)) throw new Error('Google public key response is malformed');
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 300);
  cachedKeys = keys;
  keysExpireAt = now + Math.max(60, Math.min(maxAge, 21_600)) * 1000;
  return keys;
}

export async function verifyGoogleIdToken(token, clientId, now = Date.now(), fetchImpl = fetch) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, claims, signature;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    signature = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || signature.length === 0) return null;
  const keys = await googleKeys(now, fetchImpl);
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig' && key.alg === 'RS256');
  if (!jwk) return null;
  const validSignature = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), signature);
  if (!validSignature) return null;
  const seconds = Math.floor(now / 1000);
  const audienceMatches = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  const authorizedPartyMatches = !claims.azp || claims.azp === clientId;
  const issuerMatches = claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!audienceMatches || !authorizedPartyMatches || !issuerMatches || !emailVerified ||
      typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' ||
      typeof claims.exp !== 'number' || claims.exp < seconds - 300 ||
      typeof claims.iat !== 'number' || claims.iat > seconds + 300) return null;
  return { sub: claims.sub, email: claims.email, name: typeof claims.name === 'string' ? claims.name : undefined };
}
