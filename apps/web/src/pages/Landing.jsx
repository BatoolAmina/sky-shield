import React, { useEffect, useRef, useState } from 'react';
import { SCENARIOS } from '../../../../packages/sim-core/src/scenario.js';
import { CLASSES } from '../../../../packages/sim-core/src/types.js';
import { req } from '../api.js';

const Icon = ({ name, size = 22, className = '' }) => {
  const paths = {
    radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="m12 12 6-6M12 3v2M21 12h-2M12 21v-2M3 12h2" /></>,
    brain: <><path d="M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 4 11a4 4 0 0 0 2 7h6" /><path d="M12 18V5a3 3 0 0 1 5.8-1A4 4 0 0 1 20 11a4 4 0 0 1-2 7h-6ZM8 8h.01M16 8h.01M7 13h.01M17 13h.01M12 21h.01" /></>,
    replay: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    nodes: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="m8 7 8-1M7 8l4 8m6-8-4 8" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5m-18 5 9 5 9-5" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    moon: <path d="M20.8 13A8.5 8.5 0 0 1 11 3.2 8.5 8.5 0 1 0 20.8 13Z" />,
  };
  return <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.arrow}</svg>;
};

function Reveal({ children, className = '', delay = '' }) {
  const ref = useRef(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!ref.current || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRevealed(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setRevealed(true);
        observer.disconnect();
      }
    }, { threshold: 0.08, rootMargin: '0px 0px 48px 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className={`motion-safe:transition-[opacity,transform,filter] motion-safe:duration-700 motion-safe:ease-expressive motion-reduce:transform-none motion-reduce:opacity-100 motion-reduce:blur-0 ${revealed ? 'motion-safe:translate-y-0 motion-safe:opacity-100 motion-safe:blur-0' : 'motion-safe:translate-y-6 motion-safe:opacity-0 motion-safe:blur-[2px]'} ${delay} ${className}`}>{children}</div>;
}

function CountUp({ value }) {
  const ref = useRef(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!ref.current || !('IntersectionObserver' in window)) { setCount(value); return undefined; }
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setCount(value); return; }
      const start = performance.now();
      const animate = (now) => {
        const progress = Math.min((now - start) / 800, 1);
        setCount(Math.round(value * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }, { threshold: 0.35 });
    observer.observe(ref.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);

  return <strong ref={ref} className="landing-stat-count" aria-label={String(value)}>{String(count).padStart(2, '0')}</strong>;
}

import Brand from '../components/Brand.jsx';

function ScenarioPreview({ scenario }) {
  return <div className="scenario-preview" aria-label={`${scenario.name} exercise preview`}>
    <header className="scenario-preview-header">
      <span><b>EXERCISE PREVIEW</b><small>{scenario.name} · LEVEL {scenario.difficulty}</small></span>
      <span className="scenario-preview-state"><i /> PAUSED</span>
    </header>
    <div className="scenario-preview-content">
      <div className="scenario-scope" role="img" aria-label="Synthetic radar picture showing an unknown surveillance track, a friendly transit, and bird clutter">
        <svg viewBox="0 0 360 300" aria-hidden="true">
          <circle className="scope-ring" cx="180" cy="150" r="44" />
          <circle className="scope-ring" cx="180" cy="150" r="88" />
          <circle className="scope-ring" cx="180" cy="150" r="132" />
          <path className="scope-axis" d="M48 150h264M180 18v264" />
          <g className="scenario-sweep motion-safe:animate-radar-sweep motion-reduce:animate-none"><path d="M180 150V18A132 132 0 0 1 273 56Z" /></g>
          <path className="scope-bearing" d="M180 150 93 81" />
          <circle className="scope-origin" cx="180" cy="150" r="4" />
          <g className="scope-track scope-track-unknown"><circle className="motion-safe:animate-track-ping motion-reduce:animate-none" cx="93" cy="81" r="7" /><circle cx="93" cy="81" r="2.5" /></g>
          <g className="scope-track scope-track-friendly"><path d="m247 221 7 7-7 7-7-7Z" /><path d="M247 221v14m-7-7h14" /></g>
          <g className="scope-track scope-track-clutter"><circle cx="119" cy="224" r="3.5" /><circle cx="132" cy="211" r="3.5" /><circle cx="145" cy="226" r="3.5" /></g>
          <text className="scope-label" x="55" y="66">TRK 024 · UNKNOWN</text>
          <text className="scope-label" x="251" y="250">FRIENDLY</text>
          <text className="scope-direction" x="180" y="13" textAnchor="middle">N</text>
          <text className="scope-direction" x="344" y="153" textAnchor="middle">E</text>
          <text className="scope-direction" x="180" y="296" textAnchor="middle">S</text>
          <text className="scope-direction" x="16" y="153" textAnchor="middle">W</text>
        </svg>
        <span className="scope-caption">SIMULATED AIRSPACE · NOT LIVE DATA</span>
      </div>
      <aside className="scenario-readout">
        <span className="scenario-readout-kicker">TRAINING BRIEF</span>
        <h2>{scenario.name}</h2>
        <p>{scenario.brief}</p>
        <div className="scenario-track-detail">
          <span className="scenario-track-marker" />
          <span><b>TRACK 024</b><small>Surveillance signature · uncertain</small></span>
        </div>
        <div className="scenario-sensors" aria-label="Illustrative synthetic sensor reports">
          <div><span>RADAR</span><b>FAINT RETURN</b></div>
          <div><span>RF</span><b>WEAK SIGNAL</b></div>
          <div><span>EO</span><b>UNCONFIRMED</b></div>
          <div><span>IFF</span><b>NO REPLY</b></div>
          <small>Illustrative synthetic reports · not live data</small>
        </div>
        <div className="scenario-decision">
          <span>DECISION POINT</span>
          <p>Check the evidence before deciding how to respond.</p>
        </div>
      </aside>
    </div>
    <footer className="scenario-preview-footer"><span>SEE WHAT EACH SENSOR CAN AND CANNOT CONFIRM</span><span>{Math.round(scenario.durationS / 60)} MIN BRIEF</span></footer>
  </div>;
}

const visualMoments = [
  { number: '01', title: 'Fuse imperfect reports', caption: 'Radar, RF, EO and IFF observations feed a shared picture—with noise and disagreement left visible.', image: '/images/landing/sensor-fusion.svg', scene: 'airspace' },
  { number: '02', title: 'Inspect the mentor', caption: 'Open “Why?” to see which track features raised or lowered the model’s confidence.', image: '/images/landing/mentor-analysis.svg', scene: 'signals' },
  { number: '03', title: 'Replay your decisions', caption: 'Review the timeline against ground truth after the exercise, never during the live run.', image: '/images/landing/after-action-replay.svg', scene: 'review' },
];

function VisualMoment({ moment }) {
  return <article className={`visual-moment visual-scene-${moment.scene}`}>
    <div className="visual-art" role="img" aria-label={`${moment.title}: synthetic training visualization`}>
      <img className="visual-art-image" src={moment.image} alt="" loading="lazy" />
      <span className="visual-art-label">SYNTHETIC ENVIRONMENT <i>·</i> {moment.number}</span>
    </div>
    <div className="visual-moment-copy">
      <span className="visual-moment-number">{moment.number} / THE TRAINING LOOP</span>
      <h3>{moment.title}</h3>
      <p>{moment.caption}</p>
    </div>
  </article>;
}

const capabilities = [
  { icon: 'radar', number: '01', title: 'Multi-sensor picture', text: 'Radar, RF, EO and IFF observations flow into a fused track picture, with clutter, shadowing and uncertainty built into the synthetic environment.', tint: 'mint' },
  { icon: 'brain', number: '02', title: 'Explainable AI mentor', text: 'A calibrated tree model assesses tracks. The “Why?” view exposes the strongest contributing features instead of giving you a black-box answer.', tint: 'violet' },
  { icon: 'nodes', number: '03', title: 'Adaptive scenarios', text: 'A seeded adversary can change its tactics across sessions. Scenario difficulty adapts with your rating, so practice can grow with you.', tint: 'amber' },
  { icon: 'replay', number: '04', title: 'After-action review', text: 'Revisit the timeline, replay decisions and compare your session with ground truth after the run—never during the live trainee view.', tint: 'sky' },
];

const steps = [
  ['01', 'Choose a brief', 'Start with a seeded situation such as Lone Observer, Low and Slow, or Swarm in the Flock.'],
  ['02', 'Read uncertain tracks', 'Compare sensor reports and track history. The trainee view withholds ground truth until the run is over.'],
  ['03', 'Make a proportionate call', 'Classify and prioritize tracks, then decide whether the evidence justifies a response.'],
  ['04', 'Replay the run', 'Review your timing and choices beside the revealed truth; use the same seed to repeat the exercise.'],
];

const details = [
  { title: 'Deterministic simulation core', icon: 'layers', points: ['Seeded world and independent random streams', 'Moving-object behavior and coordinated groups', 'Radar, RF, EO and IFF observations', 'Tracking, sensor fusion and feature extraction'] },
  { title: 'Mentor model, in plain JavaScript', icon: 'brain', points: ['Exported calibrated tree model at runtime', 'TreeSHAP explanations for track assessments', 'Template-based “Why?” explanations', 'Designed to continue without a model export'] },
  { title: 'Server-authoritative sessions', icon: 'lock', points: ['Live sessions run on the server over WebSocket', 'Trainees receive only perceived tracks and mentor output', 'Role-checked instructor and administrator tools', 'Replay reveals truth only after a run is finished'] },
];

export default function Landing() {
  const [theme, setTheme] = useState(() => window.localStorage.getItem('skyshield-theme') === 'light' ? 'light' : 'dark');
  const [content, setContent] = useState(null);
  const [scenarios, setScenarios] = useState(SCENARIOS);
  const [featuredScenarioId, setFeaturedScenarioId] = useState(SCENARIOS[0].id);
  const [activeSection, setActiveSection] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollProgressRef = useRef(null);

  useEffect(() => {
    window.localStorage.setItem('skyshield-theme', theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    Promise.all([req('GET', '/site-content'), req('GET', '/scenarios')])
      .then(([siteContent, scenarioList]) => {
        if (!active) return;
        setContent(siteContent);
        setScenarios(scenarioList);
      })
      .catch((error) => {
        if (active) console.error('Landing content could not be loaded; showing built-in defaults.', error);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let frame = 0;
    const updateScrollState = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollProgressRef.current) scrollProgressRef.current.style.transform = `scaleX(${scrollableHeight > 0 ? window.scrollY / scrollableHeight : 0})`;
        setShowBackToTop(window.scrollY > 560);
        const sections = ['platform', 'how-it-works', 'scenarios', 'responsibility'];
        const current = sections
          .map((id) => document.getElementById(id))
          .filter((section) => section && section.getBoundingClientRect().top <= 150)
          .at(-1);
        setActiveSection(current?.id ?? '');
      });
    };

    updateScrollState();
    window.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const navigation = [
    ['platform', 'Platform'],
    ['scenarios', 'Scenarios'],
    ['how-it-works', 'How it works'],
    ['responsibility', 'Research & limits'],
  ];
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');
  const themeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  const site = content ?? {};
  const featuredScenario = scenarios.find((scenario) => scenario.id === featuredScenarioId) ?? scenarios[0] ?? SCENARIOS[0];
  const featuredScenarioNumber = scenarios.findIndex((scenario) => scenario.id === featuredScenario.id) + 1;
  return <div className="landing-experience min-h-screen overflow-hidden bg-night font-sans text-white selection:bg-mint/30 selection:text-white" data-theme={theme}>
    <header id="top" className="landing-header z-50 animate-header-drop border-b border-white/[.07] bg-night/85 backdrop-blur-xl motion-reduce:animate-none">
      <div className="landing-progress" aria-hidden="true"><span ref={scrollProgressRef} /></div>
      <div className="landing-header-inner mx-auto flex h-[76px] w-full max-w-[1320px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <Brand />
        <nav aria-label="Main navigation" className="landing-desktop-nav hidden items-center gap-8 text-[12px] font-medium text-white/60 lg:flex">
          {navigation.map(([id, label]) => <a key={id} aria-current={activeSection === id ? 'location' : undefined} className={`landing-nav-link no-underline transition hover:text-mint ${activeSection === id ? 'is-active' : ''}`} href={`#${id}`}>{label}</a>)}
        </nav>
        <div className="landing-header-actions flex shrink-0 items-center gap-2 sm:gap-3">
          <button type="button" className="landing-theme-toggle" aria-label={themeLabel} title={themeLabel} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /><span>{theme === 'dark' ? 'Light' : 'Dark'}</span></button>
          <a className="hidden whitespace-nowrap text-[12px] font-medium text-white/65 no-underline transition hover:text-white sm:block" href="#/login">Sign in</a>
          <a className="landing-header-cta group inline-flex whitespace-nowrap items-center gap-2 rounded-lg bg-mint px-4 py-2.5 text-[11px] font-semibold text-night no-underline transition hover:-translate-y-0.5 hover:bg-[#a8d9ff] sm:px-5 sm:text-xs" href="#/signup"><span className="hidden sm:inline">Create account</span><span className="sm:hidden">Start</span> <Icon name="arrow" size={15} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></a>
          <button type="button" className="landing-menu-toggle grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-white transition hover:border-mint/40 hover:text-mint lg:hidden" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} aria-controls="landing-mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? 'close' : 'menu'} size={19} /></button>
        </div>
      </div>
      <nav id="landing-mobile-navigation" aria-label="Mobile navigation" aria-hidden={!menuOpen} className={`landing-mobile-nav lg:hidden motion-reduce:animate-none ${menuOpen ? 'is-open animate-fade-up' : ''}`}>
        {navigation.map(([id, label]) => <a key={id} aria-current={activeSection === id ? 'location' : undefined} tabIndex={menuOpen ? 0 : -1} className={`landing-mobile-link ${activeSection === id ? 'is-active' : ''}`} href={`#${id}`} onClick={() => setMenuOpen(false)}><span>{label}</span><Icon name="arrow" size={16} /></a>)}
        <button type="button" className="landing-mobile-theme" tabIndex={menuOpen ? 0 : -1} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />Switch to {theme === 'dark' ? 'light' : 'dark'} appearance</button>
        <a className="landing-mobile-signin" tabIndex={menuOpen ? 0 : -1} href="#/login" onClick={() => setMenuOpen(false)}>Sign in <Icon name="arrow" size={15} /></a>
      </nav>
    </header>

    <main className="landing-main">
      <section className="landing-hero relative isolate overflow-hidden bg-aurora">
        <div className="mx-auto grid min-h-[650px] max-w-[1320px] items-center gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[.82fr_1.18fr] lg:gap-12 lg:px-12 lg:py-24">
          <div className="animate-fade-up motion-reduce:animate-none">
            <p className="landing-hero-kicker">{site.heroKicker ?? 'AI-enabled drone & counter-drone threat simulation trainer'}</p>
            <h1 className="max-w-[680px] text-[clamp(2.55rem,4.8vw,4.35rem)] font-medium leading-[1.12] tracking-[-.065em]">{site.heroHeading ?? 'Read the picture.'}<br /><span className="landing-heading-accent text-mint">{site.heroAccent ?? 'Make the call.'}</span></h1>
            <p className="mt-7 max-w-[550px] text-sm leading-7 text-quiet sm:text-base sm:leading-8">{site.heroDescription ?? 'Train against synthetic drone and airspace threats in repeatable scenarios. Compare simulated sensor tracks, inspect explainable AI mentor assessments, practice abstract counter-drone decisions, and review the outcome after each run.'}</p>
            <div className="landing-hero-actions mt-8 flex flex-wrap items-center gap-3"><a className="landing-hero-primary group inline-flex items-center gap-3 rounded-lg bg-mint px-5 py-3.5 text-xs font-semibold text-night no-underline transition hover:-translate-y-0.5 hover:bg-[#a8d9ff] hover:shadow-glow sm:px-6 sm:text-sm" href="#/signup"><span className="landing-hero-cta-label-wide">{site.heroCta ?? 'Start a training run'}</span><span className="landing-hero-cta-label-compact">Start training</span><Icon name="arrow" size={17} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></a><a className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-5 py-3.5 text-xs font-medium text-white/75 no-underline transition hover:border-white/35 hover:bg-white/[.04] sm:px-6 sm:text-sm" href="#scenarios">See the scenarios <span className="text-mint">↓</span></a></div>
            <div className="landing-hero-proof mt-11 flex flex-wrap gap-x-7 gap-y-3 border-t border-white/10 pt-6 text-[10px] text-white/45 sm:text-[11px]"><span><Icon name="check" size={14} /> Seeded, repeatable runs</span><span><Icon name="check" size={14} /> Decisions scored after play</span><span><Icon name="check" size={14} /> Synthetic data only</span></div>
          </div>
          <div className="relative mx-auto w-full max-w-[720px] animate-slide-in motion-reduce:animate-none">
            <ScenarioPreview scenario={featuredScenario} />
          </div>
        </div>
      </section>

      <section className="landing-stats border-y border-white/[.07] bg-white/[.018]" aria-label="SkyShield at a glance">
        <div className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8 lg:px-12">
          <div className="grid grid-cols-2 gap-y-6 md:grid-cols-4">
            {[[scenarios.length, 'hand-authored scenarios'], [4, 'synthetic sensor families'], [CLASSES.length, 'simulated object classes'], [1, 'replayable training loop']].map(([value, text]) => <div key={text} className="landing-stat flex items-center gap-3 border-white/10 px-3 first:pl-0 sm:px-6 md:border-r md:last:border-0"><CountUp value={value} /><span className="max-w-24 text-[9px] leading-4 text-white/45 sm:max-w-28 sm:text-[10px]">{text}</span></div>)}
          </div>
          <div className="landing-stats-actions mt-7 flex flex-wrap items-center justify-center gap-3 border-t border-white/[.07] pt-6 sm:justify-end">
            <a className="landing-stats-secondary" href="#scenarios">Browse scenarios <Icon name="arrow" size={14} /></a>
            <a className="landing-stats-primary" href="#/signup">Start training <Icon name="arrow" size={15} /></a>
          </div>
        </div>
      </section>

      <section aria-label="Technology stack" className="landing-surface landing-surface-alt overflow-hidden border-b border-white/[.06]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-3 gap-y-2 px-5 py-5 text-center sm:gap-x-5 sm:px-8 lg:px-12">
          <span className="mr-1 text-[8px] font-semibold tracking-[.17em] text-white/30 sm:mr-3 sm:text-[9px]">BUILT WITH</span>
          {['React', 'Vite', 'Node.js', 'Express', 'WebSocket', 'MongoDB optional', 'Python', 'scikit-learn'].map((technology) => <span key={technology} className="rounded-full border border-white/[.09] bg-white/[.025] px-3 py-1.5 text-[8px] font-medium text-white/55 transition-[transform,border-color,color,background-color] duration-300 ease-expressive hover:-translate-y-0.5 hover:border-mint/35 hover:bg-mint/[.04] hover:text-mint sm:text-[9px]">{technology}</span>)}
        </div>
      </section>

      <section id="platform" className="scroll-mt-24 px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto max-w-[1200px]">
          <Reveal><div className="max-w-[680px]"><p className="text-[10px] font-semibold tracking-[.18em] text-mint">WHAT HAPPENS IN A RUN</p><h2 className="mt-4 text-3xl font-medium leading-tight tracking-[-.055em] sm:text-5xl">From first contact<br /><span className="landing-heading-accent">to after-action review.</span></h2><p className="mt-5 max-w-[570px] text-sm leading-7 text-quiet">A practical sequence: pick a seeded scenario, assess imperfect tracks, make a decision, then compare your actions with the hidden truth after the run.</p></div></Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((item, index) => <Reveal key={item.number} delay={['', 'delay-100', 'delay-200', 'delay-300'][index]}><article className="capability-feature-card group relative h-full overflow-hidden rounded-xl border border-white/[.09] bg-gradient-to-b from-white/[.045] to-white/[.015] p-5 transition-[transform,border-color,box-shadow] duration-300 ease-expressive hover:-translate-y-1 hover:border-mint/30 hover:shadow-glow sm:p-6"><span className="capability-feature-icon-wrap"><span className="grid h-14 w-14 place-items-center rounded-2xl border border-mint/20 bg-mint/[.07] text-mint transition-transform duration-500 ease-expressive group-hover:rotate-6 group-hover:scale-110"><Icon name={item.icon} size={25} /></span></span><span className="capability-feature-number">{item.number} / 04</span><h3 className="mt-5 text-[15px] font-medium text-white">{item.title}</h3><p className="mt-3 text-[11px] leading-6 text-white/50">{item.text}</p></article></Reveal>)}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="landing-surface relative scroll-mt-24 overflow-hidden border-y border-white/[.07] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="pointer-events-none absolute -right-40 top-0 h-[520px] w-[520px] rounded-full border border-white/[.04] shadow-[0_0_0_60px_rgba(255,255,255,.015),0_0_0_120px_rgba(255,255,255,.01)]" />
        <div className="relative mx-auto grid max-w-[1200px] gap-14 lg:grid-cols-[.7fr_1.3fr]">
          <Reveal><div className="lg:sticky lg:top-32"><p className="text-[10px] font-semibold tracking-[.18em] text-mint">HOW A SESSION WORKS</p><h2 className="mt-4 text-3xl font-medium leading-tight tracking-[-.055em] sm:text-5xl">Practice the call.<br /><span className="landing-heading-accent">Understand the result.</span></h2><p className="mt-5 max-w-[430px] text-sm leading-7 text-quiet">The trainee sees only what the sensors report. Ground truth appears in review, where every action can be examined and replayed.</p><a className="mt-8 inline-flex items-center gap-2 text-xs font-medium text-mint transition hover:gap-3" href="#/signup">Try a seeded exercise <Icon name="arrow" size={15} /></a></div></Reveal>
          <ol className="walkthrough-list">{steps.map(([number, title, description], index) => <li key={number} style={{ animationDelay: `${index * 100}ms` }} className="walkthrough-step motion-safe:animate-fade-up motion-reduce:animate-none"><span className="walkthrough-step-number transition-transform duration-300 hover:scale-110">{number}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
        </div>
      </section>

      <section id="scenarios" className="scroll-mt-24 px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto max-w-[1200px]">
          <Reveal><div className="scenario-library-heading"><div><p className="text-[10px] font-semibold tracking-[.18em] text-mint">{site.scenariosEyebrow ?? 'THE SCENARIO LIBRARY'}</p><h2 className="mt-4 text-3xl font-medium tracking-[-.055em] sm:text-5xl">{site.scenariosHeading ?? 'Six briefs. One skill at a time.'}</h2></div><p className="max-w-[410px] text-sm leading-7 text-quiet">{site.scenariosDescription ?? 'Practice with seeded situations: a low-flying intruder, a flock hiding a swarm, or a decoy drawing attention from the real threat.'}</p></div></Reveal>
          <div className="scenario-library">
            <Reveal className="min-w-0"><article className="scenario-featured">
              <div className="scenario-featured-index">{String(featuredScenarioNumber).padStart(2, '0')} <span>/ {String(scenarios.length).padStart(2, '0')}</span></div>
              <div className="scenario-featured-copy">
                <div className="scenario-meta"><span>LEVEL {featuredScenario.difficulty}</span><span>{Math.round(featuredScenario.durationS / 60)} MIN</span></div>
                <h3>{featuredScenario.name}</h3>
                <p>{featuredScenario.brief}</p>
                <a href="#/signup">Practice this brief <Icon name="arrow" size={14} /></a>
              </div>
              <div className="scenario-featured-note"><span>THE CHALLENGE</span><b>One uncertain track.<br />Several plausible explanations.</b><small>Learn to wait for evidence before you act.</small></div>
            </article></Reveal>
            <div className="scenario-list" aria-label="More training briefs">
              {scenarios.filter((scenario) => scenario.id !== featuredScenario.id).map((scenario, index) => {
                const number = scenarios.findIndex((item) => item.id === scenario.id) + 1;
                const delay = ['delay-100', 'delay-200', 'delay-300'][index % 3];
                return <Reveal key={scenario.id} delay={delay}><article className="scenario-list-item">
                  <button type="button" className="scenario-list-select" onClick={() => setFeaturedScenarioId(scenario.id)} aria-label={`Show ${scenario.name} as the featured scenario`}>
                    <span className="scenario-list-number">{String(number).padStart(2, '0')}</span>
                    <span className="scenario-list-copy"><span className="scenario-meta"><span>{scenario.adaptive ? 'ADAPTIVE' : `LEVEL ${scenario.difficulty}`}</span><span>{Math.round(scenario.durationS / 60)} MIN</span></span><span className="scenario-list-title">{scenario.name}</span><span className="scenario-list-brief">{scenario.brief}</span></span>
                  </button>
                  <a href="#/signup" aria-label={`Practice ${scenario.name}`}><Icon name="arrow" size={16} /></a>
                </article></Reveal>;
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="landing-surface-alt overflow-hidden border-y border-white/[.07] px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
        <div className="mx-auto max-w-[1200px]">
          <Reveal><div className="visual-showcase-heading"><p className="text-[10px] font-semibold tracking-[.18em] text-mint">{site.showcaseEyebrow ?? 'INSIDE A SKYSHIELD EXERCISE'}</p><h2>{site.showcaseHeading ?? 'A complete picture.'}<br /><span>{site.showcaseAccent ?? 'From first signal to final review.'}</span></h2><p>{site.showcaseDescription ?? 'The most important moments of training, brought together in one calm, focused workspace.'}</p></div></Reveal>
          <div className="visual-showcase-grid">{visualMoments.map((moment, index) => <Reveal key={moment.number} delay={['', 'delay-150', 'delay-300'][index]}><VisualMoment moment={moment} /></Reveal>)}</div>
        </div>
      </section>

      <section className="landing-surface-alt border-y border-white/[.07] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto grid max-w-[1200px] gap-12 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
          <Reveal><div><p className="text-[10px] font-semibold tracking-[.18em] text-violet">THE MENTOR IS BUILT TO BE QUESTIONED</p><h2 className="mt-4 text-3xl font-medium leading-tight tracking-[-.055em] sm:text-5xl">See a prediction.<br /><span className="landing-heading-accent">Then ask “why?”</span></h2><p className="mt-5 max-w-[520px] text-sm leading-7 text-quiet">The shipped JavaScript runtime uses the exported calibrated tree model. The explanation view surfaces the strongest contributing features so the trainee can inspect the model’s reasoning rather than simply defer to it.</p><div className="mt-8 space-y-3">{['Calibrated class probabilities', 'Feature-attribution explanations', 'Works without a model export—the rest of the app remains usable'].map((line) => <div key={line} className="flex items-start gap-2.5 text-xs text-white/65"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-mint" />{line}</div>)}</div></div></Reveal>
          <Reveal><div className="landing-mentor-card rounded-2xl border border-violet/20 bg-night/75 p-5 shadow-card sm:p-7"><div className="flex items-center justify-between border-b border-white/[.08] pb-4"><span className="flex items-center gap-2 text-xs font-medium text-white/85"><Icon name="brain" className="text-violet" /> Mentor assessment</span><span className="rounded-full bg-violet/10 px-2.5 py-1 font-mono text-[8px] text-violet">EXPLAINABLE</span></div><div className="mt-5 flex items-end gap-3"><span className="text-4xl font-medium tracking-tight text-white">0.86</span><span className="pb-1 text-[10px] text-white/40">illustrative confidence</span></div><div className="mt-4 space-y-3">{[['Track consistency', 82, 'positive'], ['Motion pattern', 68, 'positive'], ['Sensor disagreement', 34, 'caution']].map(([label, value, type]) => <div key={label}><div className="mb-1.5 flex justify-between text-[9px]"><span className="text-white/55">{label}</span><span className={type === 'positive' ? 'text-mint' : 'text-amber-300'}>{type === 'positive' ? '+' : '−'}{value}%</span></div><div className="h-1 overflow-hidden rounded bg-white/10"><i className={`block h-full rounded ${type === 'positive' ? 'bg-mint/80' : 'bg-amber-300/75'}`} style={{ width: `${value}%` }} /></div></div>)}</div><div className="mt-5 rounded-lg border border-violet/15 bg-violet/[.06] p-3 text-[10px] leading-5 text-white/60">Example UI illustration only; values shown are not a live model output.</div></div></Reveal>
        </div>
      </section>

      <section className="px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto max-w-[1200px]"><Reveal><div className="max-w-[700px]"><p className="text-[10px] font-semibold tracking-[.18em] text-mint">A CLOSER LOOK AT THE BUILD</p><h2 className="mt-4 text-3xl font-medium tracking-[-.055em] sm:text-5xl">Purposeful pieces.<br /><span className="landing-heading-accent">Connected end to end.</span></h2></div></Reveal><div className="mt-10 grid gap-4 lg:grid-cols-3">{details.map((detail, index) => <Reveal key={detail.title} delay={['', 'delay-150', 'delay-300'][index]}><article className="detail-feature-card group h-full rounded-xl border border-white/[.09] bg-gradient-to-b from-[#101f2d] to-[#0b1722] p-6 text-center transition-[transform,border-color,box-shadow] duration-300 ease-expressive hover:-translate-y-1 hover:border-mint/30 hover:shadow-glow sm:p-7"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-mint/20 bg-mint/[.07] text-mint transition-transform duration-500 ease-expressive group-hover:rotate-6 group-hover:scale-110"><Icon name={detail.icon} size={25} /></span><h3 className="mt-5 text-base font-medium text-white">{detail.title}</h3><ul className="mt-5 space-y-3 text-left">{detail.points.map((point) => <li key={point} className="flex gap-2 text-[10px] leading-5 text-white/55"><Icon name="check" size={14} className="mt-0.5 shrink-0 text-mint/75" />{point}</li>)}</ul></article></Reveal>)}</div></div>
      </section>

      <section className="landing-surface border-y border-white/[.07] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <Reveal><div><p className="text-[10px] font-semibold tracking-[.18em] text-sky-300">FROM SYNTHETIC DATA TO MODEL CARD</p><h2 className="mt-4 text-3xl font-medium leading-tight tracking-[-.055em] sm:text-5xl">A model pipeline<br /><span className="landing-heading-accent">you can inspect.</span></h2><p className="mt-5 max-w-[530px] text-sm leading-7 text-quiet">The Python ML workspace audits generated features, builds seed-wise splits, trains and calibrates candidate models, evaluates robustness, and writes reports. The browser/server mentor uses the exported tree model; optional GPU sequence training is a separate experiment.</p><a className="mt-6 inline-flex items-center gap-2 text-xs font-medium text-sky-200 transition hover:gap-3" href="#responsibility">See the methodology and limitations <Icon name="arrow" size={14} /></a></div></Reveal>
          <Reveal><div className="landing-model-card rounded-2xl border border-white/10 bg-[#07111c] p-5 shadow-card sm:p-7"><div className="flex items-center justify-between border-b border-white/[.08] pb-4"><span className="text-xs font-medium text-white/85">MODEL EVALUATION / CHECKLIST</span><span className="font-mono text-[8px] tracking-widest text-sky-200">REPRODUCIBLE</span></div><div className="mt-2">{[['Seed-wise train / validation / test', 'Splits respect scenario-seed groups'], ['Leakage and control audits', 'Shuffled-label and range-only checks'], ['Calibration and threat threshold', 'Selected with separate validation data'], ['Robustness and ablations', 'Shifted sets and controlled comparisons'], ['Report and model card', 'Metrics and limitations travel with results']].map(([title, note], i) => <div key={title} className="flex gap-3 border-b border-white/[.06] py-3.5 last:border-0"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-sky-200/25 font-mono text-[8px] text-sky-200">{String(i + 1).padStart(2, '0')}</span><span><b className="block text-[10px] font-medium text-white/80">{title}</b><small className="mt-1 block text-[9px] text-white/40">{note}</small></span></div>)}</div></div></Reveal>
        </div>
      </section>

      <section className="landing-surface border-y border-white/[.07] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto max-w-[1200px]"><Reveal><div className="text-center"><p className="text-[10px] font-semibold tracking-[.18em] text-mint">FOR TRAINEES, INSTRUCTORS & DEVELOPERS</p><h2 className="mt-4 text-3xl font-medium tracking-[-.055em] sm:text-5xl">One simulator. Multiple ways to learn.</h2></div></Reveal><div className="mt-10 grid gap-4 md:grid-cols-3">{[['TRAINEE', 'Practice at your pace', 'Choose scenarios, receive an adaptive recommendation, track your rating and revisit finished sessions.'], ['INSTRUCTOR', 'Guide a live exercise', 'Observe live sessions, review trainee reports and control supported scenario settings through a staff role.'], ['RESEARCHER', 'Reproduce and evaluate', 'Generate seeded datasets, train and audit models, evaluate robustness, and read the shipped synthetic-data report.']].map(([role, title, text], index) => <Reveal key={role} delay={['', 'delay-150', 'delay-300'][index]}><article className="group rounded-xl border border-white/[.08] bg-night/65 p-6 transition-[transform,border-color,background-color] duration-300 ease-expressive hover:-translate-y-1 hover:border-mint/25 hover:bg-panel"><span className="font-mono text-[9px] tracking-[.16em] text-mint/80">{role}</span><h3 className="mt-4 text-lg font-medium text-white">{title}</h3><p className="mt-3 text-[11px] leading-6 text-white/50">{text}</p></article></Reveal>)}</div></div>
      </section>

      <section id="responsibility" className="scroll-mt-24 px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto grid max-w-[1200px] gap-8 lg:grid-cols-[.8fr_1.2fr]">
          <Reveal><div><p className="text-[10px] font-semibold tracking-[.18em] text-amber-200">IMPORTANT CONTEXT</p><h2 className="mt-4 text-3xl font-medium leading-tight tracking-[-.055em] sm:text-4xl">Synthetic data.<br /><span className="landing-heading-accent">Honest boundaries.</span></h2><p className="mt-5 text-sm leading-7 text-quiet">SkyShield is an educational decision-training simulator. It is not an operational system, and its results should not be used to make real-world claims.</p></div></Reveal>
          <Reveal><div className="grid gap-3 sm:grid-cols-2">{[['Synthetic distribution', 'The simulator generates the data. Reported model performance describes this generated distribution only.'], ['Not real sensor validation', 'Synthetic sensors do not establish real-world detection or identification capability.'], ['Abstract response layer', 'Responses represent probabilities and delays—not weapon-specific procedures or operational instructions.'], ['Read the project cards', 'The repository includes a limitations document, a data card, a model card and evaluation reports.']].map(([title, text]) => <article key={title} className="rounded-xl border border-white/[.08] bg-white/[.025] p-5"><h3 className="text-xs font-medium text-white/85">{title}</h3><p className="mt-2 text-[10px] leading-5 text-white/45">{text}</p></article>)}</div></Reveal>
        </div>
      </section>

      <section className="landing-final-cta px-5 pb-20 pt-10 sm:px-8 sm:pb-24 lg:px-12">
        <Reveal><div className="final-cta-card"><div className="final-cta-radar motion-safe:animate-blue-breathe motion-reduce:animate-none" aria-hidden="true"><span /><span /><span /></div><div className="final-cta-copy"><p className="text-[10px] font-semibold tracking-[.18em] text-mint">YOUR NEXT RUN STARTS HERE</p><h2>{site.finalHeading ?? 'Make room to think. Make every run count.'}</h2><p>{site.finalDescription ?? 'Create a training account, choose your first scenario and see how the full replayable learning loop works.'}</p><a className="group inline-flex items-center gap-3 rounded-lg bg-mint px-6 py-3.5 text-xs font-semibold text-night no-underline transition-[transform,background-color,box-shadow] duration-300 ease-expressive hover:-translate-y-0.5 hover:bg-[#a8d9ff] hover:shadow-glow sm:text-sm" href="#/signup">Explore SkyShield <Icon name="arrow" size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></a></div><span className="final-cta-footnote">SYNTHETIC BY DESIGN <i>·</i> BUILT FOR LEARNING</span></div></Reveal>
      </section>
    </main>

    <footer className="landing-footer">
      <div className="landing-footer-main">
        <div className="landing-footer-brand"><Brand /><p>Practice with a clearer picture.<br />Learn something from every run.</p><span className="landing-footer-note"><i /> A synthetic learning environment</span></div>
        <nav className="landing-footer-group" aria-label="Explore the platform"><h2>EXPLORE</h2><a href="#platform">The platform</a><a href="#scenarios">Scenario library</a><a href="#how-it-works">How it works</a></nav>
        <nav className="landing-footer-group" aria-label="Project information"><h2>THE PROJECT</h2><a href="#responsibility">Safety & limitations</a><a href="#responsibility">Synthetic-data research</a><a href="#how-it-works">The training loop</a></nav>
        <nav className="landing-footer-group" aria-label="Your account"><h2>GET STARTED</h2><a href="#/signup">Create an account <Icon name="arrow" size={13} /></a><a href="#/login">Sign in <Icon name="arrow" size={13} /></a></nav>
      </div>
      <div className="landing-footer-bottom"><span>© 2026 SKYSHIELD TRAINER</span><p>Educational simulation only <i>·</i> Never for operational use</p><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}>BACK TO TOP <Icon name="arrow" size={13} /></button></div>
    </footer>
    <button className={`landing-back-to-top ${showBackToTop ? 'is-visible' : ''}`} type="button" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })} aria-label="Back to top" tabIndex={showBackToTop ? 0 : -1}><Icon name="arrow" size={18} /></button>
  </div>;
}
