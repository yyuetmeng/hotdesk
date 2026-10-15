import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { FloorPlanPage } from './pages/floor-plan/FloorPlanPage.jsx';
import { CheckInPage } from './desk/CheckInPage.jsx';
import { QrSheetPage } from './desk/QrSheetPage.jsx';
import { DisplayPage } from './display/DisplayPage.jsx';
import { BookDeskPage } from './desk/BookDeskPage.jsx';
import { DisplaysPage } from './pages/displays/DisplaysPage.jsx';
import { InsightsPage } from './pages/insights/InsightsPage.jsx';
import { AccountPage } from './pages/account/AccountPage.jsx';
import { LoginPage } from './pages/login/LoginPage.jsx';
import { UsersPage } from './pages/users/UsersPage.jsx';
import { SetPasswordPage } from './pages/set-password/SetPasswordPage.jsx';
import { ForgotPasswordPage } from './pages/forgot-password/ForgotPasswordPage.jsx';
import { AuthProvider, RequireAuth, useAuth } from './auth.jsx';
import logo from './logo.png';
import FloorPlansPage from './floorplan/FloorPlansPage.jsx';
import EditorPage from './floorplan/EditorPage.jsx';
import ThemeSettings from './ThemeSettings.jsx';
import { isAdmin } from './roles.js';
import { readCollapsed, saveCollapsed, shellClass } from './layout.js';

const workspaceLinks = [['/', 'Floor plan', 'floorplan'], ['/book', 'Book a desk', 'booking'], ['/checkin', 'Desk check-in', 'checkin']];
const analyticsLinks = [['/insights', 'Insights', 'insights']];
const adminLinks = [['/displays', 'Manage Floor Display', 'display'], ['/floor-plans', 'Manage Floor Plan', 'planner'], ['/users', 'Manage Users / Project Teams', 'users']];

function NavIcon({ name }) {
  const paths = {
    floorplan: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h8M11 3v18M15 14h6"/></>,
    booking: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m9 15 2 2 4-4"/></>,
    checkin: <><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></>,
    insights: <><path d="M3 3v18h18"/><path d="m7 14 3-3 3 2 5-6"/><path d="M15 7h3v3"/></>,
    display: <><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    planner: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M3 9h5M16 13h5M16 13v8"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6.5 6.5 0 0 1 3 5.5V20"/></>,
    account: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    signout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M9 12h12m-4-4 4 4-4 4"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
    collapse: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M16 10l-2 2 2 2"/></>,
    expand: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M14 10l2 2-2 2"/></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

// Desktop: full sidebar or an icon rail (collapsed). Mobile: a drawer that slides out from the left.
function Sidebar({ collapsed, onToggleCollapsed, onClose }) {
  const { user, logout } = useAuth();
  const tip = (label) => (collapsed ? label : undefined);
  const nav = (links) => links.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'} title={tip(label)}>
    <NavIcon name={icon}/><span className="nav-text">{label}</span></NavLink>);
  return <aside className="sidebar" id="app-sidebar">
    <div className="sidebar-head">
      <NavLink className="brand" to="/" title={tip('Hot Desk Dashboard')}><img className="brand-mark" src={logo} alt=""/><span><b>Hot Desk Dashboard</b></span></NavLink>
      <button type="button" className="sidebar-icon-button sidebar-collapse" onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
        <NavIcon name={collapsed ? 'expand' : 'collapse'}/></button>
      <button type="button" className="sidebar-icon-button sidebar-close" onClick={onClose} aria-label="Close menu"><NavIcon name="close"/></button>
    </div>
    <nav aria-label="Application navigation">
      <p className="nav-label">Workspace</p>{nav(workspaceLinks)}
      {isAdmin(user) && <>
        <p className="nav-label">Analytics</p>{nav(analyticsLinks)}
        <p className="nav-label">Administration</p>{nav(adminLinks)}
      </>}
    </nav>
    <div className="sidebar-footer">
      <nav aria-label="Account">
        <p className="nav-label">Account</p><NavLink to={user ? '/account' : '/login'} title={tip(user ? 'My account' : 'Sign in')}><NavIcon name="account"/><span className="nav-text">{user ? 'My account' : 'Sign in'}</span></NavLink>
        {user && <button type="button" className="sidebar-signout" title={tip('Sign out')} onClick={() => logout()}><NavIcon name="signout"/><span className="nav-text">Sign out</span></button>}
      </nav>
      <ThemeSettings />
    </div>
  </aside>;
}

export default function App() {
  return <AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/set-password" element={<SetPasswordPage />} />
    <Route path="/display/:slug" element={<DisplayPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/account" element={<AccountPage />} />
    <Route path="*" element={<RequireAuth><Workspace /></RequireAuth>} />
  </Routes></AuthProvider>;
}

// Analytics and Administration pages are for admins only; anyone else is sent to the floor plan.
function AdminOnly({ children }) {
  const { user } = useAuth();
  return isAdmin(user) ? children : <Navigate to="/" replace />;
}

function Workspace() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setDrawerOpen(false); }, [pathname]);   // picking a page closes the mobile menu
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);
  const toggleCollapsed = () => { const next = !collapsed; setCollapsed(next); saveCollapsed(next); };
  return <div className={shellClass({ collapsed, drawerOpen })}>
    <header className="mobile-bar">
      <button type="button" className="sidebar-icon-button hamburger" onClick={() => setDrawerOpen(true)}
        aria-label="Open menu" aria-expanded={drawerOpen} aria-controls="app-sidebar"><NavIcon name="menu"/></button>
      <NavLink className="brand" to="/"><img className="brand-mark" src={logo} alt=""/><span><b>Hot Desk Dashboard</b></span></NavLink>
    </header>
    <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} onClose={() => setDrawerOpen(false)} />
    <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
    <div className="app-content"><Routes>
      <Route path="/" element={<FloorPlanPage />} />
      <Route path="/checkin" element={<CheckInPage />} />
      <Route path="/checkin/:seatId" element={<CheckInPage />} />
      <Route path="/book" element={<BookDeskPage />} />
      <Route path="/displays" element={<AdminOnly><DisplaysPage /></AdminOnly>} />
      <Route path="/insights" element={<AdminOnly><InsightsPage /></AdminOnly>} />
      <Route path="/floor-plans" element={<AdminOnly><FloorPlansPage /></AdminOnly>} />
      <Route path="/floor-plans/:id" element={<AdminOnly><EditorPage /></AdminOnly>} />
      <Route path="/floor-plans/:id/qr" element={<AdminOnly><QrSheetPage /></AdminOnly>} />
      <Route path="/users" element={<AdminOnly><UsersPage /></AdminOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></div>
  </div>;
}
