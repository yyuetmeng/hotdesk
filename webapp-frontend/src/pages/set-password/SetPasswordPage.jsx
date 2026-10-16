import { useEffect, useState } from 'react';
import { PasswordStrength, usePasswordCheck } from '../../PasswordStrength.jsx';
import { Link } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { AuthLayout } from '../../auth.jsx';

const MIN_LENGTH = 8;

const readTokenFromUrl = () => new URLSearchParams(window.location.search).get('token') || '';

// Drop the emailed token from the address bar once it is in state, so it does not linger in
// history, screenshots or copied URLs. See docs/superpowers/specs/2026-10-14-password-pages-design.md.
function removeTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('token')) return;
  params.delete('token');
  const query = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

async function tokenKind(token) {
  for (const purpose of ['activate', 'reset']) {
    const { valid } = await flaskRequest(
      `/api/auth/set-password/verify?purpose=${purpose}&token=${encodeURIComponent(token)}`);
    if (valid) return purpose;
  }
  return null;
}

const COPY = {
  activate: { eyebrow: 'Welcome to Hot Desk', title: 'Activate your account', button: 'Activate account',
    done: 'Your account is activated', doneText: 'You can now sign in with your new password.' },
  reset: { eyebrow: 'Password reset', title: 'Choose a new password', button: 'Reset password',
    done: 'Your password has been reset', doneText: 'You can now sign in with your new password.' },
};

export function SetPasswordPage() {
  const [token] = useState(readTokenFromUrl);
  const [state, setState] = useState(token ? 'checking' : 'missing'); // checking | form | done | invalid | missing | error
  const [kind, setKind] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { removeTokenFromUrl(); }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setState('checking');
    tokenKind(token)
      .then((found) => { if (!cancelled) { setKind(found); setState(found ? 'form' : 'invalid'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [token, attempt]);

  let body;
  if (state === 'checking') body = <p role="status">Checking your link...</p>;
  else if (state === 'missing') body = <>
    <p className="auth-eyebrow">Set password</p><h1>This link is incomplete</h1>
    <p className="auth-description">Open the link from your email again, making sure the whole address was copied.</p>
    <Link className="auth-secondary" to="/forgot-password">Request a new link</Link>
    <Link className="auth-secondary" to="/login">Back to sign in</Link>
  </>;
  else if (state === 'error') body = <>
    <h1>Connection unavailable</h1>
    <p role="alert">We could not check your link. Check your connection and try again.</p>
    <button className="auth-submit" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
  </>;
  else if (state === 'invalid') body = <>
    <p className="auth-eyebrow">Set password</p><h1>This link has expired or was already used</h1>
    <p className="auth-description">Password reset links work for 1 hour and invitations for 72 hours, and each link works once.</p>
    <p className="auth-description">If you were resetting your password, request a new link. If this was an invitation, ask your administrator to resend it.</p>
    <Link className="auth-submit" to="/forgot-password">Request a new link</Link>
    <Link className="auth-secondary" to="/login">Back to sign in</Link>
  </>;
  else if (state === 'done') body = <>
    <p className="auth-eyebrow">All set</p><h1>{COPY[kind].done}</h1>
    <p className="auth-description">{COPY[kind].doneText}</p>
    <Link className="auth-submit" to="/login">Sign in</Link>
  </>;
  else body = <PasswordForm token={token} copy={COPY[kind]}
    onDone={() => setState('done')} onInvalid={() => setState('invalid')} />;

  return <AuthLayout><div className="auth-card">{body}</div></AuthLayout>;
}

function PasswordForm({ token, copy, onDone, onInvalid }) {
  const [password, setPassword] = useState('');
  const check = usePasswordCheck(password);
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    if (!check.ok) { setError('The password does not meet the rules below.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setPending(true);
    setError('');
    try {
      await flaskRequest('/api/auth/set-password', { method: 'POST', body: { token, password } });
      onDone();
    } catch (failure) {
      if (failure.status === 400 && failure.fields?.password) setError(failure.fields.password);
      else if (failure.status === 400) onInvalid();
      else setError('Unable to save your password. Check your connection and try again.');
    } finally { setPending(false); }
  }

  return <>
    <p className="auth-eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1>
    <p className="auth-description">At least {MIN_LENGTH} characters, with letters and numbers, and not a well-known password.</p>
    <form onSubmit={submit} aria-busy={pending}>
      <label htmlFor="new-password">New password</label>
      <div className="auth-password">
        <input id="new-password" type={visible ? 'text' : 'password'} autoComplete="new-password" required
          minLength={MIN_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} />
        <button type="button" aria-label={visible ? 'Hide passwords' : 'Show passwords'} aria-pressed={visible}
          onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button>
      </div>
      <PasswordStrength check={check} />
      <label htmlFor="confirm-password">Confirm password</label>
      <input id="confirm-password" type={visible ? 'text' : 'password'} autoComplete="new-password" required
        value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={pending} />
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-submit" disabled={pending} type="submit">{pending ? 'Saving...' : copy.button}</button>
    </form>
  </>;
}
