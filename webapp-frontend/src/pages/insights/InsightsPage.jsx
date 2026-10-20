import { PageTitle } from '../../components.jsx';
import ActivityCard from './ActivityCard.jsx';
import FunnelCard from './FunnelCard.jsx';
import OccupancyCard from './OccupancyCard.jsx';
import SeatAssignmentsEndingCard from './SeatAssignmentsEndingCard.jsx';
import TeamsCard from './TeamsCard.jsx';
import ZoneUtilisationCard from './ZoneUtilisationCard.jsx';

// Insights (admins): project teams + recent activity, then occupancy, utilisation by zone and seat assignments ending.
export function InsightsPage() {
  return <main className="page"><PageTitle title="Insights"><p>Project teams today, recent activity, occupancy over time, live seat use by zone and seat assignments ending.</p></PageTitle>
    <div className="insights-grid insights-top"><TeamsCard /><ActivityCard /></div>
    <div className="insights-funnel"><FunnelCard /></div>
    <div className="insights-grid"><OccupancyCard /><ZoneUtilisationCard /></div>
    <div className="insights-ending"><SeatAssignmentsEndingCard /></div></main>;
}
