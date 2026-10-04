import React, { useCallback, useEffect, useRef, useState } from 'react';
import { req, openSocket, watchDashboard } from '../api.js';
import Tactical from '../components/Tactical.jsx';

const dateLabel = (value) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export default function Instructor() {
  const [live, setLive] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [model, setModel] = useState(null);
  const [watch, setWatch] = useState(null);
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [realtime, setRealtime] = useState(false);
  const [kind, setKind] = useState('fast');
  const [coachDraft, setCoachDraft] = useState('');
  const [coachStatus, setCoachStatus] = useState('');
  const ws = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await req('GET', '/instructor/dashboard');
      setLive(data.live);
      setSessions(data.sessions);
      setAnalytics(data.analytics);
      setModel(data.model);
      setUpdatedAt(Date.now());
      setError('');
    } catch (e) {
      setError(`Instructor data could not be refreshed: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const stopWatching = watchDashboard(refresh, setRealtime);
    const timer = window.setInterval(refresh, 15000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { stopWatching(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  useEffect(() => {
    setFrame(null);
    if (!watch) return undefined;
    const socket = openSocket(watch, 'observe', (message) => {
      if (message.type === 'frame') setFrame(message.data);
      if (message.type === 'coach-ack') setCoachStatus(message.ok ? 'Coaching note delivered to the trainee.' : message.reason);
      if (message.type === 'ended') {
        setWatch(null);
        refresh();
      }
      if (message.type === 'error') setError(`Live observation stopped: ${message.error}`);
    });
    ws.current = socket;
    socket.onerror = () => setError('The live observation connection was interrupted.');
    return () => { socket.close(); ws.current = null; };
  }, [watch, refresh]);

  const command = (options) => {
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setError('The selected live session is not connected. Refresh and select it again.');
      return;
    }
    ws.current.send(JSON.stringify({ type: 'cmd', ...options }));
  };
  const sendCoachNote = (event) => {
    event.preventDefault();
    const text = coachDraft.trim();
    if (!text || text.length > 400) {
      setCoachStatus('Write a coaching note of 1–400 characters.');
      return;
    }
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setCoachStatus('Connect to a live session before sending coaching.');
      return;
    }
    ws.current.send(JSON.stringify({ type: 'coach', text }));
    setCoachDraft('');
    setCoachStatus('Sending…');
  };

  const finished = sessions.filter((session) => session.status === 'finished');
  const activeTrainees = new Set(live.map((session) => session.username)).size;

  return <div className="role-dashboard instructor-dashboard">
    <header className="role-dashboard-hero">
      <div><span className="role-kicker">AI-ENABLED DRONE &amp; COUNTER-DRONE SIMULATION · INSTRUCTOR</span><h1>Instructor overview</h1><p>Coach synthetic drone-threat exercises, observe the AI mentor’s assessments, and review trainee outcomes.</p></div>
      <div className={`role-live-status ${realtime ? 'is-connected' : ''}`}><i /> {realtime ? 'LIVE PUSH' : 'RECONNECTING'} {updatedAt ? `· UPDATED ${new Date(updatedAt).toLocaleTimeString()}` : '· CONNECTING'}</div>
    </header>

    {error && <div className="role-alert role-alert-error" role="alert">{error}<button type="button" onClick={refresh}>Retry</button></div>}

    <section className="role-metrics">
      <article className="role-card role-stat"><span>ACTIVE EXERCISES</span><b>{live.length}</b><small>{realtime ? 'Live session updates' : '15-second fallback refresh'}</small></article>
      <article className="role-card role-stat"><span>TRAINEES IN SESSION</span><b>{activeTrainees}</b><small>Currently connected</small></article>
      <article className="role-card role-stat"><span>FINISHED RUNS</span><b>{analytics?.sessions ?? '—'}</b><small>All saved sessions</small></article>
      <article className="role-card role-stat"><span>MENTOR MODEL</span><b className="role-stat-word">{model ? model.available ? 'ONLINE' : 'OFFLINE' : '…'}</b><small>Backend runtime status</small></article>
    </section>

    <section className="role-card instructor-howto">
      <span className="role-kicker">HOW TO TRAIN A TRAINEE</span>
      <ol><li>The trainee signs in and starts a scenario from their Scenarios dashboard.</li><li>Their active run appears below; select <b>Open live view</b> to observe their real-time picture.</li><li>Coach with a short note or introduce a clearly marked simulation condition, then discuss the after-action review together.</li></ol>
      <p>Instructors observe and coach; the trainee owns the run and makes the training decisions. All injected tracks and sensor changes affect only the synthetic exercise.</p>
    </section>

    <section className="role-card">
      <div className="role-section-heading"><div><span className="role-kicker">SERVER-AUTHORITATIVE SESSIONS</span><h2>Live exercises</h2></div><button className="role-action role-action-small" type="button" onClick={refresh}>Refresh now</button></div>
      {live.length ? <div className="role-table-wrap"><table className="role-table"><thead><tr><th>Trainee</th><th>Scenario</th><th>Elapsed</th><th>Observe</th></tr></thead><tbody>{live.map((session) => <tr key={session.id} className={watch === session.id ? 'is-selected' : ''}><td>{session.username}</td><td>{session.scenarioName || session.scenarioId}</td><td>{Math.floor(session.t)} sec</td><td><button className="role-inline-action" type="button" onClick={() => setWatch(session.id)}>{watch === session.id ? 'Observing' : 'Open live view'}</button></td></tr>)}</tbody></table></div> : <p className="role-empty">{updatedAt ? 'No active exercises at the moment. New sessions will appear automatically.' : 'Connecting to live session data…'}</p>}
    </section>

    {watch && <section className="role-card role-observation">
      <div className="role-section-heading"><div><span className="role-kicker">LIVE OBSERVATION</span><h2>Session control</h2></div><button className="role-inline-action" type="button" onClick={() => setWatch(null)}>Close view</button></div>
      <Tactical frame={frame} showTruth onSelect={() => {}} />
      <form className="instructor-coach-form" onSubmit={sendCoachNote}><label htmlFor="instructor-coach-note">Coach the trainee</label><div><textarea id="instructor-coach-note" maxLength="400" rows="2" placeholder="Share a prompt or coaching observation…" value={coachDraft} onChange={(event) => setCoachDraft(event.target.value)} /><button className="role-action" type="submit">Send coaching</button></div>{coachStatus && <small role="status">{coachStatus}</small>}</form>
      <div className="role-control-row"><button type="button" onClick={() => command({ cmd: 'pause' })}>Pause</button><button type="button" onClick={() => command({ cmd: 'resume' })}>Resume</button><select value={kind} onChange={(event) => setKind(event.target.value)}>{['surveillance', 'fast', 'low', 'swarm', 'bird', 'friendly', 'civil'].map((value) => <option key={value}>{value}</option>)}</select><button className="role-control-warning" type="button" onClick={() => command({ cmd: 'inject', spec: { kind } })}>Inject training track</button><button type="button" onClick={() => command({ cmd: 'defence', mods: { maxConcurrent: 1, effMult: 0.6 } })}>Degrade simulated defence</button></div>
      <div className="role-control-row"><span>Difficulty</span>{[1, 2, 3, 4, 5].map((level) => <button key={level} type="button" onClick={() => command({ cmd: 'difficulty', level })}>{level}</button>)}<span>Sensor status</span>{['radar', 'rf', 'eo'].map((sensor) => <span key={sensor}>{sensor.toUpperCase()} <button type="button" onClick={() => command({ cmd: 'sensor', sensor, on: false })}>Off</button> <button type="button" onClick={() => command({ cmd: 'sensor', sensor, on: true })}>On</button></span>)}</div>
    </section>}

    <div className="role-lower-grid">
      <section className="role-card"><div className="role-section-heading"><div><span className="role-kicker">PERSISTED TRAINING OUTCOMES</span><h2>Scenario analytics</h2></div></div>
        {analytics ? <div className="role-table-wrap"><table className="role-table"><thead><tr><th>Scenario</th><th>Runs</th><th>Mean score</th></tr></thead><tbody>{analytics.byScenario.map((scenario) => <tr key={scenario.scenarioId}><td>{scenario.name}</td><td>{scenario.sessions}</td><td>{scenario.meanScore.toFixed(1)}</td></tr>)}</tbody></table></div> : <p className="role-empty">Waiting for analytics…</p>}
        {analytics && <p className="role-muted">False alarms: {analytics.commonMistakes.falseAlarms} · Missed threats: {analytics.commonMistakes.missedThreats} · ROE denials: {analytics.commonMistakes.roeDenials} · Mentor advice correct: {analytics.trust.adviceCorrect}/{analytics.trust.decisions}</p>}
      </section>
      <section className="role-card"><div className="role-section-heading"><div><span className="role-kicker">SESSION ACTIVITY</span><h2>Recent runs</h2></div><span>{finished.length} completed</span></div>
        {sessions.length ? <div className="role-recent-list">{sessions.slice(0, 8).map((session) => <div className="role-recent-row" key={session.id}><span><b>{session.username}</b><small>{session.scenarioName || session.scenarioId} · {dateLabel(session.createdAt)}</small></span><strong>{session.status === 'finished' ? session.score ?? '—' : 'LIVE'}</strong></div>)}</div> : <p className="role-empty">No saved session activity yet.</p>}
      </section>
    </div>
  </div>;
}
