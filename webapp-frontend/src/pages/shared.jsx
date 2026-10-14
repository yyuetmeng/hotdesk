import { useCallback, useEffect, useState } from 'react';
import { promptForToken, readAdminToken } from '../api.js';

export const time = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
export const options = (items, valueKey = 'id', labelKey = 'name') => items.map((item) => <option key={item[valueKey]} value={item[valueKey]}>{item[labelKey]}</option>);

export function useAdminData(load) {
  const [token, setToken] = useState(readAdminToken);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const refresh = useCallback(async () => {
    if (!token) { setState({ loading: false, error: new Error('Enter the administrator token to continue.'), data: null }); return; }
    try { setState((old) => ({ ...old, loading: !old.data, error: null })); setState({ loading: false, error: null, data: await load(token) }); }
    catch (error) { setState((old) => ({ ...old, loading: false, error })); }
  }, [load, token]);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...state, token, refresh, askForToken: () => { const next = promptForToken(); if (next) setToken(next); } };
}

export function Kpi({ label, value }) { return <div className="card kpi"><span>{label}</span><b>{value}</b></div>; }
