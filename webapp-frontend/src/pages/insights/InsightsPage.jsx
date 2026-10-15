import { PageTitle } from '../../components.jsx';
import ZoneUtilisationCard from './ZoneUtilisationCard.jsx';

// Insights (admins): live utilisation by zone.
export function InsightsPage() {
  return <main className="page"><PageTitle title="Insights"><p>Live seat use by zone.</p></PageTitle><ZoneUtilisationCard /></main>;
}
