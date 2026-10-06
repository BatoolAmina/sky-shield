import React, { useEffect, useRef, useState } from 'react';
import Brand from '../components/Brand.jsx';
import { req, auth } from '../api.js';

export default function Login({ mode, onAuth, go }) {
  const isSignup = mode === 'signup';
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '', confirmPassword: '', instructorCode: '', adminCode: '' });
  const [showPassword, setShowPassword] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [theme, setTheme] = useState(() => window.localStorage.getItem('skyshield-theme') === 'light' ? 'light' : 'dark');
  const [googleClientId, setGoogleClientId] = useState('');
  const [adminSignupEnabled, setAdminSignupEnabled] = useState(false);
  const googleButton = useRef(null), authCallback = useRef(null);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const finishAuth = (user) => { onAuth(user); go('/'); };
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');
  const handleGoogleSignIn = () => {
    if (!window.google?.accounts?.id) return;
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        setError('Google sign-in is unavailable right now. Please use your email instead.');
      }
    });
  };
  authCallback.current = finishAuth;

  useEffect(() => {
    window.localStorage.setItem('skyshield-theme', theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    req('GET', '/auth/config').then((config) => {
      if (active) {
        setGoogleClientId(config.googleClientId ?? '');
        setAdminSignupEnabled(Boolean(config.adminSignupEnabled));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let observer;
    if (!googleClientId || !googleButton.current) return undefined;
    const onLoad = () => {
      if (!active || !window.google?.accounts?.id || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setError('');
          setBusy(true);
          try {
            const result = await req('POST', '/auth/google', { credential });
            auth.set(result.token);
            authCallback.current?.(result.user);
          } catch (e) { setError(e.message); }
          finally { setBusy(false); }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      let renderedWidth = 0;
      const renderButton = () => {
        if (!active || !googleButton.current) return;
        const width = Math.max(220, Math.min(380, googleButton.current.clientWidth - 4));
        if (width === renderedWidth) return;
        renderedWidth = width;
        googleButton.current.replaceChildren();
        window.google.accounts.id.renderButton(googleButton.current, {
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width,
          logo_alignment: 'left',
          type: 'standard',
        });
      };
      renderButton();
      if ('ResizeObserver' in window) {
        observer = new ResizeObserver(renderButton);
        observer.observe(googleButton.current);
      }
    };
    let script = document.querySelector('script[data-google-identity]');
    if (window.google?.accounts?.id) onLoad();
    else {
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.googleIdentity = 'true';
        document.head.append(script);
      }
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', () => { if (active) setError('Google sign-in could not be loaded. Please try again or use your password.'); }, { once: true });
    }
    return () => { active = false; observer?.disconnect(); };
  }, [googleClientId, theme]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (isSignup && form.password !== form.confirmPassword) { setError('Your passwords do not match.'); return; }
    setBusy(true);
    try {
      const payload = isSignup
        ? { username: form.username.trim(), email: form.email.trim(), displayName: form.displayName.trim(), password: form.password, ...(form.instructorCode.trim() ? { instructorCode: form.instructorCode.trim() } : {}), ...(form.adminCode.trim() ? { adminCode: form.adminCode.trim() } : {}) }
        : { username: form.username.trim(), password: form.password };
      const result = await req('POST', `/auth/${isSignup ? 'register' : 'login'}`, payload);
      auth.set(result.token);
      finishAuth(result.user);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return <div className="auth-page motion-safe:animate-fade-up motion-reduce:animate-none" data-theme={theme}>
    <a className="auth-back-link" href="#/"><span aria-hidden="true">←</span> Back to home</a>
    <button className="auth-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? '☼' : '◐'} <span>{theme === 'dark' ? 'Light' : 'Dark'} mode</span></button>
    <div className="auth-shell">
      <section className="auth-story motion-safe:animate-slide-in motion-reduce:animate-none">
        <Brand className="auth-brand" />
        <div className="auth-story-copy"><div className="eyebrow"><span className="status-dot" /> A SIMULATION BUILT FOR YOU</div><h1>{isSignup ? <>Think clearly.<br /><span>Act confidently.</span></> : <>Welcome back.<br /><span>See the whole picture.</span></>}</h1><p>Practice reading complex scenarios, build confidence in your decisions, and learn from every replay.</p></div>
        <div className="auth-story-bottom"><div className="auth-mini-radar"><i /><i /><i /><b /></div><span>YOUR TRAINING SPACE<br /><strong>Thoughtful practice. Measurable progress.</strong></span><span className="auth-story-index">S / 01</span></div>
      </section>
      <section className="auth-form-side motion-safe:animate-fade-up motion-reduce:animate-none">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><Brand /></div>
          <div className="auth-title"><span className="auth-kicker">{isSignup ? 'YOUR TRAINING JOURNEY' : 'WELCOME BACK'}</span><h2>{isSignup ? 'Create your account' : 'Sign in to SkyShield'}</h2><p>{isSignup ? 'A sharper read on every situation starts here.' : 'Pick up where your next decision begins.'}</p></div>
          {googleClientId && <>
            <button type="button" className="google-signin-button" onClick={handleGoogleSignIn} aria-label="Continue with Google">
              <span className="google-signin-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
                  <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.5-1.8 4.3-5.4 4.3-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 4 1.5l2.7-2.7C16.9 3.2 14.7 2.2 12 2.2 6.8 2.2 2.5 6.5 2.5 11.7S6.8 21.2 12 21.2c6.9 0 11.5-4.8 11.5-11.6 0-.8-.1-1.4-.2-2H12z"/>
                  <path fill="#34A853" d="M3.7 7.2l3.3 2.4c.9-1.7 2.8-2.9 4.9-2.9 1.9 0 3.2.8 4 1.5l2.7-2.7C16.9 3.2 14.7 2.2 12 2.2 8.1 2.2 4.8 4.5 3.7 7.2z"/>
                  <path fill="#FBBC05" d="M3.7 16.2c1.1 2.7 4.4 4.5 8.3 4.5 2.4 0 4.4-.8 5.9-2.2l-2.9-2.4c-.8.5-1.8.9-3 .9-2.6 0-4.8-1.8-5.4-4.2l-3 2.4z"/>
                  <path fill="#4285F4" d="M12 21.2c2.4 0 4.4-.8 5.9-2.2l-2.9-2.4c-.8.5-1.8.9-3 .9-2.6 0-4.8-1.8-5.4-4.2l-3 2.4C3.1 18 7.1 21.2 12 21.2z"/>
                </svg>
              </span>
              <span className="google-signin-text">Continue with Google</span>
            </button>
            <div className="auth-divider"><span>or continue with email</span></div>
          </>}
          <form className="auth-form" onSubmit={submit}>
            <div className={isSignup ? 'auth-fields auth-fields-signup' : 'auth-fields'}>
              {isSignup && <label>Full name <input autoComplete="name" placeholder="Your name" maxLength="80" value={form.displayName} onChange={update('displayName')} /></label>}
              <label>{isSignup ? 'Username' : 'Username or email'} <input autoComplete="username" required minLength={isSignup ? 3 : undefined} maxLength={isSignup ? 32 : 254} pattern={isSignup ? '[A-Za-z0-9_.-]{3,32}' : undefined} title={isSignup ? 'Use 3-32 letters, numbers, dots, underscores or hyphens.' : undefined} placeholder={isSignup ? 'Choose a username' : 'Username or email address'} value={form.username} onChange={update('username')} /></label>
              {isSignup && <label className="auth-field-wide">Email address <input type="email" autoComplete="email" required maxLength="254" placeholder="you@example.com" value={form.email} onChange={update('email')} /></label>}
              <label>Password <span className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} required minLength={isSignup ? 8 : undefined} placeholder={isSignup ? '8 characters minimum' : 'Enter your password'} value={form.password} onChange={update('password')} /><button className="password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></span></label>
              {isSignup && <label>Confirm password <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength="8" placeholder="Re-enter password" value={form.confirmPassword} onChange={update('confirmPassword')} /></label>}
            </div>
            {isSignup && <details className="instructor-option"><summary>Have a staff access code?</summary><label>Instructor code <input autoComplete="off" placeholder="Optional access code" value={form.instructorCode} onChange={update('instructorCode')} /></label>{adminSignupEnabled && <label>Admin code <input autoComplete="off" placeholder="Optional admin access code" value={form.adminCode} onChange={update('adminCode')} /></label>}</details>}
            {error && <div className="auth-error" role="alert"><span>!</span>{error}</div>}
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'} <span aria-hidden="true">↗</span></button>
          </form>
          <p className="auth-switch">{isSignup ? 'Already have an account?' : 'New to SkyShield?'} <a href={isSignup ? '#/login' : '#/signup'}>{isSignup ? 'Sign in' : 'Create an account'}</a></p>
          <p className="auth-privacy"><span aria-hidden="true">◇</span> Your training profile stays yours. Passwords are securely hashed.</p>
        </div>
        <div className="auth-footnote">SYNTHETIC TRAINING ENVIRONMENT <span>·</span> FOR EDUCATIONAL USE</div>
      </section>
    </div>
  </div>;
}
