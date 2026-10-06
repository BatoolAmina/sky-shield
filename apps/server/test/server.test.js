import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { hashPassword, verifyPassword, signToken, verifyToken, rateLimiter } from '../src/core/auth.js';
import { MemoryStore } from '../src/core/store.js';
import { SessionManager, validateAction, difficultyFor, recommendScenario } from '../src/core/sessionManager.js';
import { createApi } from '../src/api.js';
import { loadModel } from '../src/core/model.js';
import { loadConfig } from '../src/config.js';

const config = { ...loadConfig({ JWT_SECRET: 'test-secret' }), instructorCode: 'code123', adminCode: 'admin456' };
const mk = () => { const store = new MemoryStore(), model = loadModel(config.modelPath), manager = new SessionManager({ store, model }); return { store, manager, api: createApi({ store, manager, config }) }; };
const call = (api, m, p, body, tok) => api.handle(m, p, { body, headers: tok ? { authorization: `Bearer ${tok}` } : {} });

test('password hashing and JWT: roundtrip, tamper and expiry', async () => {
  const h = await hashPassword('correct horse'); assert.ok(await verifyPassword('correct horse', h)); assert.ok(!(await verifyPassword('wrong', h)));
  const t = signToken({ sub: 'u1' }, 's', 60); assert.equal(verifyToken(t, 's').sub, 'u1'); assert.equal(verifyToken(t, 'other'), null); assert.equal(verifyToken(t.slice(0, -2) + 'xx', 's'), null);
  assert.equal(verifyToken(signToken({ sub: 'u1' }, 's', 1, 0), 's', 5000), null);
});
test('rate limiter blocks after limit', () => { const rl = rateLimiter(3, 1000); assert.ok(rl('a', 0) && rl('a', 1) && rl('a', 2)); assert.ok(!rl('a', 3)); assert.ok(rl('a', 2000)); });
test('action validation rejects malformed input', () => {
  assert.equal(validateAction({ type: 'classify', trackId: 1, cls: 'threat' }), null); assert.ok(validateAction({ type: 'classify', trackId: -1, cls: 'threat' }));
  assert.ok(validateAction({ type: 'respond', trackId: 1, response: 'nuke' })); assert.ok(validateAction({ type: 'x' })); assert.ok(validateAction(null));
});
test('REST: register/login, roles, scenario list, protected routes', async () => {
  const { api } = mk();
  assert.equal((await call(api, 'GET', '/api/me')).status, 401);
  assert.deepEqual((await call(api, 'GET', '/api/auth/config')).body, { googleClientId: null, adminSignupEnabled: true });
  assert.equal((await call(api, 'POST', '/api/auth/register', { username: 'a', password: 'longenough' })).status, 400);
  const reg = await call(api, 'POST', '/api/auth/register', { username: 'trainee1', email: 'trainee1@example.com', password: 'longenough' }); assert.equal(reg.status, 201); assert.equal(reg.body.user.role, 'trainee');
  assert.equal((await call(api, 'POST', '/api/auth/register', { username: 'nomail', password: 'longenough' })).status, 400);
  assert.equal((await call(api, 'POST', '/api/auth/register', { username: 'trainee1', email: 'trainee1@example.com', password: 'longenough' })).status, 409);
  assert.equal((await call(api, 'POST', '/api/auth/register', { username: 'sneaky', email: 'sneaky@example.com', password: 'longenough', instructorCode: 'nope' })).status, 403);
  const ins = await call(api, 'POST', '/api/auth/register', { username: 'boss', email: 'boss@example.com', password: 'longenough', instructorCode: 'code123' }); assert.equal(ins.body.user.role, 'instructor');
  assert.equal((await call(api, 'POST', '/api/auth/register', { username: 'badadmin', email: 'badadmin@example.com', password: 'longenough', adminCode: 'nope' })).status, 403);
  const admin = await call(api, 'POST', '/api/auth/register', { username: 'admin1', email: 'admin1@example.com', password: 'longenough', adminCode: 'admin456' });
  assert.equal(admin.body.user.role, 'admin');
  assert.equal((await call(api, 'GET', '/api/admin/users', null, admin.body.token)).status, 200);
  assert.equal((await call(api, 'POST', '/api/auth/login', { username: 'trainee1', password: 'bad' })).status, 401);
  const login = await call(api, 'POST', '/api/auth/login', { username: 'trainee1', password: 'longenough' }); assert.equal(login.status, 200);
  assert.equal((await call(api, 'POST', '/api/auth/login', { username: 'TRAINEE1@example.com', password: 'longenough' })).status, 200);
  assert.equal((await call(api, 'POST', '/api/auth/login', { username: 'admin1', password: 'longenough' })).status, 200);
  assert.equal((await call(api, 'GET', '/api/scenarios', null, login.body.token)).body.length, 6);
  assert.equal((await call(api, 'GET', '/api/analytics', null, login.body.token)).status, 403); assert.equal((await call(api, 'GET', '/api/analytics', null, ins.body.token)).status, 200);
});
test('dashboard data and session creation require authentication', async () => {
  const { api } = mk();
  const dashboardRequests = [
    ['GET', '/api/dashboard'],
    ['GET', '/api/scenarios'],
    ['GET', '/api/sessions'],
    ['GET', '/api/model'],
    ['GET', '/api/recommend'],
    ['GET', '/api/leaderboard'],
    ['POST', '/api/sessions', { scenarioId: 'lone-observer' }],
  ];
  for (const [method, path, body] of dashboardRequests) {
    const response = await call(api, method, path, body);
    assert.equal(response.status, 401, `${method} ${path} must reject unauthenticated requests`);
  }
});
test('admin website content and scenario edits are validated, persisted, and consumed by new sessions', async () => {
  const { api, manager, store } = mk();
  const created = await call(api, 'POST', '/api/auth/register', { username: 'siteadmin', email: 'siteadmin@example.com', password: 'longenough', adminCode: 'admin456' });
  const token = created.body.token;
  await store.upsert('settings', { key: 'site-content' }, { value: {
    heroKicker: 'A decision simulator built around the hard parts',
    heroDescription: 'Separate an unknown drone from birds and friendly traffic. Compare imperfect sensor tracks, inspect the mentor’s evidence, then replay the run to see what your decision changed.',
  } });
  assert.equal((await call(api, 'GET', '/api/admin/site-content', null, token)).status, 200);
  assert.equal((await call(api, 'GET', '/api/admin/scenarios', null, token)).body.length, 6);
  assert.equal((await call(api, 'PUT', '/api/admin/site-content', { heroHeading: 'Changed' }, token)).status, 400);
  const content = (await call(api, 'GET', '/api/admin/site-content', null, token)).body;
  assert.match(content.heroKicker, /AI-enabled drone & counter-drone threat simulation trainer/i);
  assert.match(content.heroDescription, /explainable AI mentor assessments/i);
  content.heroHeading = 'Train with better evidence';
  const savedContent = await call(api, 'PUT', '/api/admin/site-content', content, token);
  assert.equal(savedContent.status, 200);
  assert.equal((await call(api, 'GET', '/api/site-content')).body.heroHeading, 'Train with better evidence');

  const edited = await call(api, 'PUT', '/api/admin/scenarios/lone-observer', {
    name: 'Edited Observer',
    brief: 'Updated admin-managed brief.',
    difficulty: 2,
    durationS: 90,
    events: [{ at: 0, spec: { kind: 'surveillance' } }, { at: 12, spec: { kind: 'friendly' } }],
    overrides: { noiseScale: 1.5 },
  }, token);
  assert.equal(edited.status, 200);
  assert.equal((await call(api, 'GET', '/api/scenarios', null, token)).body[0].name, 'Edited Observer');
  assert.equal((await call(api, 'PUT', '/api/admin/scenarios/lone-observer', {
    name: 'Invalid', brief: 'bad schedule', difficulty: 2, durationS: 90,
    events: [{ at: 95, spec: { kind: 'surveillance' } }], overrides: {},
  }, token)).status, 400);

  const started = await call(api, 'POST', '/api/sessions', { scenarioId: 'lone-observer' }, token);
  assert.equal(started.status, 201);
  const live = manager.live.get(started.body.id);
  clearInterval(live.timer);
  live.timer = null;
  assert.equal(live.cfg.scenario.name, 'Edited Observer');
  assert.equal(live.cfg.scenario.events.length, 2);
  assert.equal(live.cfg.scenario.overrides.noiseScale, 1.5);
  await manager.finish(live);
  assert.equal((await call(api, 'GET', `/api/sessions/${started.body.id}/replay`, null, token)).body.scenario, 'Edited Observer');
  assert.equal((await call(api, 'GET', '/api/admin/users', null, token)).body[0].sessionCount, 1);
  assert.equal((await call(api, 'GET', '/api/admin/sessions', null, token)).body[0].scenarioName, 'Edited Observer');
  assert.ok(await store.findOne('settings', { key: 'site-content' }));
});
test('instructor sees all sessions while trainee history remains account-scoped', async () => {
  const { api, manager } = mk();
  const trainee = await call(api, 'POST', '/api/auth/register', { username: 'pilot-one', email: 'pilot-one@example.com', password: 'longenough' });
  const instructor = await call(api, 'POST', '/api/auth/register', { username: 'coach-one', email: 'coach-one@example.com', password: 'longenough', instructorCode: 'code123' });
  const initialDashboard = await call(api, 'GET', '/api/dashboard', null, trainee.body.token);
  assert.equal(initialDashboard.body.completedRuns, 0);
  assert.equal(initialDashboard.body.scenariosExplored, 0);
  assert.equal(initialDashboard.body.scenarios.length, 6);
  assert.ok(initialDashboard.body.recommendation.scenarioId);
  assert.equal(typeof initialDashboard.body.model.available, 'boolean');
  const dashboardEvents = [];
  const unsubscribe = manager.subscribeDashboard((event) => dashboardEvents.push(event));
  const run = await call(api, 'POST', '/api/sessions', { scenarioId: 'lone-observer' }, trainee.body.token);
  const live = manager.live.get(run.body.id);
  clearInterval(live.timer);
  live.timer = null;
  const traineeRows = await call(api, 'GET', '/api/sessions', null, trainee.body.token);
  const instructorRows = await call(api, 'GET', '/api/sessions', null, instructor.body.token);
  assert.equal(traineeRows.body.length, 1);
  assert.equal(instructorRows.body.length, 1);
  await manager.finish(live);
  unsubscribe();
  assert.ok(dashboardEvents.some((event) => event.kind === 'session-started'));
  assert.ok(dashboardEvents.some((event) => event.kind === 'session-finished'));
  const updatedDashboard = await call(api, 'GET', '/api/dashboard', null, trainee.body.token);
  assert.equal(updatedDashboard.body.completedRuns, 1);
  assert.equal(updatedDashboard.body.scenariosExplored, 1);
});
test('Google sign-in validates credentials, provisions users, and avoids implicit email linking', async () => {
  const store = new MemoryStore(), manager = new SessionManager({ store, model: null });
  const api = createApi({
    store, manager, config: { ...config, googleClientId: 'test-client' },
    googleVerify: async (credential) => credential === 'valid' ? { sub: 'google-subject', email: 'pilot@example.com', name: 'Pilot Example' } : null,
  });
  assert.equal((await call(api, 'GET', '/api/auth/config')).body.googleClientId, 'test-client');
  assert.equal((await call(api, 'POST', '/api/auth/google', { credential: 'invalid' })).status, 401);
  const signedIn = await call(api, 'POST', '/api/auth/google', { credential: 'valid' });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.username, 'pilot');
  assert.equal((await api.userFrom({ authorization: 'Bearer ' + signedIn.body.token })).email, 'pilot@example.com');
  assert.equal((await call(api, 'POST', '/api/auth/google', { credential: 'valid' })).body.user.id, signedIn.body.user.id);
  assert.equal((await call(api, 'POST', '/api/auth/register', { username: 'pilot2', email: 'PILOT@example.com', password: 'longenough' })).status, 409);
});
test('full session lifecycle through the manager: play, act, finish, report, Elo, replay, access control', async () => {
  const { api, manager, store } = mk(), tok = (await call(api, 'POST', '/api/auth/register', { username: 'pilot', email: 'pilot@example.com', password: 'longenough' })).body.token;
  const ins = (await call(api, 'POST', '/api/auth/register', { username: 'teach', email: 'teach@example.com', password: 'longenough', instructorCode: 'code123' })).body.token, other = (await call(api, 'POST', '/api/auth/register', { username: 'other', email: 'other@example.com', password: 'longenough' })).body.token;
  const c = await call(api, 'POST', '/api/sessions', { scenarioId: 'lone-observer', seed: 7 }, tok); assert.equal(c.status, 201);
  const live = manager.live.get(c.body.id); clearInterval(live.timer); live.timer = null;       // manual stepping
  const user = await api.userFrom({ authorization: `Bearer ${tok}` }), msgs = []; const conn = manager.attach({ user, sessionId: c.body.id, send: (m) => msgs.push(m) });
  const intruder = await api.userFrom({ authorization: `Bearer ${other}` }); const bad = []; assert.equal(manager.attach({ user: intruder, sessionId: c.body.id, send: (m) => bad.push(m) }), null); assert.equal(bad[0].type, 'error');
  const instructor = await store.findOne('users', { username: 'teach' }), instructorMsgs = []; const observer = manager.attach({ user: instructor, sessionId: c.body.id, mode: 'observe', send: (m) => instructorMsgs.push(m) });
  observer.onMessage({ type: 'coach', text: 'Check the track classification before responding.' });
  assert.ok(msgs.some((m) => m.type === 'coach' && m.data.text === 'Check the track classification before responding.'));
  assert.ok(instructorMsgs.some((m) => m.type === 'coach-ack' && m.ok));
  conn.onMessage({ type: 'coach', text: 'Trainees cannot send instructor coaching.' });
  assert.equal(live.coachNotes.length, 1);
  observer.onMessage({ type: 'coach', text: 'x'.repeat(401) });
  assert.ok(instructorMsgs.some((m) => m.type === 'coach-ack' && !m.ok));
  let acted = false; for (let i = 0; i < 400 && !live.finished; i++) { manager.tick(live, 20); const p = live.session.perceived().tracks[0]; if (p && !acted && live.session.t > 30) { conn.onMessage({ type: 'action', action: { type: 'classify', trackId: p.id, cls: 'threat' } }); acted = true; } }
  await manager.finish(live); assert.ok(msgs.some((m) => m.type === 'frame')); assert.ok(msgs.some((m) => m.type === 'ended'));
  assert.equal((await call(api, 'GET', `/api/sessions/${c.body.id}/report`, null, other)).status, 403);
  const rep = await call(api, 'GET', `/api/sessions/${c.body.id}/report`, null, tok); assert.equal(rep.status, 200); assert.ok(rep.body.score.total >= 0); assert.ok(rep.body.aar.summary);
  assert.equal(rep.body.tactic, undefined); assert.equal((await call(api, 'GET', `/api/sessions/${c.body.id}/report`, null, ins)).status, 200);
  const rp = await call(api, 'GET', `/api/sessions/${c.body.id}/replay`, null, tok); assert.ok(rp.body.frames.length > 10); assert.ok(rp.body.frames[5].truth.length > 0); assert.equal(rp.body.coachNotes.length, 1);
  const u = await store.findOne('users', { username: 'pilot' }); assert.equal(u.history.length, 1); assert.notEqual(u.rating, undefined);
  const lb = await call(api, 'GET', '/api/leaderboard', null, tok); assert.ok(lb.body.length >= 3);
});
test('adaptive scenario: the adversary bandit is persisted per user and updated', async () => {
  const { manager, store } = mk(), u = await store.insert('users', { username: 'x', role: 'trainee', rating: 1000, history: [] });
  const r = await manager.create(u, { scenarioId: 'saturation-night', seed: 3, autoRun: false }); const live = manager.live.get(r.id); for (let i = 0; i < 400 && !live.session.over; i++) manager.tick(live, 20); await manager.finish(live);
  const b = await store.findOne('bandits', { userId: u._id }); assert.ok(b); assert.equal(b.state.n.reduce((a, c) => a + c, 0), 1);
});
test('mentor model (if exported) integrates: tracks carry class probabilities and an explanation is available', async (t) => {
  if (!existsSync(config.modelPath)) return t.skip('model not exported yet');
  const { manager, store } = mk(), u = await store.insert('users', { username: 'm', role: 'trainee', rating: 1000, history: [] }); const r = await manager.create(u, { scenarioId: 'fast-strike', seed: 5, autoRun: false });
  const live = manager.live.get(r.id); manager.tick(live, 20 * 50); const tr = live.session.perceived().tracks.find((x) => x.mentor); assert.ok(tr, 'a track with a mentor assessment'); assert.ok(Math.abs(tr.mentor.probs.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const ex = live.session.explainTrack(tr.id); assert.ok(ex.sentence.startsWith('Classified as')); assert.equal(ex.top.length, 3);
});

test('admin role: needs the admin code, can list users and change roles; staff routes accept admins', async () => {
  const { api } = mk(); assert.equal((await call(api, 'POST', '/api/auth/register', { username: 'fakeadmin', email: 'fakeadmin@example.com', password: 'longenough', adminCode: 'x' })).status, 403);
  const ad = await call(api, 'POST', '/api/auth/register', { username: 'root1', email: 'root1@example.com', password: 'longenough', adminCode: 'admin456' }); assert.equal(ad.body.user.role, 'admin');
  const tr = await call(api, 'POST', '/api/auth/register', { username: 'student', email: 'student@example.com', password: 'longenough' });
  assert.equal((await call(api, 'GET', '/api/admin/users', null, tr.body.token)).status, 403); const list = await call(api, 'GET', '/api/admin/users', null, ad.body.token); assert.equal(list.body.length, 2);
  assert.equal((await call(api, 'GET', '/api/admin/sessions', null, tr.body.token)).status, 403);
  assert.equal((await call(api, 'GET', '/api/admin/sessions', null, ad.body.token)).status, 200);
  assert.equal((await call(api, 'GET', '/api/admin/site-content', null, tr.body.token)).status, 403);
  assert.equal((await call(api, 'PUT', '/api/admin/scenarios/lone-observer', {}, tr.body.token)).status, 403);
  assert.equal((await call(api, 'POST', `/api/admin/users/${tr.body.user.id}/role`, { role: 'instructor' }, ad.body.token)).body.role, 'instructor');
  assert.equal((await call(api, 'POST', `/api/admin/users/${tr.body.user.id}/role`, { role: 'king' }, ad.body.token)).status, 400); assert.equal((await call(api, 'GET', '/api/analytics', null, ad.body.token)).status, 200);
});
test('adaptive difficulty: higher rating -> more noise, clutter and distractors; scenario recommendation tracks rating', async () => {
  const lo = difficultyFor(700), hi = difficultyFor(1600); assert.ok(hi.noiseScale > lo.noiseScale && hi.clutterScale > lo.clutterScale && hi.extra.length > lo.extra.length);
  assert.ok(recommendScenario(800).difficulty < recommendScenario(1700).difficulty);
  const { api, manager, store } = mk(), tok = (await call(api, 'POST', '/api/auth/register', { username: 'adapt', email: 'adapt@example.com', password: 'longenough' })).body.token; const rec = await call(api, 'GET', '/api/recommend', null, tok); assert.equal(rec.status, 200); assert.ok(rec.body.scenarioId);
  const u = await store.findOne('users', { username: 'adapt' }); await store.update('users', u._id, { rating: 1600 }); const r = await manager.create({ ...u, rating: 1600 }, { scenarioId: 'lone-observer', seed: 5, autoRun: false });
  const live = manager.live.get(r.id); assert.ok(live.cfg.scenario.overrides.noiseScale > 1); assert.ok(live.cfg.extraEvents.length >= 2);
});
test('instructor options are honoured, trainee options ignored; live commands (difficulty, sensor failure) are staff-only', async () => {
  const { api, manager } = mk(), tt = (await call(api, 'POST', '/api/auth/register', { username: 'trn1', email: 'trn1@example.com', password: 'longenough' })).body.token, it = (await call(api, 'POST', '/api/auth/register', { username: 'inst1', email: 'inst1@example.com', password: 'longenough', instructorCode: 'code123' })).body.token;
  const a = await call(api, 'POST', '/api/sessions', { scenarioId: 'lone-observer', seed: 9, options: { visibilityScale: 0.3 } }, tt), b = await call(api, 'POST', '/api/sessions', { scenarioId: 'lone-observer', seed: 9, options: { visibilityScale: 0.3, noiseScale: 2 } }, it);
  const la = manager.live.get(a.body.id), lb = manager.live.get(b.body.id); [la, lb].forEach((l) => { clearInterval(l.timer); l.timer = null; });
  assert.equal(la.cfg.scenario.overrides.visibilityScale, undefined); assert.equal(lb.cfg.scenario.overrides.visibilityScale, 0.3); assert.ok(lb.cfg.scenario.overrides.noiseScale >= 2);
  const trainee = await api.userFrom({ authorization: `Bearer ${tt}` }), staff = await api.userFrom({ authorization: `Bearer ${it}` }), out = [];
  const owner = manager.attach({ user: trainee, sessionId: a.body.id, send: (m) => out.push(m) }); owner.onMessage({ type: 'cmd', cmd: 'sensor', sensor: 'rf', on: false }); owner.onMessage({ type: 'cmd', cmd: 'difficulty', level: 5 });
  assert.equal(la.session.world.cfg.cond.rfEnabled, true, 'trainee cannot inject failures');
  const obs = manager.attach({ user: staff, sessionId: a.body.id, mode: 'observe', send: (m) => out.push(m) }); obs.onMessage({ type: 'cmd', cmd: 'sensor', sensor: 'rf', on: false }); obs.onMessage({ type: 'cmd', cmd: 'difficulty', level: 5 });
  assert.equal(la.session.world.cfg.cond.rfEnabled, false); assert.ok(la.session.log.some((l) => l.kind === 'difficulty'));
});
test('mentor recommends an action and unknown-likeness once the model is loaded', async (t) => {
  if (!existsSync(config.modelPath)) return t.skip('model not exported'); const { manager, store } = mk(), u = await store.insert('users', { username: 'rec', role: 'trainee', rating: 1000, history: [] });
  const r = await manager.create(u, { scenarioId: 'fast-strike', seed: 5, autoRun: false }), live = manager.live.get(r.id); manager.tick(live, 20 * 70);
  const tr = live.session.perceived().tracks.filter((x) => x.mentor); assert.ok(tr.length); assert.ok(tr.every((x) => ['monitor', 'warn', 'escalate', 'ecm', 'intercept'].includes(x.mentor.recommended.action) && typeof x.mentor.unknown === 'boolean'));
});
