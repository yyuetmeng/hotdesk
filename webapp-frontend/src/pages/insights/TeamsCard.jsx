// Insights "Project teams": who is in now, and today's check-ins and check-outs per project team,
// with an Excel export built on the server (sheet 1: this table; sheet 2: one line per check-in).
import { useEffect, useState } from 'react';
import { apiUrl, flaskRequest, readFlaskToken } from '../../api.js';
import { Notice } from '../../components.jsx';
import { peopleText } from './activityLogic.js';

const REFRESH_MS = 30000;

async function downloadExcel() {
  const res = await fetch(apiUrl('/api/admin/insights/teams.xlsx'), { headers: { authorization: `Bearer ${readFlaskToken()}` } });
  if (!res.ok) throw new Error(res.status === 403 ? 'Administrators only.' : 'The export could not be made.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'project-teams.xlsx';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TeamsCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => flaskRequest('/api/admin/insights/teams')
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((err) => { if (alive) setError(err.message); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const exportExcel = async () => {
    setBusy(true);
    try { await downloadExcel(); setError(null); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return <section className="card teams-card">
    <div className="occ-head">
      <div><h2>Project teams</h2><p className="occ-sub">Who is in now, and today&apos;s check-ins and check-outs.</p></div>
      <button className="button teams-export" onClick={exportExcel} disabled={busy || !data}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" /></svg>
        {busy ? 'Exporting…' : 'Excel'}</button>
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    {!data ? <p className="state">Loading project teams…</p> : <div className="teams-table-wrap"><table className="teams-table">
      <thead><tr><th>Project team</th><th className="num">In now</th><th className="num">Check-ins</th><th className="num">Check-outs</th><th>People</th></tr></thead>
      <tbody>{data.rows.map((r) => <tr key={r.team_id ?? 'none'}>
        <td>{r.name}</td><td className="num">{r.in_now}</td><td className="num">{r.check_ins}</td><td className="num">{r.check_outs}</td>
        <td className="teams-people" title={r.people.join(', ')}>{peopleText(r.people)}</td>
      </tr>)}</tbody>
      <tfoot><tr><th>Total</th><th className="num">{data.total.in_now}</th><th className="num">{data.total.check_ins}</th>
        <th className="num">{data.total.check_outs}</th><th className="teams-people">{data.total.people} {data.total.people === 1 ? 'person' : 'people'}</th></tr></tfoot>
    </table></div>}
  </section>;
}
