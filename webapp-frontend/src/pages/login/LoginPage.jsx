import { useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AuthLayout, SessionState, useAuth } from '../../auth.jsx';
import { loginReason, safeReturnTo } from './loginLogic.js';

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const returnTo = safeReturnTo(location.state?.from);
  const reason = loginReason(returnTo);
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  if (auth.loading || auth.error) return <SessionState />;
  if (auth.user) return <Navigate to={returnTo} replace />;

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (!identity.trim()) { setError('Enter your email or username.'); return; }
    submitting.current = true;
    setPending(true);
    setError('');
    try { await auth.login(identity, password); setPassword(''); }
    catch (failure) {
      setError(failure.status === 401 ? 'Incorrect email, username, or password.' : failure.status === 403 ? failure.message : 'Unable to sign in. Please check your connection and try again.');
    } finally { submitting.current = false; setPending(false); }
  }

  return <AuthLayout><div className="auth-card"><p className="auth-eyebrow">Welcome back</p><h1>Sign in to Hot Desk</h1><p className="auth-description">Use your workplace email or username to continue.</p>
    {(reason || auth.message) && <p className="auth-message" role="status">{auth.message || reason}</p>}
    <form onSubmit={submit} aria-busy={pending}>
      <label htmlFor="login-identity">Email or username</label><input id="login-identity" name="username" autoComplete="username" required value={identity} onChange={(event) => setIdentity(event.target.value)} disabled={pending} />
      <label htmlFor="login-password">Password</label><div className="auth-password"><input id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-submit" disabled={pending} type="submit">{pending ? 'Signing in...' : 'Sign in'}</button>
    </form><Link className="auth-secondary" to="/forgot-password">Forgot your password?</Link><p className="auth-help">Need access? Contact your administrator.</p><p className="auth-help">Your session is stored for this tab only.</p>
  </div></AuthLayout>;
}
