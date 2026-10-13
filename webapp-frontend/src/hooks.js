import { useEffect, useState } from 'react';
import { apiUrl, storage } from './api.js';

export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => storage.get(key, initial));
  const setAndStore = (next) => {
    const resolved = typeof next === 'function' ? next(value) : next;
    setValue(resolved);
    storage.set(key, resolved);
  };
  return [value, setAndStore];
}

export function useInterval(callback, ms) {
  useEffect(() => {
    if (!ms) return undefined;
    const id = window.setInterval(callback, ms);
    return () => window.clearInterval(id);
  }, [callback, ms]);
}

export function useTheme() {
  const [theme, setTheme] = useStoredState('hotdesk.theme', 'system');
  useEffect(() => {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  return [theme, setTheme];
}

export function useStateEvents(token, onInvalidate) {
  useEffect(() => {
    if (!token) return undefined;
    const path = `/api/stream?token=${encodeURIComponent(token)}`;
    const source = new EventSource(apiUrl(path));
    const refresh = () => onInvalidate();
    source.addEventListener('snapshot', refresh);
    source.addEventListener('seat', refresh);
    source.addEventListener('projects', refresh);
    return () => source.close();
  }, [token, onInvalidate]);
}
