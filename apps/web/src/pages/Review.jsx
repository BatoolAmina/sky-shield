import React, { useEffect, useState } from 'react';
import { req } from '../api.js';
import Tactical from '../components/Tactical.jsx';
import { ScoreBars } from '../components/Panels.jsx';
export default function Review({ id }) {
  const [d, setD] = useState(null), [i, setI] = useState(0), [truth, setTruth] = useState(true), [err, setErr] = useState('');
  useEffect(() => { req('GET', `/sessions/${id}/replay`).then((r) => { setD(r); setI(0); }).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <p className="bad-text">{err}</p>; if (!d) return <p>Loading...</p>;
  const f = d.frames[Math.min(i, d.frames.length - 1)], tl = d.aar.timeline;
  return (<div className="grid2"><div><h2>After-action review: {d.scenario}</h2><Tactical frame={f} showTruth={truth} onSelect={() => {}} />
    <div className="row"><input type="range" min="0" max={d.frames.length - 1} value={i} onChange={(e) => setI(+e.target.value)} style={{ flex: 1 }} /><b>{f.t.toFixed(0)}s</b><label><input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} /> ground truth</label></div></div>
    <div><div className="card"><h3>Score {d.score.total}/100</h3><p>{d.aar.summary}</p><ScoreBars score={d.score} /></div>
      <div className="card"><h3>Lessons</h3><ul>{d.aar.lessons.map((l, k) => <li key={k}>{l}</li>)}</ul></div>
      {d.coachNotes?.length > 0 && <div className="card review-coach-notes"><h3>Instructor coaching</h3>{d.coachNotes.map((note, k) => <button type="button" key={`${note.t}-${k}`} onClick={() => setI(Math.min(d.frames.length - 1, Math.round(note.t)))}><span>{note.t.toFixed(0)}s · {note.by}</span><p>{note.text}</p></button>)}</div>}
      <div className="card feed"><h3>Timeline</h3>{tl.map((e, k) => <div key={k} className={`f ${e.tone}`} onClick={() => setI(Math.min(d.frames.length - 1, Math.round(e.t)))}><span>{e.t.toFixed(0)}s</span> {e.text}</div>)}</div></div></div>);
}
