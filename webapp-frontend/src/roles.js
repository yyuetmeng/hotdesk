// Role checks for the UI. The server enforces access on every admin endpoint; this only decides
// what the menu shows and which pages a signed-in user can open.
export const isAdmin = (user) => user?.role === 'admin';
// An account manager is a non-admin who was given team account management; admins manage every account.
export const canManageAccounts = (user) => isAdmin(user) || (user?.manages?.length ?? 0) > 0;
export const isAccountManager = (user) => !isAdmin(user) && canManageAccounts(user);
