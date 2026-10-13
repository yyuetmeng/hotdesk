const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export const storage = {
  get(key, fallback = '') {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined || value === '') localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
  },
};

export function apiUrl(path) {
  return `${baseUrl}${path}`;
}

export function appendToken(path, token) {
  if (!token) return apiUrl(path);
  return apiUrl(`${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
}

export async function request(path, { method = 'GET', body, token, displayKey, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (displayKey) headers['x-display-key'] = displayKey;
  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || response.statusText || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function readAdminToken() {
  const supplied = new URLSearchParams(window.location.search).get('token');
  if (supplied) storage.set('hotdesk.token', supplied);
  return supplied || storage.get('hotdesk.token');
}

export function promptForToken() {
  const token = window.prompt('Administrator token');
  if (token) storage.set('hotdesk.token', token);
  return token || '';
}
