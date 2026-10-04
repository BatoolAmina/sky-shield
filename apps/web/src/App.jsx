import React, { useEffect, useState } from 'react';
import { req, auth } from './api.js';
import Brand from './components/Brand.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Trainee from './pages/Trainee.jsx';
import Review from './pages/Review.jsx';
import Instructor from './pages/Instructor.jsx';
import Admin from './pages/Admin.jsx';

const parse = () => (typeof location === 'undefined' ? '/' : location.hash.replace(/^#/, '') || '/');
export default function App() {
  const [user, setUser] = useState(null), [path, setPath] = useState(parse()), [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('skyshield-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => { const h = () => setPath(parse()); window.addEventListener('hashchange', h); if (auth.token) req('GET', '/me').then(setUser).catch(() => auth.set(null)).finally(() => setReady(true)); else setReady(true); return () => window.removeEventListener('hashchange', h); }, []);
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      if (parse() !== '/login') location.hash = '/login';
    };
    window.addEventListener('skyshield:unauthorized', onUnauthorized);
    return () => window.removeEventListener('skyshield:unauthorized', onUnauthorized);
  }, []);
  const go = (p) => { location.hash = p; };
  const toggleTheme = () => setTheme((current) => {
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('skyshield-theme', next); } catch {}
    return next;
  });
  if (!ready) return <div className="app-loading"><Brand className="app-brand app-brand-loading" /><p>Preparing your training environment...</p></div>;
  if (!user) return path === '/login' || path === '/signup'
    ? <Login key={path} mode={path === '/signup' ? 'signup' : 'login'} onAuth={setUser} go={go} />
    : <Landing />;
  const m = path.match(/^\/(play|review)\/(.+)$/);
  return (<div className="app" data-theme={theme}><header className="app-header">
    <Brand className="app-brand" />
    <nav className="app-nav"><div className="app-nav-links"><a href="#/">{user.role === 'trainee' ? 'Scenarios' : 'Overview'}</a>{user.role !== 'trainee' && <a href="#/instructor">Instructor</a>}{user.role === 'admin' && <a href="#/admin">Admin tools</a>}</div>
      <span className="app-user"><i>{(user.displayName ?? user.username).slice(0, 1).toUpperCase()}</i><span>{user.displayName || user.username}<small>{user.role}</small></span></span>
      <button className="app-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? '☼ Light' : '◐ Dark'}</button>
      <button className="app-signout" onClick={() => { auth.set(null); setUser(null); go('/'); }}>Sign out</button>
    </nav>
  </header>
    <main key={path} className="app-main motion-safe:animate-fade-up motion-reduce:animate-none">{m?.[1] === 'play' ? <Trainee id={m[2]} go={go} /> : m?.[1] === 'review' ? <Review id={m[2]} /> : path === '/admin' && user.role === 'admin' ? <Admin /> : path === '/instructor' && user.role !== 'trainee' ? <Instructor /> : path === '/' && user.role === 'admin' ? <Admin /> : path === '/' && user.role === 'instructor' ? <Instructor /> : <Dashboard user={user} onUser={setUser} go={go} />}</main></div>);
}
