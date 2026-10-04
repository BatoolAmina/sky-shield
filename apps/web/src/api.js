const ls = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })();
let token = ls?.getItem('sky_token') ?? null;
export const auth = { get token() { return token; }, set(t) { token = t; t ? ls?.setItem('sky_token', t) : ls?.removeItem('sky_token'); } };
export async function req(method, path, body) {
  const r = await fetch(`/api${path}`, { method, cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/auth/')) {
      auth.set(null);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('skyshield:unauthorized'));
    }
    const error = new Error(j.error ?? `HTTP ${r.status}`);
    error.status = r.status;
    throw error;
  }
  return j;
}
export function openSocket(sessionId, mode, onMsg) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws', ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&session=${sessionId}&mode=${mode}`);
  ws.onmessage = (e) => onMsg(JSON.parse(e.data)); return ws;
}
export function watchDashboard(onRefresh, onStatus = () => {}) {
  let stopped = false, socket, retryTimer, refreshTimer, retryDelay = 500;
  const connect = () => {
    if (stopped || !token) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&mode=dashboard`);
    socket.onopen = () => { retryDelay = 500; onStatus(true); };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== 'refresh') return;
      clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(onRefresh, 120);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      onStatus(false);
      if (!stopped) {
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10000);
      }
    };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(refreshTimer);
    socket?.close();
  };
}
