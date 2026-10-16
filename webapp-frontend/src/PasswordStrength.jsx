// Password strength as you type (owner 2026-10-16): a bar, a label and the three rules ticked off.
// usePasswordCheck hashes what is typed in the browser and compares it with the well-known password hashes, so
// the password is never sent while typing; the server checks again when it is saved.
import { useEffect, useState } from 'react';
import { flaskRequest } from './api.js';
import { checkPassword, commonFormsHex, loadCommonHashes } from './passwordPolicy.js';
import './passwordStrength.css';

export function usePasswordCheck(password, { username, email } = {}) {
  const [common, setCommon] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!password || !globalThis.crypto?.subtle) { setCommon(false); return undefined; }   // no Web Crypto: server checks
    Promise.all([loadCommonHashes(flaskRequest), commonFormsHex(password)])
      .then(([hashes, forms]) => { if (alive) setCommon(forms.some((h) => hashes.has(h))); })
      .catch(() => { if (alive) setCommon(false); });
    return () => { alive = false; };
  }, [password]);
  return checkPassword(password, { common, username, email });
}

export function PasswordStrength({ check }) {
  return <div className="pw-strength" aria-live="polite">
    <div className="pw-bar" aria-hidden="true">{[1, 2, 3, 4].map((n) => <span key={n} className={check.score >= n ? `on s${check.score}` : ''} />)}</div>
    {check.label && <small className={`pw-label s${check.score}`}>{check.label}</small>}
    <ul className="pw-rules">{check.rules.map((r) => <li key={r.text} className={r.ok ? 'ok' : ''}>{r.ok ? '✓' : '•'} {r.text}</li>)}</ul>
  </div>;
}
