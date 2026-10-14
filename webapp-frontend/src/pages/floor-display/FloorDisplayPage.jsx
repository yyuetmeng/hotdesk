import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { request } from '../../api.js';
import { useInterval } from '../../hooks.js';
import { Loading, Notice, PageTitle, SeatGrid } from '../../components.jsx';
import { Kpi } from '../shared.jsx';

export function FloorDisplayPage() {
  const params = new URLSearchParams(useLocation().search); const key = params.get('key'); const token = params.get('token');
  const [data, setData] = useState(null); const [message, setMessage] = useState('');
  const refresh = useCallback(async () => { try { const [people, seats] = await Promise.all([request('/api/display/people', { token, displayKey: key }), request('/api/availability')]); setData({ people, seats }); setMessage(''); } catch (error) { setMessage(error.message); } }, [key, token]);
  useEffect(() => { refresh(); }, [refresh]); useInterval(refresh, 5_000);
  return <main className="page display-page"><PageTitle title="Floor display"><p>{data?.people?.building ?? 'Live availability and colleague finder'}</p></PageTitle>{message && <Notice kind="error">{message}</Notice>}{!data ? <Loading /> : <><section className="kpis"><Kpi label="People today" value={data.people.people.length} /><Kpi label="Available desks" value={data.seats.filter((seat) => seat.status === 'available').length} /></section><section className="card"><SeatGrid seats={data.seats} /></section><section className="card"><h2>Colleague finder</h2><table><thead><tr><th>Name</th><th>Project</th><th>Desk</th><th>Status</th></tr></thead><tbody>{data.people.people.map((person) => <tr key={`${person.name}-${person.team}`}><td>{person.name}</td><td>{person.team}</td><td>{person.seats.map((seat) => seat.id).join(', ')}</td><td>{person.status}</td></tr>)}</tbody></table></section></>}</main>;
}
