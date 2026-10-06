import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { req, watchDashboard } from '../api.js';

const CONTENT_FIELDS = [
  ['heroKicker', 'Landing hero kicker'],
  ['heroHeading', 'Hero heading'],
  ['heroAccent', 'Hero accent line'],
  ['heroDescription', 'Hero description'],
  ['heroCta', 'Hero button'],
  ['scenariosEyebrow', 'Scenario section label'],
  ['scenariosHeading', 'Scenario section heading'],
  ['scenariosDescription', 'Scenario section description'],
  ['showcaseEyebrow', 'Exercise section label'],
  ['showcaseHeading', 'Exercise section heading'],
  ['showcaseAccent', 'Exercise section accent'],
  ['showcaseDescription', 'Exercise section description'],
  ['finalHeading', 'Closing heading'],
  ['finalDescription', 'Closing description'],
];
const TABS = [['overview', 'Overview'], ['users', 'Users & roles'], ['sessions', 'Session records'], ['website', 'Website content'], ['training', 'Training data']];
const json = (value) => JSON.stringify(value ?? {}, null, 2);

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [content, setContent] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const selected = useMemo(() => scenarios.find((scenario) => scenario.id === selectedId), [scenarios, selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userRows, siteContent, scenarioRows, stats, sessionRows] = await Promise.all([
        req('GET', '/admin/users'),
        req('GET', '/admin/site-content'),
        req('GET', '/admin/scenarios'),
        req('GET', '/analytics'),
        req('GET', '/admin/sessions'),
      ]);
      setUsers(userRows);
      setSessions(sessionRows);
      setContent(siteContent);
      setScenarios(scenarioRows);
      setAnalytics(stats);
      setSelectedId((current) => current || scenarioRows[0]?.id || '');
    } catch (e) {
      setError(`Admin data could not be loaded: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const stopWatching = watchDashboard(load, setRealtime);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { stopWatching(); window.removeEventListener('focus', onFocus); };
  }, [load]);
  useEffect(() => {
    if (!selected) return;
    setDraft({
      name: selected.name,
      brief: selected.brief,
      difficulty: String(selected.difficulty),
      durationS: String(selected.durationS),
      events: json(selected.events),
      overrides: json(selected.overrides),
    });
  }, [selected]);

  const saveContent = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await req('PUT', '/admin/site-content', content);
      setContent(updated);
      setNotice('Website content saved. Public landing pages now show the updated copy.');
    } catch (e) {
      setError(`Website content was not saved: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveScenario = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await req('PUT', `/admin/scenarios/${selectedId}`, {
        name: draft.name,
        brief: draft.brief,
        difficulty: Number(draft.difficulty),
        durationS: Number(draft.durationS),
        events: JSON.parse(draft.events),
        overrides: JSON.parse(draft.overrides),
      });
      setScenarios((current) => current.map((scenario) => scenario.id === updated.id ? updated : scenario));
      setNotice(`${updated.name} saved. New training sessions will use the updated scenario data.`);
    } catch (e) {
      setError(`Scenario data was not saved: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const setRole = async (id, role) => {
    setError('');
    setNotice('');
    try {
      const updated = await req('POST', `/admin/users/${id}/role`, { role });
      setUsers((current) => current.map((user) => user.id === id ? updated : user));
      setNotice(`Updated ${updated.username} to ${updated.role}.`);
    } catch (e) {
      setError(`Role could not be changed: ${e.message}`);
    }
  };

  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  return <div className="role-dashboard admin-dashboard">
    <header className="role-dashboard-hero">
      <div><span className="role-kicker">AI-ENABLED DRONE &amp; COUNTER-DRONE SIMULATION · ADMINISTRATOR</span><h1>Platform administration</h1><p>Manage access, public content, synthetic threat scenarios, and platform-wide training results.</p></div>
      <div className="role-admin-refresh"><span className={`role-live-status ${realtime ? 'is-connected' : ''}`}><i /> {realtime ? 'LIVE PUSH' : 'RECONNECTING'}</span><button type="button" className="role-action" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh data'}</button></div>
    </header>

    {(error || notice) && <div className={error ? 'role-alert role-alert-error' : 'role-alert'} role={error ? 'alert' : 'status'}>{error || notice}</div>}

    <nav className="role-tabs" aria-label="Admin sections">
      {TABS.map(([id, label]) => <button type="button" key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </nav>

    {tab === 'overview' && <section className="role-admin-grid">
      <article className="role-card role-stat"><span>REGISTERED ACCOUNTS</span><b>{users.length}</b><small>Persisted accounts</small></article>
      <article className="role-card role-stat"><span>FINISHED TRAINING RUNS</span><b>{analytics?.sessions ?? 0}</b><small>All accounts</small></article>
      <article className="role-card role-stat"><span>SCENARIO LIBRARY</span><b>{scenarios.length}</b><small>Admin-editable scenarios</small></article>
      <article className="role-card role-wide"><h2>Recent platform activity</h2>
        {loading ? <p className="role-muted">Loading persisted platform data…</p> : analytics ? <div className="role-table-wrap"><table className="role-table"><thead><tr><th>Scenario</th><th>Runs</th><th>Mean score</th></tr></thead><tbody>{analytics.byScenario.map((row) => <tr key={row.scenarioId}><td>{row.name}</td><td>{row.sessions}</td><td>{row.meanScore.toFixed(1)}</td></tr>)}</tbody></table></div> : <p className="role-muted">No analytics are available.</p>}
      </article>
      <article className="role-card role-wide"><h2>System notes</h2><p className="role-muted">Content and scenario changes are saved by the authenticated server. Scenario edits affect newly created runs; completed and running sessions retain their original recorded data.</p><p className="role-muted">Training inputs are validated against supported simulator fields. This console does not edit source code, model weights, or historical session records.</p></article>
    </section>}

    {tab === 'users' && <section className="role-card">
      <div className="role-section-heading"><div><span className="role-kicker">IDENTITY & ACCESS</span><h2>Accounts and roles</h2></div><span>{users.length} accounts</span></div>
      {loading ? <p className="role-muted">Loading accounts…</p> : <div className="role-table-wrap"><table className="role-table"><thead><tr><th>Account</th><th>Display name</th><th>Rating</th><th>Training runs</th><th>Role</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.username}</td><td>{user.displayName || '—'}</td><td>{user.rating}</td><td>{user.sessionCount}</td><td><select aria-label={`Role for ${user.username}`} value={user.role} onChange={(event) => setRole(user.id, event.target.value)}>{['trainee', 'instructor', 'admin'].map((role) => <option key={role} value={role}>{role}</option>)}</select></td></tr>)}</tbody></table></div>}
    </section>}

    {tab === 'sessions' && <section className="role-card">
      <div className="role-section-heading"><div><span className="role-kicker">SERVER SESSION STORE</span><h2>Training session records</h2></div><span>Latest {sessions.length} · up to 500 shown</span></div>
      {loading ? <p className="role-muted">Loading session records…</p> : sessions.length ? <div className="role-table-wrap"><table className="role-table"><thead><tr><th>Trainee</th><th>Scenario</th><th>Started</th><th>Status</th><th>Score</th><th>Rating</th><th>Review</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><td>{session.username}</td><td>{session.scenarioName || session.scenarioId}</td><td>{new Date(session.createdAt).toLocaleString()}</td><td>{session.status}</td><td>{session.score ?? '—'}</td><td>{session.rating ?? '—'}</td><td>{session.status === 'finished' ? <a className="role-inline-link" href={`#/review/${session.id}`}>Open report</a> : '—'}</td></tr>)}</tbody></table></div> : <p className="role-muted">No sessions have been recorded yet.</p>}
    </section>}

    {tab === 'website' && <form className="role-card role-editor" onSubmit={saveContent}>
      <div className="role-section-heading"><div><span className="role-kicker">PUBLIC WEBSITE · LIVE COPY</span><h2>Landing page content</h2></div><span>Saved in backend</span></div>
      <p className="role-muted">Changes are returned by the public content API and appear on the landing page. Keep line lengths concise for responsive layouts.</p>
      {content && <div className="role-form-grid">{CONTENT_FIELDS.map(([key, label]) => <label key={key} className={key.toLowerCase().includes('description') ? 'role-field-wide' : ''}>{label}{key.toLowerCase().includes('description') ? <textarea required maxLength="500" rows="3" value={content[key]} onChange={(event) => setContent((current) => ({ ...current, [key]: event.target.value }))} /> : <input required maxLength="500" value={content[key]} onChange={(event) => setContent((current) => ({ ...current, [key]: event.target.value }))} />}</label>)}</div>}
      <button className="role-action" type="submit" disabled={saving || !content}>{saving ? 'Saving…' : 'Save website content'}</button>
    </form>}

    {tab === 'training' && <section className="role-card role-editor">
      <div className="role-section-heading"><div><span className="role-kicker">SIMULATOR CONFIGURATION</span><h2>Training scenario data</h2></div><span>{scenarios.length} scenarios</span></div>
      <p className="role-muted">Edit scenario briefs and supported event schedules. Event and override JSON is validated server-side before it is saved.</p>
      <label className="role-select-field">Scenario<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>
      {draft && <form className="role-training-form" onSubmit={saveScenario}>
        <div className="role-form-grid">
          <label>Scenario name<input required maxLength="100" value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} /></label>
          <label>Difficulty (1–5)<input required type="number" min="1" max="5" value={draft.difficulty} onChange={(event) => updateDraft('difficulty', event.target.value)} /></label>
          <label>Duration (seconds)<input required type="number" min="30" max="600" value={draft.durationS} onChange={(event) => updateDraft('durationS', event.target.value)} /></label>
          <label className="role-field-wide">Brief<textarea required maxLength="1000" rows="3" value={draft.brief} onChange={(event) => updateDraft('brief', event.target.value)} /></label>
          <label>Event schedule JSON<textarea className="role-code-field" required rows="12" value={draft.events} onChange={(event) => updateDraft('events', event.target.value)} /></label>
          <label>Sensor override JSON<textarea className="role-code-field" required rows="12" value={draft.overrides} onChange={(event) => updateDraft('overrides', event.target.value)} /></label>
        </div>
        <button className="role-action" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save scenario for new runs'}</button>
      </form>}
    </section>}
  </div>;
}
