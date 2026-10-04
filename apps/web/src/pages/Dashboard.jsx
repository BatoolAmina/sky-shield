import React, { useCallback, useEffect, useRef, useState } from 'react';
import { req, watchDashboard } from '../api.js';
import { ROE_TEXT, ASSETS } from '../labels.js';

function DashboardIcon({ name, size = 18 }) {
  const paths = {
    arrow: <><path d="M4 12h15" /><path d="m13 5 7 7-7 7" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="m12 12 6-6" /></>,
    medal: <><circle cx="12" cy="8" r="5" /><path d="m8.5 12-1 9 4.5-2.5 4.5 2.5-1-9" /></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.radar}</svg>;
}

const formatDuration = (seconds = 0) => `${Math.max(1, Math.round(seconds / 60))} min`;
const formatDate = (date) => date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export default function Dashboard({ user, onUser, go }) {
  const [brief, setBrief] = useState(null), [rec, setRec] = useState(null), [overview, setOverview] = useState(null), [sc, setSc] = useState([]), [ses, setSes] = useState([]), [model, setModel] = useState(null), [lb, setLb] = useState([]), [err, setErr] = useState(''), [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [starting, setStarting] = useState(false), [updatedAt, setUpdatedAt] = useState(null), [realtime, setRealtime] = useState(false);
  const loaded = useRef(false);

  const loadDashboard = useCallback(async () => {
    if (loaded.current) setRefreshing(true);
    setErr('');
    try {
      const dashboard = await req('GET', '/dashboard');
      onUser?.(dashboard.user);
      setOverview(dashboard);
      setSc(dashboard.scenarios);
      setSes(dashboard.sessions);
      setModel(dashboard.model);
      setRec(dashboard.recommendation);
      setLb(dashboard.leaderboard);
      setUpdatedAt(Date.now());
    } catch (e) {
      setErr(`Dashboard data could not be loaded: ${e.message}`);
    } finally {
      loaded.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [onUser]);

  useEffect(() => {
    loadDashboard();
    const stopWatching = watchDashboard(loadDashboard, setRealtime);
    const timer = window.setInterval(loadDashboard, 30000);
    const onFocus = () => loadDashboard();
    window.addEventListener('focus', onFocus);
    return () => { stopWatching(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [loadDashboard]);

  const start = async (id) => {
    setStarting(true);
    setErr('');
    try {
      const r = await req('POST', '/sessions', { scenarioId: id });
      go(`/play/${r.id}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setStarting(false);
    }
  };

  const summary = model?.summary?.calibrated_test;
  const firstName = user.displayName?.trim().split(/\s+/)[0] || user.username;
  const recommended = sc.find((scenario) => scenario.id === rec?.scenarioId) || sc[0];
  const finishedSessions = ses.filter((session) => session.status === 'finished');
  const completedRuns = overview?.completedRuns ?? finishedSessions.length;
  const playedScenarios = overview?.scenariosExplored ?? new Set(ses.map((session) => session.scenarioId)).size;
  const rank = overview?.rank || lb.findIndex((player) => player.username === user.username) + 1;

  return <div className="dashboard-root">
    <section className="dashboard-welcome">
      <div className="dashboard-welcome-copy">
        <span className="dashboard-kicker"><i /> AI-ENABLED DRONE &amp; COUNTER-DRONE TRAINING <b>·</b> TRAINEE</span>
        <h1>Welcome back, {firstName}.</h1>
        <p>Train on synthetic drone-threat scenarios, review explainable AI assessments, and build sound counter-drone decisions.</p>
        <div className="dashboard-welcome-actions">
          {recommended && <button type="button" className="dashboard-primary-action" onClick={() => setBrief(recommended)}>Continue training <DashboardIcon name="arrow" size={16} /></button>}
          <span><DashboardIcon name="check" size={14} /> {realtime ? 'Live updates' : 'Reconnecting'} · {updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString()}` : 'connecting'}</span>
        </div>
      </div>
      <div className="dashboard-hero-art" aria-hidden="true"><span /><span /><span /><i /></div>
      <div className="dashboard-rating">
        <span>CURRENT RATING</span>
        <b>{user.rating}</b>
        <small><i className={model?.available ? 'mentor-dot is-ready' : 'mentor-dot'} /> {model?.available ? 'MENTOR ONLINE' : 'MENTOR OFFLINE'}</small>
      </div>
    </section>

    {err && <div className="dashboard-alert" role="alert">{err}<button type="button" onClick={() => setErr('')} aria-label="Dismiss error"><DashboardIcon name="close" size={15} /></button></div>}

    <section className="dashboard-summary" aria-label="Training progress">
      <article className="dashboard-summary-card"><span className="dashboard-summary-icon"><DashboardIcon name="check" /></span><div><small>COMPLETED RUNS</small><b>{completedRuns}</b></div><span className="dashboard-summary-note">All-time</span></article>
      <article className="dashboard-summary-card"><span className="dashboard-summary-icon"><DashboardIcon name="radar" /></span><div><small>SCENARIOS EXPLORED</small><b>{playedScenarios}<em> / {sc.length || 6}</em></b></div><span className="dashboard-summary-note">Keep exploring</span></article>
      <article className="dashboard-summary-card"><span className="dashboard-summary-icon"><DashboardIcon name="medal" /></span><div><small>LEADERBOARD</small><b>{rank ? `#${rank}` : '—'}</b></div><span className="dashboard-summary-note">Your current place</span></article>
    </section>

    <div className="dashboard-layout">
      <section className="dashboard-scenarios">
        <div className="dashboard-section-title">
          <div><span className="dashboard-kicker">CHOOSE YOUR NEXT CHALLENGE</span><h2>Training scenarios</h2><p>Pick up a new skill—or sharpen one you already know.</p></div>
          <div className="dashboard-section-actions"><button type="button" className="dashboard-refresh-button" onClick={loadDashboard} disabled={refreshing}><DashboardIcon name="radar" size={14} /> {refreshing ? 'Updating' : 'Refresh'}</button><span className="scenario-count">{sc.length.toString().padStart(2, '0')} SCENARIOS</span></div>
        </div>

        {brief && <article className="dashboard-brief">
          <div className="dashboard-brief-heading"><span><DashboardIcon name="radar" size={17} /> EXERCISE BRIEFING</span><button type="button" onClick={() => setBrief(null)} aria-label="Close briefing"><DashboardIcon name="close" /></button></div>
          <h3>{brief.name}</h3><p>{brief.brief}</p><p className="dashboard-brief-note">{ASSETS}</p>
          <div className="dashboard-brief-roe"><b>Rules of engagement</b><ul>{ROE_TEXT.map((rule) => <li key={rule}>{rule}</li>)}</ul></div>
          <p className="dashboard-brief-note">Difficulty adapts to your current rating ({user.rating}).</p>
          <div className="dashboard-brief-actions"><button type="button" className="dashboard-primary-action" disabled={starting} onClick={() => start(brief.id)}>{starting ? 'Starting…' : 'Begin exercise'} <DashboardIcon name="arrow" size={16} /></button><button type="button" className="dashboard-secondary-action" onClick={() => setBrief(null)}>Choose another</button></div>
        </article>}

        <div className="dashboard-scenario-grid">
          {sc.map((scenario, index) => {
            const isRecommended = rec?.scenarioId === scenario.id;
            return <article key={scenario.id} className={`dashboard-scenario-card ${isRecommended ? 'is-recommended' : ''}`} style={{ animationDelay: `${Math.min(index, 5) * 65}ms` }}>
              <div className="dashboard-scenario-topline"><span className="dashboard-scenario-icon"><DashboardIcon name={scenario.adaptive ? 'spark' : 'radar'} size={18} /></span><span className="dashboard-difficulty">{'★'.repeat(scenario.difficulty)}<span>{'☆'.repeat(Math.max(0, 5 - scenario.difficulty))}</span></span></div>
              <div className="dashboard-scenario-title"><h3>{scenario.name}</h3>{isRecommended && <span className="dashboard-recommended"><DashboardIcon name="spark" size={12} /> FOR YOU</span>}</div>
              <p>{scenario.brief}</p>
              <div className="dashboard-scenario-footer"><span><DashboardIcon name="clock" size={14} /> {formatDuration(scenario.durationS)}</span>{scenario.adaptive && <span className="dashboard-adaptive">ADAPTIVE</span>}</div>
              <button type="button" className="dashboard-scenario-button" onClick={() => setBrief(scenario)}>View briefing <DashboardIcon name="arrow" size={15} /></button>
            </article>;
          })}
          {!sc.length && <div className="dashboard-empty-state">{loading ? <><span className="dashboard-loader" /><p>Loading your scenario library…</p></> : <p>No scenarios are available right now.</p>}</div>}
        </div>
      </section>

      <aside className="dashboard-sidebar">
        <section className="dashboard-panel dashboard-progress-panel">
          <div className="dashboard-panel-heading"><div><span className="dashboard-kicker">YOUR JOURNEY</span><h2>Training progress</h2></div><span className="dashboard-panel-icon"><DashboardIcon name="medal" /></span></div>
          <div className="dashboard-progress-score"><b>{user.rating}</b><span>current rating</span></div>
          <div className="dashboard-rating-track"><span style={{ width: `${Math.max(4, Math.min(100, ((user.rating - 600) / 1400) * 100))}%` }} /></div>
          <div className="dashboard-rating-range"><span>600</span><span>2000+</span></div>
          <p>Your rating adjusts challenge difficulty to help you keep progressing.</p>
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-heading"><div><span className="dashboard-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Recent sessions</h2></div><span className="dashboard-panel-count">{ses.length}</span></div>
          {loading ? <div className="dashboard-panel-empty">Loading your training history…</div> : ses.length ? <div className="dashboard-session-list">{ses.slice(0, 5).map((session) => {
            const scenario = sc.find((item) => item.id === session.scenarioId);
            return <button type="button" key={session.id} className="dashboard-session-row" disabled={session.status !== 'finished'} onClick={() => go(`/review/${session.id}`)}>
              <span className="dashboard-session-mark"><DashboardIcon name={session.status === 'finished' ? 'check' : 'clock'} size={15} /></span>
              <span className="dashboard-session-copy"><b>{session.scenarioName || scenario?.name || session.scenarioId}</b><small>{formatDate(session.createdAt)} <i>·</i> {session.status === 'finished' ? 'Review run' : 'In progress'}</small></span>
              <span className="dashboard-session-score">{session.score ?? '—'}<DashboardIcon name="arrow" size={13} /></span>
            </button>;
          })}</div> : <div className="dashboard-panel-empty">Your completed runs will appear here.</div>}
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-heading"><div><span className="dashboard-kicker">LEARN TOGETHER</span><h2>Leaderboard</h2></div><span className="dashboard-panel-icon"><DashboardIcon name="medal" /></span></div>
          {loading ? <div className="dashboard-panel-empty">Loading leaderboard…</div> : lb.length ? <div className="dashboard-leaderboard">{lb.slice(0, 4).map((player, index) => <div key={player.username} className={`dashboard-leader-row ${player.username === user.username ? 'is-current-user' : ''}`}><span className="dashboard-leader-rank">{String(index + 1).padStart(2, '0')}</span><span className="dashboard-leader-avatar">{player.username.slice(0, 1).toUpperCase()}</span><b>{player.username}{player.username === user.username && <small>YOU</small>}</b><span className="dashboard-leader-rating">{player.rating}</span></div>)}</div> : <div className="dashboard-panel-empty">Leaderboard is not available yet.</div>}
        </section>

        <section className={`dashboard-panel dashboard-mentor-panel ${model?.available ? 'is-online' : ''}`}>
          <div className="dashboard-panel-heading"><div><span className="dashboard-kicker">DECISION SUPPORT</span><h2>AI mentor</h2></div><span className="dashboard-mentor-status"><i className={model?.available ? 'mentor-dot is-ready' : 'mentor-dot'} />{model?.available ? 'ONLINE' : 'OFFLINE'}</span></div>
          {loading ? <p>Checking mentor availability…</p> : model?.available ? <><p>Calibrated tree model is ready to help explain track assessments during your runs.</p><div className="dashboard-model-metrics">{summary && <><span><b>{(summary.macro_f1 * 100).toFixed(1)}%</b><small>synthetic macro-F1</small></span><span><b>{(summary.threat_recall * 100).toFixed(1)}%</b><small>synthetic threat recall</small></span></>}</div><small className="dashboard-synthetic-note">Evaluated on synthetic data · training aid only</small></> : <p>The mentor model is unavailable. Start the server after exporting the model to enable in-session assessments.</p>}
        </section>
      </aside>
    </div>
  </div>;
}
