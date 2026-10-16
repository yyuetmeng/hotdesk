import { PageTitle } from '../../components.jsx';
import ActivityCard from './ActivityCard.jsx';
import FunnelCard from './FunnelCard.jsx';
import OccupancyCard from './OccupancyCard.jsx';
import TeamsCard from './TeamsCard.jsx';
import ZoneUtilisationCard from './ZoneUtilisationCard.jsx';

// Insights (admins): project teams + recent activity, then occupancy + utilisation by zone.
export function InsightsPage() {
  return <main className="page"><PageTitle title="Insights"><p>Project teams today, recent activity, occupancy over time and live seat use by zone.</p></PageTitle>
    <div className="insights-grid insights-top"><TeamsCard /><ActivityCard /></div>
    <div className="insights-funnel"><FunnelCard /></div>
    <div className="insights-grid"><OccupancyCard /><ZoneUtilisationCard /></div></main>;
}
