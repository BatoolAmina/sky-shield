import React, { useEffect, useRef, useState, useCallback } from 'react';
import { openSocket } from '../api.js';
import Tactical from '../components/Tactical.jsx';
import { TrackList, MentorPanel, ActionPanel, Feed, PriorityPanel, SensorStatus } from '../components/Panels.jsx';

export default function Trainee({ id, go }) {
  const [frame, setFrame] = useState(null), [sel, setSel] = useState(null), [expl, setExpl] = useState(null), [msg, setMsg] = useState(''), [coachNotes, setCoachNotes] = useState([]), ws = useRef(null);
  useEffect(() => {
    const s = openSocket(id, 'play', (m) => {
      if (m.type === 'frame') setFrame(m.data); else if (m.type === 'explanation') setExpl(m); else if (m.type === 'ack') setMsg(m.ok ? '' : m.reason);
      else if (m.type === 'coach') setCoachNotes((notes) => [...notes, m.data]);
      else if (m.type === 'ended') go(`/review/${id}`); else if (m.type === 'error') setMsg(m.error);
    }); ws.current = s; return () => s.close();
  }, [id]);
  const send = useCallback((o) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(o)), []);
  const classify = (trackId, cls) => send({ type: 'action', action: { type: 'classify', trackId, cls } });
  const respond = (trackId, response) => send({ type: 'action', action: { type: 'respond', trackId, response } });
  const track = frame?.tracks.find((t) => t.id === sel);
  useEffect(() => {
    const h = (e) => { if (!sel || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase();
      if (k === 't') classify(sel, 'threat'); else if (k === 'n') classify(sel, 'nonthreat'); else if (k === 'u') classify(sel, 'unknown'); else { const r = { m: 'monitor', w: 'warn', e: 'escalate', c: 'ecm', i: 'intercept' }[k]; if (r) respond(sel, r); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [sel]);
  return (<div><div className="topbar"><b>t = {frame ? frame.t.toFixed(0) : 0}s / {frame?.duration ?? '-'}s</b><span>Impacts: <b className={frame?.impacts ? 'bad-text' : ''}>{frame?.impacts ?? 0}</b></span>
    <span>Score: <b>{frame?.score?.toFixed(0) ?? 0}</b></span><SensorStatus sensors={frame?.sensors} /><span>Engagements: {frame?.inFlight ?? 0}/{frame?.capacity ?? '-'}</span>{frame?.escalated && <span className="chip warn">ESCALATED</span>}
    <span className="spacer" /><button onClick={() => send({ type: 'cmd', cmd: frame?.paused ? 'resume' : 'pause' })}>{frame?.paused ? 'Resume' : 'Pause'}</button>
    <select value={frame?.speed ?? 1} onChange={(e) => send({ type: 'cmd', cmd: 'speed', value: +e.target.value })}>{[1, 2, 4].map((v) => <option key={v} value={v}>{v}x</option>)}</select><button className="bad" onClick={() => send({ type: 'cmd', cmd: 'end' })}>End</button></div>
    {msg && <div className="banner">{msg}</div>}
    {coachNotes.length > 0 && <section className="card trainee-coach-notes" aria-live="polite"><h3>Instructor coaching</h3>{coachNotes.slice(-3).map((note, index) => <p key={`${note.t}-${index}`}><b>{note.by}</b> <span>{note.t.toFixed(0)}s</span> {note.text}</p>)}</section>}
    <div className="grid3"><Tactical frame={frame} selectedId={sel} onSelect={setSel} /><div><TrackList tracks={frame?.tracks} selectedId={sel} onSelect={setSel} /><Feed items={frame?.feed} /></div>
      <div><MentorPanel track={track} explanation={expl} onExplain={(tid) => send({ type: 'explain', trackId: tid })} onTrust={(tid, accept) => send({ type: 'action', action: { type: 'mentor', trackId: tid, accept } })} /><ActionPanel track={track} onClassify={classify} onRespond={respond} /><PriorityPanel tracks={frame?.tracks} onSubmit={(order) => send({ type: 'action', action: { type: 'prioritise', order } })} /></div></div></div>);
}
