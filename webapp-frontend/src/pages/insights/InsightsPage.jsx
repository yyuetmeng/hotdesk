import { useCallback } from 'react';
import { request } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { Kpi, useAdminData } from '../shared.jsx';
import ZoneUtilisationCard from './ZoneUtilisationCard.jsx';

// Insights: live utilisation by zone (signed-in admins), then the simulated capacity planning view,
// which keeps its own administrator token.
function PlanningSection() {
  const load = useCallback((token) => request('/api/insights', { token }), []); const { loading, error, data, askForToken } = useAdminData(load);
  if (error) return <section className="card"><h2>Capacity and demand planning</h2><Notice kind="error">{error.message}</Notice><button className="button primary" onClick={askForToken}>Enter administrator token</button></section>;
  if (loading || !data) return <Loading />;
  const office = data.series.office;
  return <><h2>Capacity and demand planning</h2><p className="state">Simulated planning data. It does not affect live check-ins or reservations.</p><Notice>This view uses simulated demand and forecasts, not the live occupancy stream.</Notice><section className="kpis"><Kpi label="Seats" value={office?.seats ?? '—'} /><Kpi label="Planning threshold" value={`${Math.round(data.threshold * 100)}%`} /><Kpi label="Forecast horizon" value={`${data.horizonDays} days`} /></section><section className="card"><h2>Available planning scopes</h2><table><thead><tr><th>Area</th><th>Seats</th><th>Forecast points</th></tr></thead><tbody>{Object.entries(data.series).map(([id, series]) => <tr key={id}><td>{series.label}</td><td>{series.seats}</td><td>{series.forecast.length}</td></tr>)}</tbody></table></section></>;
}

export function InsightsPage() {
  return <main className="page"><PageTitle title="Insights"><p>Live seat use by zone, and capacity planning.</p></PageTitle><ZoneUtilisationCard /><PlanningSection /></main>;
}
