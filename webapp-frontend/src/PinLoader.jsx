// Loading animation used on every page: a pin drops onto desks in a small room, with the page's
// own loading text underneath (e.g. "Loading floor plan..."). Honours prefers-reduced-motion.
import { useEffect, useState } from 'react';
import { DESKS, PIN_DROP_MS, PIN_STEP_MS, pinStep } from './pinLoaderLogic.js';
import './pinLoader.css';

export default function PinLoader({ label = 'Loading...', decorative = false }) {
  const [step, setStep] = useState(0);
  const [found, setFound] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => s + 1), PIN_STEP_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setFound(false);
    const timer = setTimeout(() => setFound(true), PIN_DROP_MS);
    return () => clearTimeout(timer);
  }, [step]);

  const { desk, pin, ripple } = pinStep(step);
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-live': 'polite' };
  return <div className="pin-loader" {...a11y}>
    <div className="pin-loader__room" aria-hidden="true">
      {DESKS.map(([x, y], i) => <div key={i} className={`pin-loader__desk${found && i === desk ? ' is-on' : ''}`} style={{ left: x, top: y }} />)}
      {/* A new key per step remounts the pin and ripple so their animations replay. */}
      {found && <div key={`r${step}`} className="pin-loader__ripple is-go" style={ripple} />}
      <svg key={`p${step}`} className="pin-loader__pin is-drop" style={pin} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </svg>
    </div>
    {!decorative && <div className="pin-loader__label">{label}</div>}
  </div>;
}
