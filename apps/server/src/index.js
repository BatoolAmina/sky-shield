/* SkyShield Trainer server: Express (REST) + ws (live sessions) + MongoDB (Mongoose) with an in-memory/JSON fallback store. */
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { MemoryStore, MongoStore } from './core/store.js';
import { loadModel } from './core/model.js';
import { SessionManager } from './core/sessionManager.js';
import { createApi } from './api.js';
import { verifyToken, rateLimiter } from './core/auth.js';

const config = loadConfig();
if (config.jwtGenerated) console.warn('[server] JWT_SECRET not set: using a random secret (tokens are invalidated on restart). Set JWT_SECRET for production.');
const store = config.mongoUri ? await MongoStore.connect(config.mongoUri) : new MemoryStore(config.dataFile);
console.log(`[server] store: ${config.mongoUri ? 'MongoDB' : config.dataFile ? `JSON file ${config.dataFile}` : 'in-memory'}`);
const model = loadModel(config.modelPath); console.log(model ? `[server] mentor model loaded (${model.trees.length} trees)` : `[server] no model at ${config.modelPath}: mentor disabled (run the ML pipeline first)`);
const modelSummary = existsSync(config.summaryPath) ? JSON.parse(readFileSync(config.summaryPath, 'utf8')) : null;
const manager = new SessionManager({ store, model }), api = createApi({ store, manager, config, modelSummary });

const { default: express } = await import('express'), { WebSocketServer } = await import('ws');
const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); next(); });
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.webOrigins.includes(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type,Cache-Control',
      'Vary': 'Origin',
    });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && !config.webOrigins.includes(origin) ? 403 : 204);
  next();
});
app.all('/api/*', async (req, res) => { const r = await api.handle(req.method, req.path, { body: req.body, headers: req.headers, ip: req.ip }); res.status(r.status).json(r.body); });
if (existsSync(config.webDist)) { app.use(express.static(config.webDist)); app.get('*', (req, res) => res.sendFile('index.html', { root: config.webDist })); }

const server = http.createServer(app), wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 }), msgLimit = rateLimiter(60, 1000);
wss.on('connection', async (ws, req) => {
  if (config.webOrigins.length && !config.webOrigins.includes(req.headers.origin)) return ws.close(1008, 'origin not allowed');
  const q = new URL(req.url, 'http://x').searchParams, p = verifyToken(q.get('token'), config.jwtSecret), user = p && (await store.findOne('users', { _id: p.sub }));
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  if (!user) { send({ type: 'error', error: 'unauthorised' }); return ws.close(); }
  if (q.get('mode') === 'dashboard') {
    const unsubscribe = manager.subscribeDashboard((event) => {
      if (event.userId === user._id || user.role === 'instructor' || user.role === 'admin' || !event.userId) send({ type: 'refresh', at: event.at, kind: event.kind });
    });
    send({ type: 'ready' });
    ws.on('close', unsubscribe);
    return;
  }
  const conn = manager.attach({ user, sessionId: q.get('session'), mode: q.get('mode') === 'observe' ? 'observe' : 'play', send }); if (!conn) return ws.close();
  ws.on('message', (raw) => { if (!msgLimit(user._id)) return; try { conn.onMessage(JSON.parse(raw.toString())); } catch { send({ type: 'error', error: 'bad message' }); } });
  ws.on('close', () => conn.close());
});
server.listen(config.port, () => console.log(`[server] http://localhost:${config.port}  (instructor sign-up code: ${config.instructorCode === 'instructor-demo' ? 'instructor-demo  <- change via INSTRUCTOR_CODE' : '(custom)'})`));
