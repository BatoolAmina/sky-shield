import { threatColor } from './labels.js';
/** Pure canvas drawing (no DOM access) so it can be unit-tested with a mock context. World: x east, y north, metres; asset at the centre. */
export function toScreen(x, y, w, h, range) { const s = Math.min(w, h) / 2 - 16; return [w / 2 + (x / range) * s, h / 2 - (y / range) * s]; }
export function drawScene(ctx, w, h, frame, opts = {}) {
  const { selectedId = null, range = 9000, showTruth = false } = opts, zones = frame?.zones ?? { restricted: 1500, warning: 4000, outer: 9000 };
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0a1620'; ctx.fillRect(0, 0, w, h);
  const [cx, cy] = [w / 2, h / 2], s = Math.min(w, h) / 2 - 16;
  for (const [r, col, label] of [[zones.outer, '#1d3a52', 'outer'], [zones.warning, '#8a6d1d', 'warning'], [zones.restricted, '#8a2d2d', 'restricted']]) {
    ctx.beginPath(); ctx.arc(cx, cy, (r / range) * s, 0, Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = col; ctx.font = '10px sans-serif'; ctx.fillText(label, cx + 4, cy - (r / range) * s - 3);
  }
  ctx.strokeStyle = '#143045'; ctx.beginPath(); ctx.moveTo(cx, 8); ctx.lineTo(cx, h - 8); ctx.moveTo(8, cy); ctx.lineTo(w - 8, cy); ctx.stroke(); ctx.fillStyle = '#4c7a9c'; ctx.fillText('N', cx + 4, 14);
  ctx.fillStyle = '#7fe0ff'; ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 6, cy + 5); ctx.lineTo(cx - 6, cy + 5); ctx.closePath(); ctx.fill();
  if (showTruth && frame?.truth) for (const e of frame.truth) { const [x, y] = toScreen(e.x, e.y, w, h, range); ctx.strokeStyle = e.status === 'aborted' ? '#888' : '#ffffff'; ctx.strokeRect(x - 6, y - 6, 12, 12); ctx.fillStyle = '#cfd8dc'; ctx.font = '9px sans-serif'; ctx.fillText(e.cls.replace('_', ' '), x + 8, y - 6); }
  for (const t of frame?.tracks ?? []) {
    const [x, y] = toScreen(t.x, t.y, w, h, range), p = t.mentor?.threat, col = t.classified === 'threat' ? '#ff4d4d' : t.classified ? '#6fdc8c' : threatColor(p);
    if (t.vx !== undefined) { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (t.vx / range) * s * 12, y - (t.vy / range) * s * 12); ctx.stroke(); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, t.id === selectedId ? 6 : 4, 0, Math.PI * 2); ctx.fill();
    if (t.id === selectedId) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1.5; }
    ctx.fillStyle = '#d6e4ee'; ctx.font = '10px sans-serif'; ctx.fillText(`T${t.id}`, x + 8, y + 3);
  }
}
export function pickTrack(frame, w, h, px, py, range = 9000, radius = 14) {
  let best = null, bd = radius; for (const t of frame?.tracks ?? []) { const [x, y] = toScreen(t.x, t.y, w, h, range), d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = t.id; } } return best;
}
