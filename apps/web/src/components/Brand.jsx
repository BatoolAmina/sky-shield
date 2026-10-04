import React from 'react';

export default function Brand({ className = '', inverse = false }) {
  return <a className={`brand ${className} ${inverse ? 'text-night' : ''}`} href="#/" aria-label="SkyShield home">
    <img className="brand-logo" src="/images/branding/skyshield-logo.png" alt="" />
    <span className="brand-name">SkyShield</span>
  </a>;
}
