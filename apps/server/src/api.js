import { SCENARIOS, scenarioById } from '../../../packages/sim-core/src/index.js';
import { hashPassword, verifyPassword, signToken, verifyToken, rateLimiter } from './core/auth.js';
import { verifyGoogleIdToken } from './core/googleAuth.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const pub = (u) => ({ id: u._id, username: u.username, displayName: u.displayName ?? null, role: u.role, rating: u.rating, history: (u.history ?? []).slice(-20) });
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const SITE_DEFAULTS = Object.freeze({
  heroKicker: 'AI-enabled drone & counter-drone threat simulation trainer',
  heroHeading: 'Read the picture.',
  heroAccent: 'Make the call.',
  heroDescription: 'Train against synthetic drone and airspace threats in repeatable scenarios. Compare simulated sensor tracks, inspect explainable AI mentor assessments, practice abstract counter-drone decisions, and review the outcome after each run.',
  heroCta: 'Start a training run',
  scenariosEyebrow: 'PRACTICE WITH PURPOSE',
  scenariosHeading: 'Scenarios built around uncertainty.',
  scenariosDescription: 'Every run is seeded, repeatable and designed to reward careful assessment.',
  showcaseEyebrow: 'INSIDE A SKYSHIELD EXERCISE',
  showcaseHeading: 'A complete picture.',
  showcaseAccent: 'From first signal to final review.',
  showcaseDescription: 'The most important moments of training, brought together in one calm, focused workspace.',
  finalHeading: 'Make room to think. Make every run count.',
  finalDescription: 'Create a training account, choose your first scenario and see how the full replayable learning loop works.',
});
const SITE_KEYS = Object.keys(SITE_DEFAULTS);
const siteContent = (saved) => {
  const value = { ...SITE_DEFAULTS, ...(saved?.value ?? {}) };
  if (value.heroKicker === 'A decision simulator built around the hard parts') value.heroKicker = SITE_DEFAULTS.heroKicker;
  if (value.heroDescription === 'Separate an unknown drone from birds and friendly traffic. Compare imperfect sensor tracks, inspect the mentor’s evidence, then replay the run to see what your decision changed.') value.heroDescription = SITE_DEFAULTS.heroDescription;
  return value;
};
const EVENT_KINDS = new Set(['surveillance', 'fast', 'low', 'swarm', 'bird', 'friendly', 'civil']);
const EVENT_TACTICS = new Set(['direct', 'flank', 'low_altitude', 'decoy_split', 'saturation']);
const settingKey = (key) => ({ key });
const publicScenario = (scenario, patch = {}) => ({ ...scenario, ...patch, adaptive: !!scenario.adaptive, events: patch.events ?? scenario.events, overrides: patch.overrides ?? scenario.overrides });
function validateScenarioPatch(body) {
  const patch = {};
  if (typeof body?.name === 'string' && body.name.trim() && body.name.length <= 100) patch.name = body.name.trim();
  else return 'scenario name is required (max 100 characters)';
  if (typeof body.brief !== 'string' || !body.brief.trim() || body.brief.length > 1000) return 'scenario brief is required (max 1000 characters)';
  patch.brief = body.brief.trim();
  if (!Number.isInteger(body.difficulty) || body.difficulty < 1 || body.difficulty > 5) return 'difficulty must be between 1 and 5';
  patch.difficulty = body.difficulty;
  if (!Number.isInteger(body.durationS) || body.durationS < 30 || body.durationS > 600) return 'duration must be between 30 and 600 seconds';
  patch.durationS = body.durationS;
  if (!Array.isArray(body.events) || body.events.length > 40) return 'events must be an array of at most 40 entries';
  for (const event of body.events) {
    if (!event || typeof event !== 'object' || Array.isArray(event) || !Number.isFinite(event.at) || event.at < 0 || event.at > body.durationS || !event.spec || typeof event.spec !== 'object' || Array.isArray(event.spec)) return 'each event needs a valid time and spawn specification';
    if (Object.keys(event).some((key) => !['at', 'spec', 'when'].includes(key))) return 'event contains an unsupported field';
    if (Object.keys(event.spec).some((key) => !['kind', 'n', 'decoy', 'tactic', 'lowAlt', 'brgDeg', 'range'].includes(key))) return 'spawn specification contains an unsupported field';
    if (!EVENT_KINDS.has(event.spec.kind)) return 'event kind is not supported';
    if (event.spec.n !== undefined && (!Number.isInteger(event.spec.n) || event.spec.n < 1 || event.spec.n > 30)) return 'event count must be between 1 and 30';
    if (event.spec.tactic !== undefined && !EVENT_TACTICS.has(event.spec.tactic)) return 'event tactic is not supported';
    if (event.spec.decoy !== undefined && typeof event.spec.decoy !== 'boolean') return 'event decoy flag must be boolean';
    if (event.spec.lowAlt !== undefined && typeof event.spec.lowAlt !== 'boolean') return 'event low-altitude flag must be boolean';
    if (event.spec.brgDeg !== undefined && (!Number.isFinite(event.spec.brgDeg) || Math.abs(event.spec.brgDeg) > 360)) return 'event bearing must be between -360 and 360 degrees';
    if (event.spec.range !== undefined && (!Number.isFinite(event.spec.range) || event.spec.range < 0 || event.spec.range > 100000)) return 'event range is outside the supported range';
    if (event.when !== undefined && event.when !== 'if_first_wave_cleared_early') return 'event condition is not supported';
  }
  patch.events = structuredClone(body.events);
  if (body.overrides !== undefined) {
    if (!body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)) return 'overrides must be an object';
    const allowed = ['noiseScale', 'clutterScale', 'visibilityScale'];
    if (Object.keys(body.overrides).some((key) => !allowed.includes(key))) return 'unsupported scenario override';
    for (const value of Object.values(body.overrides)) if (!Number.isFinite(value) || value < 0.1 || value > 10) return 'override values must be between 0.1 and 10';
    patch.overrides = structuredClone(body.overrides);
  }
  return patch;
}

