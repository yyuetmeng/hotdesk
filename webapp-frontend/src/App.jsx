import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { DashboardPage } from './pages/dashboard/DashboardPage.jsx';
import { AuditLogPage } from './pages/audit/AuditLogPage.jsx';
import { ColleagueFinderPage } from './pages/finder/ColleagueFinderPage.jsx';
import { CheckInPage } from './desk/CheckInPage.jsx';
import { DeskLabelsPage } from './qr/DeskLabelsPage.jsx';
import { LoaderHost } from './components.jsx';
import { DisplayPage } from './display/DisplayPage.jsx';
import { BookDeskPage } from './desk/BookDeskPage.jsx';
import { DisplaysPage } from './pages/displays/DisplaysPage.jsx';
import { FloorOverviewPage } from './pages/overview/FloorOverviewPage.jsx';
import { ScanPage } from './desk/ScanPage.jsx';
import { InsightsPage } from './pages/insights/InsightsPage.jsx';
import { SeatAssignmentsPage } from './pages/assignments/SeatAssignmentsPage.jsx';
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
import { canManageAccounts, isAccountManager, isAdmin } from './roles.js';
import { BOTTOM_LINKS, readCollapsed, saveCollapsed, shellClass } from './layout.js';

const workspaceLinks = [['/', 'Dashboard', 'dashboard'], ['/overview', 'Floor overview', 'overview'], ['/book', 'Book a desk', 'booking'], ['/checkin', 'Desk check-in', 'checkin'], ['/finder', 'Colleague Finder', 'finder']];
const analyticsLinks = [['/insights', 'Insights', 'insights']];
// Account managers (non-admins who manage accounts for chosen teams) see only Manage Users.
const accountManagerLinks = [['/users', 'Manage Users', 'users']];
const adminLinks = [['/desk-labels', 'Print Desk Labels', 'labels'], ['/displays', 'Manage Floor Display', 'display'], ['/floor-plans', 'Manage Floor Plan', 'planner'], ['/users', 'Manage Users / Project Teams', 'users'], ['/seat-assignments', 'Seat assignments', 'seat'], ['/audit', 'Audit Log', 'audit']];

function NavIcon({ name }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
    booking: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m9 15 2 2 4-4"/></>,
    checkin: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12.5l2.8 2.8L16.5 9"/></>,
    scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="3" height="3"/><rect x="13" y="8" width="3" height="3"/><rect x="8" y="13" width="3" height="3"/><path d="M13 13h3v3"/></>,
    insights: <><path d="M3 3v18h18"/><path d="m7 14 3-3 3 2 5-6"/><path d="M15 7h3v3"/></>,
    display: <><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    overview: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M10 10v11"/></>,
    planner: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M3 9h5M16 13h5M16 13v8"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6.5 6.5 0 0 1 3 5.5V20"/></>,
    account: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    signout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M9 12h12m-4-4 4 4-4 4"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    audit: <><path d="M9 4h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9"/><path d="M4 4l5 5M9 4v5H4"/><path d="M9 13h7M9 17h5"/></>,
    finder: <><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20v-1a6.5 6.5 0 0 1 9.5-5.8"/><circle cx="17" cy="16" r="3"/><path d="m19.2 18.2 2.3 2.3"/></>,
    seat: <><path d="M7 4v8h10"/><path d="M7 12v8M17 12v8M7 16h10"/><path d="M14 3h6v5h-6z"/></>,
    labels: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></>,
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
      <NavLink className="brand" to="/" title={tip('Hot Desk')}><img className="brand-mark" src={logo} alt=""/><span><b>Hot Desk</b></span></NavLink>
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
      {isAccountManager(user) && <>
        <p className="nav-label">Administration</p>{nav(accountManagerLinks)}
      </>}
    </nav>
    <div className="sidebar-footer">
      <ThemeSettings />
      <nav aria-label="Account">
        <NavLink to={user ? '/account' : '/login'} title={tip(user ? 'My account' : 'Sign in')}><NavIcon name="account"/><span className="nav-text">{user ? 'My account' : 'Sign in'}</span></NavLink>
        {user && <button type="button" className="sidebar-signout" title={tip('Sign out')} onClick={() => logout()}><NavIcon name="signout"/><span className="nav-text">Sign out</span></button>}
      </nav>
    </div>
  </aside>;
}

export default function App() {
  return <AuthProvider><LoaderHost /><Routes>
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

// Manage Users is for admins and for account managers; anyone else is sent to the floor plan.
function AccountManagersOnly({ children }) {
  const { user } = useAuth();
  return canManageAccounts(user) ? children : <Navigate to="/" replace />;
}

// The old per-plan QR sheet now lives in Print Desk Labels, filtered to that floor.
function OldQrLink() {
  const { id } = useParams();
  return <Navigate to={`/desk-labels?floor=${id}`} replace />;
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
      <NavLink className="brand" to="/"><img className="brand-mark" src={logo} alt=""/><span><b>Hot Desk</b></span></NavLink>
    </header>
    <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} onClose={() => setDrawerOpen(false)} />
    <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
    <div className="app-content"><Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/scan" element={<ScanPage />} />
      <Route path="/checkin" element={<CheckInPage />} />
      <Route path="/checkin/:seatId" element={<CheckInPage />} />
      <Route path="/overview" element={<FloorOverviewPage />} />
      <Route path="/book" element={<BookDeskPage />} />
      <Route path="/finder" element={<ColleagueFinderPage />} />
      <Route path="/displays" element={<AdminOnly><DisplaysPage /></AdminOnly>} />
      <Route path="/insights" element={<AdminOnly><InsightsPage /></AdminOnly>} />
      <Route path="/floor-plans" element={<AdminOnly><FloorPlansPage /></AdminOnly>} />
      <Route path="/floor-plans/:id" element={<AdminOnly><EditorPage /></AdminOnly>} />
      <Route path="/floor-plans/:id/qr" element={<AdminOnly><OldQrLink /></AdminOnly>} />
      <Route path="/desk-labels" element={<AdminOnly><DeskLabelsPage /></AdminOnly>} />
      <Route path="/users" element={<AccountManagersOnly><UsersPage /></AccountManagersOnly>} />
      <Route path="/seat-assignments" element={<AdminOnly><SeatAssignmentsPage /></AdminOnly>} />
      <Route path="/audit" element={<AdminOnly><AuditLogPage /></AdminOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></div>
    <nav className="bottom-nav" aria-label="Quick links">
      {BOTTOM_LINKS.map((l) => <NavLink key={l.to} to={l.to} className={l.main ? 'main' : undefined}>
        {l.main ? <span className="bottom-nav-fab"><NavIcon name={l.icon}/></span> : <NavIcon name={l.icon}/>}<span>{l.label}</span>
      </NavLink>)}
    </nav>
  </div>;
}
