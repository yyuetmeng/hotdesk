// Helpers for the account manager (non-admin) view of Manage Users.
export const managedLine = (manages) => (manages?.length
  ? `You can manage accounts in: ${manages.map((t) => t.name).join(', ')}.` : '');

// The user's own teams first, then the rest, each group in the given order.
export const teamsOwnFirst = (departments, ownIds) => {
  const own = new Set(ownIds);
  return [...departments.filter((d) => own.has(d.id)), ...departments.filter((d) => !own.has(d.id))];
};

// The fields an account manager may change on someone else's account.
export const HOLDER_EDIT_FIELDS = ['full_name', 'start_date', 'end_date', 'usual_seat_id', 'booking_allowance', 'is_active'];

// Only the editable fields whose value differs from the saved user, normalised as UserForm does.
export const holderChanges = (form, user) => Object.fromEntries(HOLDER_EDIT_FIELDS.flatMap((key) => {
  let value = form[key];
  if (key.endsWith('_date') || key === 'usual_seat_id') value = value || null;
  else if (key === 'booking_allowance') value = Number(value);
  const before = user[key] ?? (key.endsWith('_date') || key === 'usual_seat_id' ? null : '');
  return JSON.stringify(value) !== JSON.stringify(before) ? [[key, value]] : [];
}));

export const errorText = (err) => {
  if (err?.status === 401) return 'Session expired — sign in again.';
  if (err?.status === 403 && err.message === 'admin required') return 'You need an administrator account to manage users.';
  return err?.message;
};
