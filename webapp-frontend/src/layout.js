// App shell layout: the desktop sidebar can collapse to an icon rail (remembered per browser);
// on mobile the sidebar is a drawer opened from the hamburger in the top bar.

const STORAGE_KEY = 'hotdesk.sidebarCollapsed';

export const parseCollapsed = (value) => value === '1';

export function readCollapsed() {
  try { return parseCollapsed(window.localStorage.getItem(STORAGE_KEY)); } catch { return false; }
}

export function saveCollapsed(collapsed) {
  try { window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* keep for this visit only */ }
}

export const shellClass = ({ collapsed, drawerOpen }) =>
  ['app-shell', collapsed && 'collapsed', drawerOpen && 'drawer-open'].filter(Boolean).join(' ');
