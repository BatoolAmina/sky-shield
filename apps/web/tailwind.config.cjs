module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  safelist: ['delay-100', 'delay-150', 'delay-200', 'delay-300'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        night: '#050810',
        panel: '#0b1120',
        mint: '#70bdff',
        ink: '#e7f1ff',
        quiet: '#9aabc5',
        violet: '#87a8ff',
      },
      boxShadow: {
        glow: '0 0 64px rgba(56, 120, 214, .11)',
        card: '0 24px 80px rgba(0, 0, 0, .28)',
      },
      backgroundImage: {
        'hero-grid': 'linear-gradient(rgba(136, 184, 255, .065) 1px, transparent 1px), linear-gradient(90deg, rgba(136, 184, 255, .065) 1px, transparent 1px)',
        'aurora': 'radial-gradient(ellipse at 15% 18%, rgba(41, 119, 255, .10), transparent 38%), radial-gradient(ellipse at 78% 10%, rgba(48, 199, 255, .045), transparent 34%)',
      },
      keyframes: {
        'float-slow': { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-12px)' } },
        'radar-spin': { to: { transform: 'rotate(360deg)' } },
        'signal-pulse': { '0%, 100%': { opacity: '.35', transform: 'scale(.88)' }, '50%': { opacity: '1', transform: 'scale(1.12)' } },
        'track-ping': { '0%': { transform: 'scale(1)', opacity: '.7' }, '70%, 100%': { transform: 'scale(2.25)', opacity: '0' } },
        'marquee': { to: { transform: 'translateX(-50%)' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(22px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in': { from: { opacity: '0', transform: 'translateX(18px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'header-drop': { from: { opacity: '0', transform: 'translateY(-12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'orbit': { to: { transform: 'rotate(360deg)' } },
        'blue-breathe': { '0%, 100%': { opacity: '.45' }, '50%': { opacity: '.8' } },
      },
      animation: {
        float: 'float-slow 7s ease-in-out infinite',
        radar: 'radar-spin 14s linear infinite',
        'radar-sweep': 'radar-spin 22s linear infinite',
        'track-ping': 'track-ping 2.8s cubic-bezier(0, 0, .2, 1) infinite',
        'orbit-slow': 'orbit 24s linear infinite',
        'orbit-reverse': 'orbit 33s linear infinite reverse',
        pulse: 'signal-pulse 2s ease-in-out infinite',
        marquee: 'marquee 28s linear infinite',
        'fade-up': 'fade-up .8s cubic-bezier(.2,.7,.2,1) both',
        'slide-in': 'slide-in .75s cubic-bezier(.16,1,.3,1) both',
        'header-drop': 'header-drop .55s cubic-bezier(.16,1,.3,1) both',
        'blue-breathe': 'blue-breathe 8s ease-in-out infinite',
      },
      transitionTimingFunction: {
        expressive: 'cubic-bezier(.16, 1, .3, 1)',
      },
      fontFamily: {
        sans: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
