import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { FloorPlanPage } from './pages/floor-plan/FloorPlanPage.jsx';
import { CheckInPage } from './desk/CheckInPage.jsx';
import { QrSheetPage } from './desk/QrSheetPage.jsx';
import { DisplayPage } from './display/DisplayPage.jsx';
import { BookDeskPage } from './desk/BookDeskPage.jsx';
import { DisplaysPage } from './pages/displays/DisplaysPage.jsx';
import { InsightsPage } from './pages/insights/InsightsPage.jsx';
import { SensorsPage } from './pages/sensors/SensorsPage.jsx';
import { AccountPage } from './pages/account/AccountPage.jsx';
import { LoginPage } from './pages/login/LoginPage.jsx';
import { UsersPage } from './pages/users/UsersPage.jsx';
import { SetPasswordPage } from './pages/set-password/SetPasswordPage.jsx';
import { ForgotPasswordPage } from './pages/forgot-password/ForgotPasswordPage.jsx';
import { AuthProvider, RequireAuth, useAuth } from './auth.jsx';
import logo from './logo.png';
import FloorPlansPage from './floorplan/FloorPlansPage.jsx';
import EditorPage from './floorplan/EditorPage.jsx';

const workspaceLinks = [['/', 'Floor plan', 'floorplan'], ['/book', 'Book a desk', 'booking'], ['/checkin', 'Desk check-in', 'checkin']];
const adminLinks = [['/insights', 'Insights', 'insights'], ['/sensors', 'Sensors', 'sensors'], ['/displays', 'Floor display', 'display'], ['/floor-plans', 'Manage Floor Plan', 'planner'], ['/users', 'Manage Users', 'users']];

function NavIcon({ name }) {
  const paths = {
    floorplan: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h8M11 3v18M15 14h6"/></>,
    booking: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m9 15 2 2 4-4"/></>,
    checkin: <><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></>,
    insights: <><path d="M3 3v18h18"/><path d="m7 14 3-3 3 2 5-6"/><path d="M15 7h3v3"/></>,
    sensors: <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/><path d="M1.5 9a15 15 0 0 1 21 0"/></>,
    display: <><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    planner: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M3 9h5M16 13h5M16 13v8"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6.5 6.5 0 0 1 3 5.5V20"/></>,
    account: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    signout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M9 12h12m-4-4 4 4-4 4"/></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Sidebar() {
  const { user, logout } = useAuth();
  const nav = (links) => links.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'}><NavIcon name={icon}/>{label}</NavLink>);
  return <aside className="sidebar">
    <NavLink className="brand" to="/"><img className="brand-mark" src={logo} alt=""/><span><b>Hot Desk Dashboard</b></span></NavLink>
    <nav aria-label="Application navigation">
      <p className="nav-label">Workspace</p>{nav(workspaceLinks)}
      <p className="nav-label">Administration</p>{nav(adminLinks)}
      <p className="nav-label">Account</p><NavLink to={user ? '/account' : '/login'}><NavIcon name="account"/>{user ? 'My account' : 'Sign in'}</NavLink>
      {user && <button type="button" className="sidebar-signout" onClick={() => logout()}><NavIcon name="signout"/>Sign out</button>}
    </nav>
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

function Workspace() {
  return <div className="app-shell">
    <Sidebar />
    <div className="app-content"><Routes>
      <Route path="/" element={<FloorPlanPage />} />
      <Route path="/checkin" element={<CheckInPage />} />
      <Route path="/checkin/:seatId" element={<CheckInPage />} />
      <Route path="/book" element={<BookDeskPage />} />
      <Route path="/displays" element={<DisplaysPage />} />
      <Route path="/insights" element={<InsightsPage />} />
      <Route path="/sensors" element={<SensorsPage />} />
      <Route path="/floor-plans" element={<FloorPlansPage />} />
      <Route path="/floor-plans/:id" element={<EditorPage />} />
      <Route path="/floor-plans/:id/qr" element={<QrSheetPage />} />
      <Route path="/users" element={<UsersPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></div>
  </div>;
}
