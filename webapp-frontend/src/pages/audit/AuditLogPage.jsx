// Administration → Audit log (spec 2026-10-16-audit-views §1): every audit entry, filterable by category,
// person/text, and dates, with readable summaries, expandable details and an Excel export.
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { downloadFile } from '../../download.js';
import { CATEGORIES, auditQuery, categoryOf, relativeTime } from './auditLogic.js';
import './audit.css';

const exact = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export function AuditLogPage() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ category: params.get('category') || '', q: params.get('q') || '', from: params.get('from') || '', to: params.get('to') || '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      flaskRequest(`/api/admin/audit?${auditQuery({ ...filters, page })}`)
        .then((d) => { if (alive) { setData(d); setError(null); } })
        .catch((err) => { if (alive) setError(err.message); });
    }, filters.q ? 300 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [filters, page]);

  const set = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const exportExcel = async () => {
    setBusy(true);
    try { await downloadFile(`/api/admin/audit.xlsx?${auditQuery(filters)}`, 'audit-log.xlsx'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const title = <PageTitle title="Audit Log"><p>Who did what, and when: sign-ins, user and team changes, floor plans, displays, bookings and exports.</p></PageTitle>;
  if (!data && !error) return <main className="page">{title}<Loading label="Loading the audit log..." /></main>;
  const pages = data ? Math.max(Math.ceil(data.total / data.page_size), 1) : 1;
  return <main className="page">
    {title}
    {error && <Notice kind="error">{error}</Notice>}
    {data && <>
      <div className="audit-chips" role="radiogroup" aria-label="Category">
        <button type="button" role="radio" aria-checked={!filters.category} className={!filters.category ? 'active' : ''}
          onClick={() => set('category', '')}>All <b>{Object.values(data.counts).reduce((a, b) => a + b, 0)}</b></button>
        {CATEGORIES.map((c) => <button key={c.key} type="button" role="radio" aria-checked={filters.category === c.key}
          className={`tone-${c.tone}${filters.category === c.key ? ' active' : ''}`} onClick={() => set('category', c.key)}>
          {c.label} <b>{data.counts[c.key] ?? 0}</b></button>)}
      </div>
      <section className="card toolbar audit-filters">
        <label>Search <input type="search" placeholder="Person, action or detail" value={filters.q} onChange={(e) => set('q', e.target.value)} /></label>
        <label>From <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label>To <input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} /></label>
        <span className="fp-spacer" />
        <button className="button" onClick={exportExcel} disabled={busy}>{busy ? 'Exporting…' : 'Excel'}</button>
      </section>
      <section className="card">
        {!data.items.length ? <p className="state">No entries match these filters.</p> : <table className="audit-table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Category</th><th /></tr></thead>
          <tbody>{data.items.map((e) => <Fragment key={e.id}>
            <tr className={e.action === 'auth.login_failed' || e.action === 'account.locked' ? 'alert' : ''}>
              <td title={exact(e.at)}><b>{relativeTime(e.at)}</b><small>{exact(e.at)}</small></td>
              <td>{e.actor_name || (e.actor_id ? 'Deleted user' : 'System')}</td>
              <td>{e.summary}</td>
              <td><span className={`audit-pill tone-${categoryOf(e.category).tone}`}>{categoryOf(e.category).label}</span></td>
              <td><button type="button" className="button subtle" aria-expanded={open === e.id}
                onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Details'}</button></td>
            </tr>
            {open === e.id && <tr className="audit-details"><td colSpan={5}>
              <dl>
                <div><dt>Action</dt><dd><code>{e.action}</code></dd></div>
                {e.target_name && <div><dt>Target</dt><dd>{e.target_name}</dd></div>}
                {Object.entries(e.details).map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt>
                  <dd>{Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</dd></div>)}
              </dl>
            </td></tr>}
          </Fragment>)}</tbody>
        </table>}
        {pages > 1 && <div className="audit-pager">
          <button className="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</button>
          <span>Page {page} of {pages} · {data.total} entries</span>
          <button className="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older</button>
        </div>}
      </section>
    </>}
  </main>;
}
