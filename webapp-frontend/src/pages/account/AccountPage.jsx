import { Link, Navigate } from 'react-router-dom';
import { AuthLayout, SessionState, useAuth } from '../../auth.jsx';

export function AccountPage() {
  const auth = useAuth();
  if (auth.loading || auth.error) return <SessionState />;
  if (!auth.user) return <Navigate to="/login" replace />;
  const user = auth.user;
  return <AuthLayout><div className="auth-card"><p className="auth-eyebrow">Your account</p><h1>Welcome, {user.full_name || user.username}</h1><p className="auth-description">You are signed in to Hot Desk.</p><dl className="auth-details"><dt>Email</dt><dd>{user.email}</dd><dt>Username</dt><dd>{user.username}</dd><dt>Role</dt><dd>{user.role}</dd><dt>Departments</dt><dd>{user.departments?.map((department) => department.name).join(', ') || 'No departments assigned'}</dd></dl><button className="auth-submit" onClick={() => auth.logout()}>Sign out</button><Link className="auth-secondary" to="/">View workspace</Link><p className="auth-help">Workspace pages currently use a separate legacy service. Signing in here does not connect their desk data.</p></div></AuthLayout>;
}
