import React from 'react';
import { CLASSES, LABEL, RESPONSES, threatColor } from '../labels.js';

export function ProbBars({ probs }) {
  if (!probs) return null;
  return <div className="probs">{CLASSES.map((c, i) => <div key={c} className="prow"><span>{LABEL[c]}</span><div className="bar"><div style={{ width: `${(probs[i] * 100).toFixed(1)}%` }} /></div><b>{(probs[i] * 100).toFixed(0)}%</b></div>)}</div>;
}
export function TrackList({ tracks, selectedId, onSelect }) {
  const rows = [...(tracks ?? [])].sort((a, b) => (b.mentor?.score ?? 0) - (a.mentor?.score ?? 0));
  return (<table className="tracks"><thead><tr><th>Track</th><th>Range</th><th>Speed</th><th>Alt</th><th>Zone</th><th>Mentor score</th><th>You</th></tr></thead><tbody>
    {rows.map((t) => <tr key={t.id} className={t.id === selectedId ? 'sel' : ''} onClick={() => onSelect(t.id)}><td>T{t.id}</td><td>{(t.range / 1000).toFixed(1)} km</td><td>{t.speed.toFixed(0)} m/s</td><td>{t.z.toFixed(0)} m</td>
      <td><span className="chip" style={{ background: threatColor(t.mentor?.threat) }}>{t.mentor ? t.mentor.score.toFixed(0) : '-'}</span></td><td>{t.classified ?? '-'}</td></tr>)}
  </tbody></table>);
}
export function MentorPanel({ track, explanation, onExplain, onTrust }) {
  if (!track) return <div className="card"><h3>Mentor</h3><p className="muted">Select a track.</p></div>;
  const m = track.mentor;
  return (<div className="card"><h3>Mentor on T{track.id}</h3>
    {!m ? <p className="muted">No assessment yet (track too young or mentor model not loaded).</p> : <>
      <p>Threat probability <b>{(m.threat * 100).toFixed(0)}%</b> &middot; priority score <b>{m.score.toFixed(0)}</b>/100 {m.unknown && <span className="chip warn">UNKNOWN-LIKE</span>}</p>
      <div className="row"><span className={`chip ${track.rf ? '' : 'off'}`}>RF {track.rf ? 'yes' : 'no'}</span><span className={`chip ${track.iff ? '' : 'off'}`}>Transponder {track.iff ? 'yes' : 'no'}</span><span className="chip off">Camera: {['drone', 'bird', 'aircraft'][track.eoHint] ?? (track.eoHint === 3 ? 'seen' : 'no')}</span><span className="chip off">Conf {track.confidence.toFixed(2)}</span></div>
      {m.recommended && <div className="rec"><b>Recommended: {m.recommended.action.toUpperCase()}</b><br /><span className="muted">{m.recommended.reason}</span></div>}
      <ProbBars probs={m.probs} />
      <div className="row"><button onClick={() => onExplain(track.id)}>Why?</button><button className="good" onClick={() => onTrust(track.id, true)}>Accept advice</button><button className="warn" onClick={() => onTrust(track.id, false)}>Override</button></div>
      {explanation && explanation.trackId === track.id && explanation.data && <div className="explain"><p>{explanation.data.sentence}</p><ul>{explanation.data.top.map((t) => <li key={t.feature}>{t.feature}: <b>{typeof t.value === 'number' ? t.value.toFixed(2) : t.value}</b> <span className={t.shap > 0 ? 'pos' : 'neg'}>({t.shap > 0 ? '+' : ''}{t.shap.toFixed(2)})</span></li>)}</ul></div>}
    </>}
  </div>);
}
export function ActionPanel({ track, onClassify, onRespond }) {
  const [cls, setCls] = React.useState('');
  if (!track) return null;
  return (<div className="card"><h3>Your decision on T{track.id}</h3>
    <div className="row"><button className="bad" onClick={() => onClassify(track.id, 'threat')}>Threat</button><button className="good" onClick={() => onClassify(track.id, 'nonthreat')}>Non-threat</button>
      <button onClick={() => onClassify(track.id, 'unknown')}>Unknown</button>
      <select value={cls} onChange={(e) => { setCls(e.target.value); if (e.target.value) onClassify(track.id, e.target.value); }}><option value="">specific class...</option>{CLASSES.map((c) => <option key={c} value={c}>{LABEL[c]}</option>)}</select></div>
    <div className="row">{RESPONSES.map(([k, label]) => <button key={k} onClick={() => onRespond(track.id, k)}>{label}</button>)}</div>
    <p className="muted">Shortcuts: T threat, N non-threat, U unknown, M monitor, W warn, E escalate, C ECM, I intercept.</p></div>);
}
export function Feed({ items }) {
  return <div className="card feed"><h3>Event feed</h3>{(items ?? []).slice().reverse().map((f, i) => <div key={i} className={`f ${f.tone}`}><span>{f.t.toFixed(0)}s</span> {f.text}</div>)}</div>;
}
export function ScoreBars({ score }) {
  if (!score) return null; const P = { protect: 35, classification: 25, timeliness: 10, falseAlarm: 10, roe: 15, prioritisation: 5 };
  return <div className="probs">{Object.entries(score.parts).map(([k, v]) => <div key={k} className="prow"><span>{k}</span><div className="bar"><div style={{ width: `${(v / P[k]) * 100}%` }} /></div><b>{v.toFixed(1)}/{P[k]}</b></div>)}</div>;
}

export function PriorityPanel({ tracks, onSubmit }) {
  const [order, setOrder] = React.useState([]);
  const add = (id) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  return (<div className="card"><h3>Priority order</h3><p className="muted">Click tracks from most to least urgent, then submit. Scored against ground-truth urgency.</p>
    <div className="row">{(tracks ?? []).map((t) => <button key={t.id} className={order.includes(t.id) ? 'good' : ''} onClick={() => add(t.id)}>T{t.id}{order.includes(t.id) ? ` #${order.indexOf(t.id) + 1}` : ''}</button>)}</div>
    <div className="row"><button disabled={order.length < 2} onClick={() => { onSubmit(order); setOrder([]); }}>Submit order</button><button className="link" onClick={() => setOrder([])}>Clear</button></div></div>);
}
export function SensorStatus({ sensors }) {
  if (!sensors) return null;
  return <span>{[['radar', 'Radar'], ['rf', 'RF'], ['eo', 'EO']].map(([k, l]) => <span key={k} className={`chip ${sensors[k] ? '' : 'bad'}`} style={{ marginRight: 4 }}>{l} {sensors[k] ? 'OK' : 'DOWN'}</span>)}</span>;
}
