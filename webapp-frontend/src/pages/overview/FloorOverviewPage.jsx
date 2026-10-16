// Floor overview (owner 2026-10-16): what a floor display shows, inside the app; tap a seat for its details.
// It renders DisplayView — the same component as the TV (/display/:slug) and the Manage Floor Display
// preview — so the three always show the same thing: a change to one is a change to all.
import { useCallback, useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { DisplayView } from '../../display/DisplayPage.jsx';
import { overviewConfig } from '../../display/displayLogic.js';
import './overview.css';

const ALL = '*all';                       // every published floor, when no display fits
const KEY = 'hotdesk.overviewDisplay';    // the viewer's last choice, on this browser only

const readPick = () => { try { return window.localStorage.getItem(KEY) || ''; } catch { return ''; } };
const savePick = (value) => { try { window.localStorage.setItem(KEY, value); } catch { /* this visit only */ } };

export function FloorOverviewPage() {
  const [choices, setChoices] = useState(null);
  const [pick, setPick] = useState(readPick);
  const [error, setError] = useState(null);
  useEffect(() => {
    flaskRequest('/api/desk/displays').then((d) => setChoices(d.items)).catch((err) => setError(err.message));
  }, []);

  const slug = choices ? (pick === ALL || choices.some((c) => c.slug === pick) ? pick : choices[0]?.slug ?? ALL) : null;
  const load = useCallback(async () => (slug === ALL
    ? overviewConfig((await flaskRequest('/api/public/floors')).items)
    : flaskRequest(`/api/public/displays/${encodeURIComponent(slug)}`)), [slug]);
  const choose = (value) => { setPick(value); savePick(value); };

  const title = <PageTitle title="Floor overview"><p>What the floor displays show, live. Tap a seat to see who is there and today&apos;s activity.</p></PageTitle>;
  if (error) return <main className="page">{title}<Notice kind="error">{error}</Notice></main>;
  if (!choices) return <main className="page">{title}<Loading label="Loading the floor overview..." /></main>;
  return <main className="page overview">
    {title}
    <div className="toolbar overview-toolbar">
      <label>Display <select value={slug} onChange={(e) => choose(e.target.value)}>
        {choices.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        <option value={ALL}>All floors</option>
      </select></label>
    </div>
    <div className="overview-body"><DisplayView key={slug} loadConfig={load} /></div>
  </main>;
}
