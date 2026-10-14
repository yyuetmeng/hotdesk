import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AUTH_TOKEN_KEY, request } from './api.js';
import './auth.css';

const AuthContext = createContext(null);
const sessionKey = AUTH_TOKEN_KEY;

function storedToken() {
  try { return sessionStorage.getItem(sessionKey) || ''; } catch { return ''; }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(storedToken);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  function logout(reason = '') {
    try { sessionStorage.removeItem(sessionKey); } catch {}
    setToken('');
    setUser(null);
    setError('');
    setLoading(false);
    setMessage(reason);
  }

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request('/api/auth/me', { token, signal: controller.signal })
      .then((nextUser) => { if (!controller.signal.aborted) setUser(nextUser); })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure.status === 401 || failure.status === 403) logout('Your session has ended. Please sign in again.');
        else setError('Unable to verify your session. Check your connection and try again.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, attempt]);

  useEffect(() => {
    if (!token) return;
    let expires;
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      expires = JSON.parse(atob(payload)).exp * 1000;
    } catch { return; }
    if (!Number.isFinite(expires)) return;
    // The server verifies the token; this timer only clears expired UI state.
    const check = () => { if (Date.now() >= expires) logout('Your session has expired. Please sign in again.'); };
    const timer = window.setTimeout(check, Math.max(0, Math.min(expires - Date.now(), 2147483647)));
    window.addEventListener('focus', check);
    return () => { clearTimeout(timer); window.removeEventListener('focus', check); };
  }, [token]);

  async function login(identity, password) {
    const result = await request('/api/auth/login', { method: 'POST', body: { email_or_username: identity.trim(), password } });
    if (!result.token || !result.user) throw new Error('The server returned an invalid login response.');
    try { sessionStorage.setItem(sessionKey, result.token); } catch { /* Remain signed in in memory when storage is unavailable. */ }
    setMessage('');
    setError('');
    setUser(result.user);
    setLoading(true);
    setToken(result.token);
  }

  return <AuthContext.Provider value={{ user, loading, error, message, login, logout, retry: () => setAttempt((value) => value + 1) }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }

export function RequireAuth({ children }) {
  const auth = useAuth();
  if (auth.loading || auth.error) return <SessionState />;
  if (!auth.user) return <Navigate to="/login" replace />;
  return children;
}

export function AuthLayout({ children }) {
  return <main className="auth-page"><section className="auth-intro"><Link to="/" className="auth-brand">HOT DESK <span>/ WORKSPACE</span></Link><div><p className="auth-eyebrow">Your workplace, connected</p><h1>A place to do<br />your best work.</h1><p>One account. Your team. Your workspace.</p></div><p className="auth-footnote">Hot Desk account access</p></section><section className="auth-content">{children}</section></main>;
}

export function SessionState() {
  const auth = useAuth();
  return <AuthLayout><div className="auth-card">{auth.loading ? <p role="status">Verifying your session...</p> : <><h1>Connection unavailable</h1><p role="alert">{auth.error}</p><button className="auth-submit" onClick={auth.retry}>Try again</button><button className="auth-secondary" onClick={() => auth.logout()}>Return to sign in</button></>}</div></AuthLayout>;
}
