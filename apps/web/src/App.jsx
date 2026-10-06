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
const linksForRole = (role) => {
  if (role === 'admin') return [['/admin', 'Admin tools'], ['/instructor', 'Instructor console']];
  if (role === 'instructor') return [['/instructor', 'Instructor console']];
  return [['/', 'Scenarios']];
};

export default function App() {
  const [user, setUser] = useState(null), [path, setPath] = useState(parse()), [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('skyshield-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => { const h = () => setPath(parse()); window.addEventListener('hashchange', h); if (auth.token) req('GET', '/me').then(setUser).catch(() => auth.set(null)).finally(() => setReady(true)); else setReady(true); return () => window.removeEventListener('hashchange', h); }, []);
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      const currentPath = parse();
      if (!['/', '/home', '/login', '/signup'].includes(currentPath)) location.hash = '/login';
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
  const signOut = () => { auth.set(null); setUser(null); go('/'); };
  if (!ready) return <div className="app-loading"><Brand className="app-brand app-brand-loading" /><p>Preparing your training environment...</p></div>;
  if (path === '/home' && !user) return <Landing />;
  if (!user) return path === '/login' || path === '/signup'
    ? <Login key={path} mode={path === '/signup' ? 'signup' : 'login'} onAuth={setUser} go={go} />
    : <Landing />;
  const m = path.match(/^\/(play|review)\/(.+)$/);
  const roleLinks = linksForRole(user.role);
  return (<div className="app" data-theme={theme}><header className="app-header">
    <Brand className="app-brand" />
    <nav className="app-nav"><div className="app-nav-links">{roleLinks.map(([href, label]) => <a key={href} href={`#${href}`}>{label}</a>)}</div>
      <span className="app-user"><i>{(user.displayName ?? user.username).slice(0, 1).toUpperCase()}</i><span>{user.displayName || user.username}<small>{user.role}</small></span></span>
      <button className="app-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? '☼ Light' : '◐ Dark'}</button>
      <button className="app-signout" onClick={signOut}>Sign out</button>
    </nav>
  </header>
    <main key={path} className="app-main motion-safe:animate-fade-up motion-reduce:animate-none">{m?.[1] === 'play' ? <Trainee id={m[2]} go={go} /> : m?.[1] === 'review' ? <Review id={m[2]} /> : path === '/admin' && user.role === 'admin' ? <Admin /> : path === '/instructor' && user.role !== 'trainee' ? <Instructor /> : path === '/' && user.role === 'admin' ? <Admin /> : path === '/' && user.role === 'instructor' ? <Instructor /> : <Dashboard user={user} onUser={setUser} go={go} />}</main>
    <footer className="app-footer">
      <span>SKYSHIELD · {user.role.toUpperCase()} WORKSPACE</span>
      <nav aria-label={`${user.role} workspace links`}>{roleLinks.map(([href, label]) => <a key={href} href={`#${href}`}>{label}</a>)}</nav>
      <button className="app-signout" onClick={signOut}>Sign out</button>
    </footer>
  </div>);
}
