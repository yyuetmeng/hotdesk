import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage, CheckInPage, BookingPage, DisplayPage, InsightsPage, SensorsPage } from './pages.jsx';

const workspaceLinks = [['/', 'Floor plan', 'floorplan'], ['/book', 'Book a desk', 'booking'], ['/checkin', 'Desk check-in', 'checkin']];
const adminLinks = [['/insights', 'Insights', 'insights'], ['/sensors', 'Sensors', 'sensors'], ['/display', 'Floor display', 'display']];

function NavIcon({ name }) {
  const paths = {
    floorplan: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h8M11 3v18M15 14h6"/></>,
    booking: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m9 15 2 2 4-4"/></>,
    checkin: <><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></>,
    insights: <><path d="M3 3v18h18"/><path d="m7 14 3-3 3 2 5-6"/><path d="M15 7h3v3"/></>,
    sensors: <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/><path d="M1.5 9a15 15 0 0 1 21 0"/></>,
    display: <><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Sidebar() {
  const nav = (links) => links.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'}><NavIcon name={icon}/>{label}</NavLink>);
  return <aside className="sidebar">
    <NavLink className="brand" to="/"><img className="brand-mark" src="/logo.png" alt=""/><span><b>Hot Desk Dashboard</b></span></NavLink>
    <nav aria-label="Application navigation">
      <p className="nav-label">Workspace</p>{nav(workspaceLinks)}
      <p className="nav-label">Administration</p>{nav(adminLinks)}
    </nav>
  </aside>;
}

export default function App() {
  return <div className="app-shell">
    <Sidebar />
    <div className="app-content"><Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/checkin" element={<CheckInPage />} />
      <Route path="/book" element={<BookingPage />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route path="/insights" element={<InsightsPage />} />
      <Route path="/sensors" element={<SensorsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></div>
  </div>;
}
