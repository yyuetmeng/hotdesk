import { useCallback } from 'react';
import { request } from '../../api.js';
import { AdminGate, Loading, Notice, PageTitle } from '../../components.jsx';
import { Kpi, useAdminData } from '../shared.jsx';

export function InsightsPage() {
  const load = useCallback((token) => request('/api/insights', { token }), []); const { loading, error, data, askForToken } = useAdminData(load);
  if (error) return <AdminGate error={error} onRetry={askForToken} />; if (loading || !data) return <main className="page"><Loading /></main>;
  const office = data.series.office;
  return <main className="page"><PageTitle title="Capacity and demand planning"><p>Simulated planning data. It does not affect live check-ins or reservations.</p></PageTitle><Notice>This view uses simulated demand and forecasts, not the live occupancy stream.</Notice><section className="kpis"><Kpi label="Seats" value={office?.seats ?? '—'} /><Kpi label="Planning threshold" value={`${Math.round(data.threshold * 100)}%`} /><Kpi label="Forecast horizon" value={`${data.horizonDays} days`} /></section><section className="card"><h2>Available planning scopes</h2><table><thead><tr><th>Area</th><th>Seats</th><th>Forecast points</th></tr></thead><tbody>{Object.entries(data.series).map(([id, series]) => <tr key={id}><td>{series.label}</td><td>{series.seats}</td><td>{series.forecast.length}</td></tr>)}</tbody></table></section></main>;
}
