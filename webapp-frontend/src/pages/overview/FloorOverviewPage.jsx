// Floor overview (owner 2026-10-16): what a floor display shows, inside the app; tap a seat for its details.
// It renders DisplayView — the same component as the TV (/display/:slug) and the Manage Floor Display
// preview — so the three always show the same thing: a change to one is a change to all.
// The picker in the banner offers All floors, each display and each single floor — published ones only.
import { useCallback, useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { DisplayView } from '../../display/DisplayPage.jsx';
import { overviewConfig, overviewOptions, resolvePick } from '../../display/displayLogic.js';
import './overview.css';

const KEY = 'hotdesk.overviewDisplay';    // the viewer's last choice, on this browser only

const readPick = () => { try { return window.localStorage.getItem(KEY) || ''; } catch { return ''; } };
const savePick = (value) => { try { window.localStorage.setItem(KEY, value); } catch { /* this visit only */ } };

export function FloorOverviewPage() {
  const [lists, setLists] = useState(null);   // { displays, floors }
  const [pick, setPick] = useState(readPick);
  const [error, setError] = useState(null);
  useEffect(() => {
    Promise.all([flaskRequest('/api/desk/displays'), flaskRequest('/api/public/floors')])
      .then(([d, f]) => setLists({ displays: d.items, floors: f.items })).catch((err) => setError(err.message));
  }, []);

  const options = lists ? overviewOptions(lists.displays, lists.floors) : null;
  const value = options ? resolvePick(pick, options) : null;
  const load = useCallback(async () => {
    const floors = (await flaskRequest('/api/public/floors')).items;   // fresh each refresh: published floors only
    if (value.startsWith('d:')) return flaskRequest(`/api/public/displays/${encodeURIComponent(value.slice(2))}`);
    if (value.startsWith('f:')) {
      const floor = floors.filter((f) => f.id === value.slice(2));
      return overviewConfig(floor, floor[0]?.name ?? 'Floor');
    }
    return overviewConfig(floors);
  }, [value]);
  const choose = (next) => { setPick(next); savePick(next); };

  const title = <PageTitle title="Floor overview"><p>What the floor displays show, live. Tap a seat to see who is there and today&apos;s activity.</p></PageTitle>;
  if (error) return <main className="page">{title}<Notice kind="error">{error}</Notice></main>;
  if (!options) return <main className="page">{title}<Loading label="Loading the floor overview..." /></main>;
  return <main className="page overview">
    {title}
    <div className="overview-body"><DisplayView key={value} loadConfig={load} heading={
      <select className="overview-picker" value={value} onChange={(e) => choose(e.target.value)} aria-label="Show">
        <option value={options.all.value}>{options.all.label}</option>
        {options.displays.length > 0 && <optgroup label="Floor displays">
          {options.displays.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
        {options.floors.length > 0 && <optgroup label="Floors">
          {options.floors.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
      </select>} /></div>
  </main>;
}
