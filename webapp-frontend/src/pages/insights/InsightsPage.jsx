import { PageTitle } from '../../components.jsx';
import OccupancyCard from './OccupancyCard.jsx';
import ZoneUtilisationCard from './ZoneUtilisationCard.jsx';

// Insights (admins): live utilisation by zone.
export function InsightsPage() {
  return <main className="page"><PageTitle title="Insights"><p>Live seat use by zone, and occupancy over time.</p></PageTitle>
    <div className="insights-grid"><OccupancyCard /><ZoneUtilisationCard /></div></main>;
}
