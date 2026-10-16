// Pop-up with the line data behind a Project teams row: today's check-ins, one line each (the same lines as
// sheet 2 of the Excel export). team: a project team id, "none", or null for everyone.
import { useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Notice } from '../../components.jsx';

const COLUMNS = [['person', 'Person'], ['username', 'Username'], ['teams', 'Project teams'], ['seat', 'Seat'], ['floor', 'Floor'],
  ['zone', 'Zone'], ['method', 'Method'], ['checked_in', 'Checked in'], ['checked_out', 'Checked out'], ['ended', 'Ended']];

export default function TeamLinesModal({ team, title, onClose }) {
  const [lines, setLines] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const query = team ? `?team=${encodeURIComponent(team)}` : '';
    flaskRequest(`/api/admin/insights/teams/lines${query}`).then((d) => setLines(d.items)).catch((err) => setError(err.message));
  }, [team]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <div className="lines-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
    <div className="lines-frame card" onClick={(e) => e.stopPropagation()}>
      <div className="lines-head">
        <div><h2>{title}</h2><p className="occ-sub">Today&apos;s check-ins, one line each (as in the Excel export).</p></div>
        <button type="button" className="button" onClick={onClose} autoFocus>Close</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!lines ? <p className="state">Loading…</p>
        : !lines.length ? <p className="state">No check-ins today.</p>
          : <div className="lines-wrap"><table className="lines-table">
            <thead><tr>{COLUMNS.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{lines.map((l, i) => <tr key={i}>{COLUMNS.map(([key]) => <td key={key}>{l[key] || '—'}</td>)}</tr>)}</tbody>
          </table></div>}
    </div>
  </div>;
}