/** Framework-agnostic REST layer: handle(method, path, {body, headers, ip}) -> {status, body}. Express is only a thin adapter (index.js). */
export function createApi({ store, manager, config, modelSummary = null, googleVerify = verifyGoogleIdToken }) {
  const authLimit = rateLimiter(20, 60_000), routes = [];
  let scenarioCache = null, scenarioCacheAt = 0;
  async function scenarioCatalog() {
    if (scenarioCache && Date.now() - scenarioCacheAt < 1000) return scenarioCache;
    const settings = await store.find('settings', {}, { projection: { key: 1, value: 1 } });
    const overrides = new Map(settings.map((setting) => [setting.key, setting.value]));
    scenarioCache = SCENARIOS.map((scenario) => publicScenario(scenario, overrides.get(`scenario:${scenario.id}`) ?? {}));
    scenarioCacheAt = Date.now();
    return scenarioCache;
  }
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:[a-z]+/g, '([^/]+)') + '$'), handler, ...opts });
  async function userFrom(headers) {
    const h = headers.authorization ?? headers.Authorization ?? ''; const p = verifyToken(h.replace(/^Bearer /, ''), config.jwtSecret);
    if (!p) return null; return store.findOne('users', { _id: p.sub });
  }
  const tokenFor = (u) => signToken({ sub: u._id, role: u.role }, config.jwtSecret);

  route('GET', '/api/health', async () => ({ ok: true, mentor: !!manager.model }), { auth: false });
  route('GET', '/api/auth/config', async () => ({ googleClientId: config.googleClientId, adminSignupEnabled: Boolean(config.adminCode) }), { auth: false });
  route('GET', '/api/site-content', async () => {
    const saved = await store.findOne('settings', settingKey('site-content'));
    return siteContent(saved);
  }, { auth: false });
  route('POST', '/api/auth/register', async ({ body, ip }) => {
    if (!authLimit(`reg:${ip}`)) throw err(429, 'too many requests');
    const { username, email, displayName, password, instructorCode, adminCode } = body ?? {};
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username ?? '')) throw err(400, 'username must be 3-32 chars (letters, digits, _ . -)');
    if (typeof password !== 'string' || password.length < 8) throw err(400, 'password must be at least 8 characters');
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalizedEmail && (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) throw err(400, 'enter a valid email address');
    if (await store.findOne('users', { username })) throw err(409, 'username taken');
    if (normalizedEmail && await store.findOne('users', { email: normalizedEmail })) throw err(409, 'email already in use');
    const role = adminCode ? (config.adminCode && adminCode === config.adminCode ? 'admin' : (() => { throw err(403, 'bad admin code'); })()) : instructorCode ? (instructorCode === config.instructorCode ? 'instructor' : (() => { throw err(403, 'bad instructor code'); })()) : 'trainee';
    const u = await store.insert('users', { username, ...(normalizedEmail ? { email: normalizedEmail } : {}), ...(typeof displayName === 'string' && displayName.trim() ? { displayName: displayName.trim().slice(0, 80) } : {}), passwordHash: await hashPassword(password), role, rating: 1000, history: [], createdAt: Date.now() });
    return { token: tokenFor(u), user: pub(u) };
  }, { auth: false, status: 201 });
  route('POST', '/api/auth/login', async ({ body, ip }) => {
    if (!authLimit(`login:${ip}`)) throw err(429, 'too many requests');
    const identity = String(body?.username ?? body?.email ?? '').trim();
    const u = await store.findOne('users', { username: identity }) ?? await store.findOne('users', { email: identity.toLowerCase() });
    if (!u || !(await verifyPassword(String(body?.password ?? ''), u.passwordHash))) throw err(401, 'invalid credentials');
    return { token: tokenFor(u), user: pub(u) };
  }, { auth: false });
  route('POST', '/api/auth/google', async ({ body, ip }) => {
    if (!authLimit(`google:${ip}`)) throw err(429, 'too many requests');
    if (!config.googleClientId) throw err(503, 'Google sign-in is not configured');
    if (typeof body?.credential !== 'string' || body.credential.length > 10_000) throw err(401, 'invalid Google credential');
    let claims;
    try { claims = await googleVerify(body.credential, config.googleClientId); }
    catch { throw err(503, 'Google sign-in is temporarily unavailable'); }
    if (!claims?.sub || !claims.email) throw err(401, 'Google credential is invalid or expired');
    const email = claims.email.trim().toLowerCase();
    let u = await store.findOne('users', { googleId: claims.sub });
    if (!u) {
      if (await store.findOne('users', { email })) throw err(409, 'an account with this email already exists; sign in with your password');
      const local = email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '.').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 24);
      const base = local.length >= 3 ? local : 'pilot';
      let username = base;
      if (await store.findOne('users', { username })) username = `${base.slice(0, 23)}-${claims.sub.slice(-8)}`;
      u = await store.insert('users', { username, email, ...(claims.name ? { displayName: String(claims.name).slice(0, 80) } : {}), googleId: claims.sub, role: 'trainee', rating: 1000, history: [], createdAt: Date.now() });
    }
    return { token: tokenFor(u), user: pub(u) };
  }, { auth: false });
  route('GET', '/api/me', async ({ user }) => pub(user));
  route('GET', '/api/scenarios', async () => (await scenarioCatalog()).map(({ id, name, brief, difficulty, durationS, adaptive }) => ({ id, name, brief, difficulty, durationS, adaptive })));
  route('GET', '/api/model', async () => ({ available: !!manager.model, summary: modelSummary }));
  route('GET', '/api/leaderboard', async () => (await store.find('users', {}, { sort: { rating: -1 }, limit: 20 })).map((u) => ({ username: u.username, rating: u.rating, sessions: (u.history ?? []).length })));
  route('GET', '/api/recommend', async ({ user }) => {
    const rating = user.rating ?? 1000;
    const scenarios = await scenarioCatalog();
    const recommended = [...scenarios].sort((a, b) => Math.abs(800 + 300 * a.difficulty - rating) - Math.abs(800 + 300 * b.difficulty - rating))[0];
    return { scenarioId: recommended.id, name: recommended.name, difficulty: recommended.difficulty, rating };
  });
  async function dashboardData(user) {
    const [rows, everyone, topUsers, scenarios, completedRuns, explored] = await Promise.all([
      store.find('sessions', { userId: user._id }, { sort: { createdAt: -1 }, limit: 50, projection: { _id: 1, username: 1, scenarioId: 1, scenarioName: 1, status: 1, createdAt: 1, score: 1, rating: 1 } }),
      store.find('users', {}, { sort: { rating: -1 }, projection: { _id: 1, rating: 1 } }),
      store.find('users', {}, { sort: { rating: -1 }, limit: 20, projection: { username: 1, rating: 1, history: 1 } }),
      scenarioCatalog(),
      store.count('sessions', { userId: user._id, status: 'finished' }),
      store.distinct('sessions', 'scenarioId', { userId: user._id }),
    ]);
    const rating = user.rating ?? 1000;
    const recommended = [...scenarios].sort((a, b) => Math.abs(800 + 300 * a.difficulty - rating) - Math.abs(800 + 300 * b.difficulty - rating))[0];
    const leaderboard = topUsers.map((account) => ({ username: account.username, rating: account.rating, sessions: (account.history ?? []).length }));
    return {
      user: pub(user),
      completedRuns,
      scenariosExplored: explored.length,
      rank: everyone.findIndex((account) => account._id === user._id) + 1,
      sessions: rows.map((session) => ({ id: session._id, username: session.username, scenarioId: session.scenarioId, scenarioName: session.scenarioName ?? scenarioById(session.scenarioId)?.name, status: session.status, createdAt: session.createdAt, score: session.score?.total ?? null, rating: session.rating ?? null })),
      scenarios: scenarios.map(({ id, name, brief, difficulty, durationS, adaptive }) => ({ id, name, brief, difficulty, durationS, adaptive })),
      model: { available: !!manager.model, summary: modelSummary },
      recommendation: { scenarioId: recommended.id, name: recommended.name, difficulty: recommended.difficulty, rating },
      leaderboard,
    };
  }
  route('GET', '/api/dashboard', async ({ user }) => dashboardData(user));
  route('POST', '/api/sessions', async ({ user, body }) => {
    const staff = user.role === 'instructor' || user.role === 'admin';
    const scenario = (await scenarioCatalog()).find((item) => item.id === body?.scenarioId);
    return manager.create(user, { scenarioId: body?.scenarioId, scenario, speed: +body?.speed || 1, seed: staff ? body?.seed : undefined, options: staff ? body?.options ?? {} : {} });
  }, { status: 201 });
  route('GET', '/api/admin/site-content', async () => {
    const saved = await store.findOne('settings', settingKey('site-content'));
    return siteContent(saved);
  }, { role: 'admin' });
  route('PUT', '/api/admin/site-content', async ({ body }) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw err(400, 'site content must be an object');
    const value = {};
    for (const key of SITE_KEYS) {
      if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 500) throw err(400, `${key} is required and must be under 500 characters`);
      value[key] = body[key].trim();
    }
    await store.upsert('settings', settingKey('site-content'), { value, updatedAt: Date.now() });
    manager.notifyDashboard({ kind: 'site-content-updated' });
    return { ...value, updatedAt: Date.now() };
  }, { role: 'admin' });
  route('GET', '/api/admin/scenarios', async () => scenarioCatalog(), { role: 'admin' });
  route('PUT', '/api/admin/scenarios/:id', async ({ body, params }) => {
    if (!SCENARIOS.some((scenario) => scenario.id === params[0])) throw err(404, 'scenario not found');
    const patch = validateScenarioPatch(body);
    if (typeof patch === 'string') throw err(400, patch);
    await store.upsert('settings', settingKey(`scenario:${params[0]}`), { value: patch, updatedAt: Date.now() });
    scenarioCache = null;
    manager.notifyDashboard({ kind: 'scenario-updated' });
    return publicScenario(SCENARIOS.find((scenario) => scenario.id === params[0]), patch);
  }, { role: 'admin' });
  route('GET', '/api/admin/users', async () => {
    const [users, sessions] = await Promise.all([
      store.find('users', {}, { projection: { _id: 1, username: 1, displayName: 1, role: 1, rating: 1, history: 1 } }),
      store.find('sessions', {}, { projection: { userId: 1 } }),
    ]);
    const counts = new Map();
    for (const session of sessions) counts.set(session.userId, (counts.get(session.userId) ?? 0) + 1);
    return users.map((user) => ({ ...pub(user), sessionCount: counts.get(user._id) ?? 0 }));
  }, { role: 'admin' });
  route('GET', '/api/admin/sessions', async () => (await store.find('sessions', {}, { sort: { createdAt: -1 }, limit: 500, projection: { _id: 1, username: 1, scenarioId: 1, scenarioName: 1, status: 1, createdAt: 1, score: 1, rating: 1 } })).map((session) => ({
    id: session._id, username: session.username, scenarioId: session.scenarioId, scenarioName: session.scenarioName ?? scenarioById(session.scenarioId)?.name, status: session.status,
    createdAt: session.createdAt, score: session.score?.total ?? null, rating: session.rating ?? null,
  })), { role: 'admin' });
  route('POST', '/api/admin/users/:id/role', async ({ body, params }) => {
    if (!['trainee', 'instructor', 'admin'].includes(body?.role)) throw err(400, 'bad role');
    const u = await store.update('users', params[0], { role: body.role });
    if (!u) throw err(404, 'not found');
    const sessionCount = (await store.find('sessions', { userId: u._id }, { projection: { _id: 1 } })).length;
    manager.notifyDashboard({ kind: 'role-updated' });
    return { ...pub(u), sessionCount };
  }, { role: 'admin' });
  route('GET', '/api/sessions/live', async () => manager.liveList(), { role: 'instructor' });
  route('GET', '/api/sessions', async ({ user }) => {
    const rows = await store.find('sessions', user.role === 'instructor' || user.role === 'admin' ? {} : { userId: user._id }, { sort: { createdAt: -1 }, limit: 50, projection: { _id: 1, username: 1, scenarioId: 1, scenarioName: 1, status: 1, createdAt: 1, score: 1, rating: 1 } });
    return rows.map((s) => ({ id: s._id, username: s.username, scenarioId: s.scenarioId, scenarioName: s.scenarioName ?? scenarioById(s.scenarioId)?.name, status: s.status, createdAt: s.createdAt, score: s.score?.total ?? null, rating: s.rating ?? null }));
  });
  async function ownedSession(user, id) {
    const s = await store.findOne('sessions', { _id: id }); if (!s) throw err(404, 'not found');
    if (s.userId !== user._id && user.role !== 'instructor' && user.role !== 'admin') throw err(403, 'forbidden'); if (s.status !== 'finished') throw err(409, 'session still running'); return s;
  }
  route('GET', '/api/sessions/:id/report', async ({ user, params }) => { const s = await ownedSession(user, params[0]); return { id: s._id, scenarioId: s.scenarioId, scenarioName: s.scenarioName ?? scenarioById(s.scenarioId)?.name, seed: s.seed, score: s.score, aar: s.aar, rating: s.rating, tactic: user.role === 'instructor' || user.role === 'admin' ? s.tactic : undefined }; });
  route('GET', '/api/sessions/:id/replay', async ({ user, params }) => { const s = await ownedSession(user, params[0]); return { frames: s.frames, actions: s.log.filter((l) => l.kind === 'action' || l.kind === 'response_result'), coachNotes: s.coachNotes ?? [], score: s.score, aar: s.aar, scenario: s.scenarioName ?? scenarioById(s.scenarioId)?.name }; });
  route('GET', '/api/analytics', async () => {
    const all = (await store.find('sessions', { status: 'finished' }, { projection: { scenarioId: 1, score: 1 } })).filter((s) => s.score);
    const scenarios = await scenarioCatalog();
    const byScenario = scenarios.map((sc) => { const g = all.filter((s) => s.scenarioId === sc.id); return { scenarioId: sc.id, name: sc.name, sessions: g.length, meanScore: mean(g.map((s) => s.score.total)) }; });
    const st = (k) => all.reduce((a, s) => a + (s.score.stats[k] ?? 0), 0);
    const users = await store.find('users', {}, { sort: { rating: -1 }, projection: { username: 1, role: 1, rating: 1 } });
    return { sessions: all.length, byScenario, commonMistakes: { falseAlarms: st('falseAlarms'), missedThreats: st('missedThreats'), collateral: st('collateral'), roeDenials: st('roeDenials') },
      trust: { decisions: st('mentorDecisions'), adviceCorrect: st('mentorAdviceCorrect') }, ratings: users.map((u) => ({ username: u.username, role: u.role, rating: u.rating })) };
  }, { role: 'instructor' });
  route('GET', '/api/instructor/dashboard', async () => {
    const [recent, finished, users, scenarios] = await Promise.all([
      store.find('sessions', {}, { sort: { createdAt: -1 }, limit: 500, projection: { _id: 1, userId: 1, username: 1, scenarioId: 1, scenarioName: 1, status: 1, createdAt: 1, score: 1, rating: 1 } }),
      store.find('sessions', { status: 'finished' }, { projection: { scenarioId: 1, score: 1 } }),
      store.find('users', {}, { sort: { rating: -1 }, limit: 100, projection: { username: 1, role: 1, rating: 1 } }),
      scenarioCatalog(),
    ]);
    const scored = finished.filter((session) => session.score);
    const byScenario = scenarios.map((scenario) => {
      const group = scored.filter((session) => session.scenarioId === scenario.id);
      return { scenarioId: scenario.id, name: scenario.name, sessions: group.length, meanScore: mean(group.map((session) => session.score.total)) };
    });
    const total = (key) => scored.reduce((sum, session) => sum + (session.score.stats[key] ?? 0), 0);
    return {
      live: manager.liveList(),
      sessions: recent.map((session) => ({ id: session._id, username: session.username, scenarioId: session.scenarioId, scenarioName: session.scenarioName ?? scenarioById(session.scenarioId)?.name, status: session.status, createdAt: session.createdAt, score: session.score?.total ?? null, rating: session.rating ?? null })),
      analytics: {
        sessions: scored.length, byScenario,
        commonMistakes: { falseAlarms: total('falseAlarms'), missedThreats: total('missedThreats'), collateral: total('collateral'), roeDenials: total('roeDenials') },
        trust: { decisions: total('mentorDecisions'), adviceCorrect: total('mentorAdviceCorrect') },
        ratings: users.map((account) => ({ username: account.username, role: account.role, rating: account.rating })),
      },
      model: { available: !!manager.model, summary: modelSummary },
    };
  }, { role: 'instructor' });

  async function handle(method, path, { body = {}, headers = {}, ip = 'local' } = {}) {
    try {
      for (const r of routes) {
        if (r.method !== method) continue; const m = path.match(r.re); if (!m) continue;
        let user = null; if (r.auth !== false) { user = await userFrom(headers); if (!user) throw err(401, 'authentication required'); if (r.role && !(user.role === r.role || (r.role === 'instructor' && user.role === 'admin'))) throw err(403, 'forbidden'); }
        return { status: r.status ?? 200, body: await r.handler({ body, user, params: m.slice(1), ip }) };
      }
      throw err(404, 'not found');
    } catch (e) { return { status: e.status ?? 500, body: { error: e.status ? e.message : 'internal error' } }; }
  }
  return { handle, userFrom };
}
