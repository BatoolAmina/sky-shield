import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyGoogleIdToken } from '../src/core/googleAuth.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const fetchKeys = async (url) => {
  assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
  return { ok: true, headers: { get: () => 'public, max-age=3600' }, json: async () => ({ keys: [jwk] }) };
};
const makeToken = (claims, key = privateKey) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const content = `${header}.${payload}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), key).toString('base64url')}`;
};

test('Google ID token verification checks signature, audience, issuer, expiry and verified email', async () => {
  const now = Date.now(), seconds = Math.floor(now / 1000);
  const claims = { iss: 'https://accounts.google.com', aud: 'web-client', sub: 'subject-123', email: 'pilot@example.com', email_verified: true, exp: seconds + 3600, iat: seconds, name: 'Pilot' };
  assert.deepEqual(await verifyGoogleIdToken(makeToken(claims), 'web-client', now, fetchKeys), { sub: 'subject-123', email: 'pilot@example.com', name: 'Pilot' });
  assert.equal(await verifyGoogleIdToken(makeToken({ ...claims, aud: 'other-client' }), 'web-client', now, fetchKeys), null);
  assert.equal(await verifyGoogleIdToken(makeToken({ ...claims, email_verified: false }), 'web-client', now, fetchKeys), null);
  assert.equal(await verifyGoogleIdToken(makeToken({ ...claims, exp: seconds - 400 }), 'web-client', now, fetchKeys), null);
  assert.equal(await verifyGoogleIdToken(makeToken({ ...claims, iss: 'untrusted.example' }), 'web-client', now, fetchKeys), null);
  const { privateKey: attackerKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(await verifyGoogleIdToken(makeToken(claims, attackerKey), 'web-client', now, fetchKeys), null);
  assert.equal(await verifyGoogleIdToken('not-a-token', 'web-client', now, fetchKeys), null);
});
