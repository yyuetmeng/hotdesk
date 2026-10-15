// Where the sign-in token lives. Normally this tab only (sessionStorage); with "Keep me signed in
// on this device" it is kept in localStorage so new tabs (e.g. a desk QR scan) stay signed in until
// the 5-day token expires. Storage access can throw (private mode, blocked site data): never fatal.

export const AUTH_TOKEN_KEY = 'hotdesk.auth.token';

const get = (store) => { try { return store?.getItem(AUTH_TOKEN_KEY) || ''; } catch { return ''; } };
const set = (store, value) => { try { store?.setItem(AUTH_TOKEN_KEY, value); } catch { /* memory only */ } };
const remove = (store) => { try { store?.removeItem(AUTH_TOKEN_KEY); } catch { /* nothing stored */ } };

export const browserStores = () => ({
  session: typeof sessionStorage === 'undefined' ? null : sessionStorage,
  local: typeof localStorage === 'undefined' ? null : localStorage,
});

/** The current token: this tab's sign-in first, then a kept one. */
export const readToken = (stores = browserStores()) => get(stores.session) || get(stores.local);

export function writeToken(stores, token, keep) {
  remove(keep ? stores.session : stores.local);
  set(keep ? stores.local : stores.session, token);
}

export function clearToken(stores = browserStores()) {
  remove(stores.session);
  remove(stores.local);
}
