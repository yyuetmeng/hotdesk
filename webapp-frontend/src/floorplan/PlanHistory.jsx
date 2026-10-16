// Floor plan history pop-up (spec 2026-10-16-audit-views §3): published versions as a stepper (v1 → vN)
// and the plan's changes as a timeline (consecutive saves collapsed).
import { useEffect, useState } from 'react';
import { flaskRequest } from '../api.js';
import { Notice } from '../components.jsx';
import { formatDateTime } from '../format.js';
import AuditTimeline from '../pages/audit/AuditTimeline.jsx';

export default function PlanHistory({ planId, name, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    flaskRequest(`/api/admin/floor-plans/${planId}/history`).then(setData).catch((err) => setError(err.message));
  }, [planId]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="fp-history" role="dialog" aria-modal="true" aria-label={`History of ${name}`} onClick={onClose}>
    <div className="fp-history-frame card" onClick={(e) => e.stopPropagation()}>
      <div className="fp-history-head"><h2>History · {name}</h2><button type="button" className="button" onClick={onClose} autoFocus>Close</button></div>
      {error && <Notice kind="error">{error}</Notice>}
      {data && <>
        <h3>Published versions</h3>
        {!data.versions.length ? <p className="state">Not published yet.</p> : <ol className="fp-versions">
          {data.versions.map((v, i) => <li key={v.version} className={i === data.versions.length - 1 ? 'latest' : ''}>
            <span className="fp-version-dot">v{v.version}</span>
            <div><b>{v.name}</b><small>{formatDateTime(v.published_at)}{v.published_by ? ` · ${v.published_by}` : ''} · {v.elements} elements</small></div>
          </li>)}
        </ol>}
        <h3>Changes</h3>
        <div className="fp-history-events"><AuditTimeline items={data.events} empty="No changes recorded yet." /></div>
      </>}
      {!data && !error && <p className="state">Loading…</p>}
    </div>
  </div>;
}
