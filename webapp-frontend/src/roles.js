// Role checks for the UI. The server enforces access on every admin endpoint; this only decides
// what the menu shows and which pages a signed-in user can open.
export const isAdmin = (user) => user?.role === 'admin';
