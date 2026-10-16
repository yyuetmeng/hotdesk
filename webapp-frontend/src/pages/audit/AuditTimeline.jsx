// A vertical timeline of audit entries (user History tab, floor plan history, team changes).
import { categoryOf, relativeTime } from './auditLogic.js';
import './audit.css';

const exact = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export default function AuditTimeline({ items, empty = 'Nothing recorded yet.' }) {
  if (!items) return <p className="state">Loading…</p>;
  if (!items.length) return <p className="state">{empty}</p>;
  return <ol className="audit-timeline">
    {items.map((e) => <li key={e.id} className={`tone-${categoryOf(e.category).tone}${e.action === 'auth.login_failed' || e.action === 'account.locked' ? ' alert' : ''}`}>
      <span className="audit-dot" aria-hidden="true" />
      <div><p>{e.summary}</p><time dateTime={e.at} title={exact(e.at)}>{relativeTime(e.at)} · {exact(e.at)}</time></div>
    </li>)}
  </ol>;
}
