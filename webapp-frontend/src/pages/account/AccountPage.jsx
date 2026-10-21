import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { AuthLayout, SessionState, useAuth } from '../../auth.jsx';
import { PasswordStrength, usePasswordCheck } from '../../PasswordStrength.jsx';

// Change your own password (owner 2026-10-16): current password, then a new one that follows the policy
// (8+ characters, letters and numbers, not well-known), typed twice.
function ChangePassword({ user }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);   // { kind, text }
  const check = usePasswordCheck(next, { username: user.username, email: user.email });

  const submit = async (event) => {
    event.preventDefault();
    if (!check.ok) { setMessage({ kind: 'error', text: 'The new password does not meet the rules below.' }); return; }
    if (next !== confirm) { setMessage({ kind: 'error', text: 'The two new passwords do not match.' }); return; }
    setPending(true); setMessage(null);
    try {
      await flaskRequest('/api/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } });
      setMessage({ kind: 'success', text: 'Your password has been changed.' });
      setCurrent(''); setNext(''); setConfirm(''); setOpen(false);
    } catch (err) {
      setMessage({ kind: 'error', text: err.fields?.current_password ?? err.fields?.new_password ?? err.message });
    } finally { setPending(false); }
  };

  return <div className="account-password">
    {message && <p className={message.kind === 'error' ? 'auth-error' : 'auth-success'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    {!open ? <button type="button" className="auth-secondary" onClick={() => { setOpen(true); setMessage(null); }}>Change password</button>
      : <form onSubmit={submit} aria-busy={pending}>
        <h2>Change password</h2>
        <label htmlFor="current-password">Current password</label>
        <input id="current-password" type={visible ? 'text' : 'password'} autoComplete="current-password" required
          value={current} onChange={(e) => setCurrent(e.target.value)} disabled={pending} />
        <label htmlFor="new-password">New password</label>
        <div className="auth-password">
          <input id="new-password" type={visible ? 'text' : 'password'} autoComplete="new-password" required
            value={next} onChange={(e) => setNext(e.target.value)} disabled={pending} />
          <button type="button" aria-label={visible ? 'Hide passwords' : 'Show passwords'} aria-pressed={visible}
            onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button>
        </div>
        <PasswordStrength check={check} />
        <label htmlFor="confirm-password">Confirm new password</label>
        <input id="confirm-password" type={visible ? 'text' : 'password'} autoComplete="new-password" required
          value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={pending} />
        <button className="auth-submit" disabled={pending || !check.ok || !current} type="submit">{pending ? 'Saving...' : 'Change password'}</button>
        <button type="button" className="auth-secondary" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
      </form>}
  </div>;
}

export function AccountPage() {
  const auth = useAuth();
  if (auth.loading || auth.error) return <SessionState />;
  if (!auth.user) return <Navigate to="/login" replace />;
  const user = auth.user;
  return <AuthLayout><div className="auth-card"><p className="auth-eyebrow">Your account</p><h1>Welcome, {user.full_name || user.username}</h1><p className="auth-description">You are signed in to Hot Desk.</p><dl className="auth-details"><dt>Email</dt><dd>{user.email}</dd><dt>Username</dt><dd>{user.username}</dd><dt>Role</dt><dd>{user.role}</dd><dt>Project teams</dt><dd>{user.departments?.map((department) => department.name).join(', ') || 'No project teams'}</dd></dl>
    <ChangePassword user={user} />
    <button className="auth-submit" onClick={() => auth.logout()}>Sign Out</button><Link className="auth-secondary" to="/">View workspace</Link></div></AuthLayout>;
}
