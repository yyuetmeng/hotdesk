import { useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Notice } from '../../components.jsx';
import { errorText } from './teamAccess.js';

// Above this many, the admin types "DELETE n" before the button works.
const TYPE_TO_CONFIRM_FROM = 6;
const users = (n) => `${n} user${n === 1 ? '' : 's'}`;
const teams = (u) => u.departments.map((d) => d.name).join(', ');

export function resultText(result, picked) {
  const parts = [`Deleted ${users(result.deleted.length)}.`];
  if (result.skipped.length) {
    const named = result.skipped.map((s) => `${picked.find((u) => u.id === s.id)?.full_name ?? s.id} (${s.reason})`);
    parts.push(`Not deleted: ${named.join(', ')}.`);
  }
  return parts.join(' ');
}

function downloadCsv(picked) {
  const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const rows = [['Full name', 'Username', 'Email', 'Role', 'Project teams'],
    ...picked.map((u) => [u.full_name, u.username, u.email, u.role, teams(u)])];
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = `users-to-delete-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Confirmation for deleting the ticked users (admins only). picked: the user objects, from any page.
export default function BulkDeletePanel({ picked, statusLabel, onCancel, onDone }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const phrase = `DELETE ${picked.length}`;
  const mustType = picked.length >= TYPE_TO_CONFIRM_FROM;

  const remove = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await flaskRequest('/api/admin/users/bulk-delete', { method: 'POST', body: { ids: picked.map((u) => u.id) } });
      await onDone(result);
    } catch (err) { setMessage(errorText(err)); setBusy(false); }
  };

  return <div className="users-bulk-confirm">
    <h3>Delete {users(picked.length)}?</h3>
    <p className="muted">This cannot be undone.</p>
    {message && <Notice kind="error">{message}</Notice>}
    <div className="users-bulk-list">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Project teams</th><th>Status</th></tr></thead>
        <tbody>{picked.map((u) => <tr key={u.id}>
          <td><b>{u.full_name}</b> <small>@{u.username}</small></td><td>{u.email}</td>
          <td>{teams(u) || '—'}</td><td>{statusLabel(u)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="users-bulk-note">Past bookings keep each person&apos;s name. Their booking blocks, project team memberships and sign-in links are removed.</p>
    {mustType && <label>Type <b>{phrase}</b> to confirm
      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={phrase} autoComplete="off" /></label>}
    <div className="users-bulk-buttons">
      <button type="button" className="button" onClick={() => downloadCsv(picked)}>Download list (CSV)</button>
      <span />
      <button type="button" className="button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="button users-danger-solid" disabled={busy || (mustType && typed.trim() !== phrase)} onClick={remove}>
        {busy ? 'Deleting…' : `Delete ${users(picked.length)}`}</button>
    </div>
  </div>;
}
