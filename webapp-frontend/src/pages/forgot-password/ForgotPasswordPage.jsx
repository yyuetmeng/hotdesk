import { useState } from 'react';
import { Link } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { AuthLayout } from '../../auth.jsx';

// Always shows the same confirmation, so the page never reveals whether an account exists.
export function ForgotPasswordPage() {
  const [identity, setIdentity] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    if (!identity.trim()) { setError('Enter your email or username.'); return; }
    setPending(true);
    setError('');
    try {
      await flaskRequest('/api/auth/forgot-password', { method: 'POST', body: { email: identity.trim() } });
      setSent(true);
    } catch {
      setError('Unable to send the request. Check your connection and try again.');
    } finally { setPending(false); }
  }

  return <AuthLayout><div className="auth-card">{sent
    ? <>
      <p className="auth-eyebrow">Check your email</p><h1>Reset link sent</h1>
      <p className="auth-description" role="status">If an account matches, we've emailed a link to reset your password. It expires in 1 hour.</p>
      <p className="auth-help">No email? Check your spam folder, or contact your administrator.</p>
      <Link className="auth-submit" to="/login">Back to sign in</Link>
    </>
    : <>
      <p className="auth-eyebrow">Password reset</p><h1>Forgot your password?</h1>
      <p className="auth-description">Enter your workplace email or username and we'll email you a link to choose a new password.</p>
      <form onSubmit={submit} aria-busy={pending}>
        <label htmlFor="forgot-identity">Email or username</label>
        <input id="forgot-identity" autoComplete="username" required value={identity}
          onChange={(e) => setIdentity(e.target.value)} disabled={pending} />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" disabled={pending} type="submit">{pending ? 'Sending...' : 'Send reset link'}</button>
      </form>
      <Link className="auth-secondary" to="/login">Back to sign in</Link>
    </>}
  </div></AuthLayout>;
}
