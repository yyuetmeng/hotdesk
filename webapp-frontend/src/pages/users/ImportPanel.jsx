// Bulk import from the Excel template (owner 2026-10-16): download the template, fill it in, choose the file,
// check it (a preview row by row; nothing is saved), then import. Rows with errors are left out and listed;
// rows whose email already exists are skipped, so uploading a fixed file again is safe.
import { useState } from 'react';
import { apiUrl, readFlaskToken } from '../../api.js';
import { Notice } from '../../components.jsx';
import { downloadFile } from '../../download.js';
import { importLabel, resultText, statusLabel } from './importLogic.js';

const SETUP = {
  users: { title: 'Import users', template: '/api/admin/users/import-template.xlsx', file: 'users-template.xlsx', url: '/api/admin/users/import' },
  teams: { title: 'Import project teams', template: '/api/admin/departments/import-template.xlsx', file: 'project-teams-template.xlsx', url: '/api/admin/departments/import' },
};

async function upload(url, file, options) {
  const form = new FormData();
  form.append('file', file);
  Object.entries(options).forEach(([k, v]) => { if (v) form.append(k, '1'); });
  const res = await fetch(apiUrl(url), { method: 'POST', body: form, headers: { authorization: `Bearer ${readFlaskToken()}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The file could not be read.');
  return data;
}

export default function ImportPanel({ kind, onClose, onDone }) {
  const setup = SETUP[kind];
  const [file, setFile] = useState(null);
  const [createTeams, setCreateTeams] = useState(false);
  const [invite, setInvite] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const options = kind === 'users' ? { create_teams: createTeams, send_invitations: invite } : {};

  const run = async (label, fn) => { setBusy(label); setError(null); try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(''); } };
  const check = () => run('check', async () => setPreview(await upload(setup.url, file, { ...options, dry_run: true })));
  const doImport = () => run('import', async () => {
    const done = await upload(setup.url, file, options);
    setPreview(done);
    onDone(resultText(kind, done.imported, done.summary));
  });
  const changed = (fn) => (e) => { fn(e); setPreview(null); };
  const canImport = preview && (preview.summary.create || preview.summary.update);

  return <section className="card users-import">
    <div className="users-import-head"><h2>{setup.title}</h2><button type="button" className="button" onClick={onClose}>Close</button></div>
    <ol className="users-import-steps">
      <li><button type="button" className="button" disabled={busy === 'template'}
        onClick={() => run('template', () => downloadFile(setup.template, setup.file))}>Download the Excel template</button>
        <span className="muted"> The Instructions sheet explains each column{kind === 'users' ? ' and lists the project teams' : ''}.</span></li>
      <li>Fill it in, then choose the file: <input type="file" accept=".xlsx,.csv" onChange={changed((e) => setFile(e.target.files?.[0] ?? null))} /></li>
      {kind === 'users' && <li className="users-import-options">
        <label><input type="checkbox" checked={createTeams} onChange={changed((e) => setCreateTeams(e.target.checked))} />Create missing project teams</label>
        <label><input type="checkbox" checked={invite} onChange={changed((e) => setInvite(e.target.checked))} />Send invitation emails to new users</label>
      </li>}
      <li><button type="button" className="button primary" disabled={!file || Boolean(busy)} onClick={check}>{busy === 'check' ? 'Checking…' : 'Check file'}</button>
        <span className="muted"> Shows what will happen; nothing is saved yet.</span></li>
    </ol>
    {error && <Notice kind="error">{error}</Notice>}
    {preview && <>
      <p className="users-import-summary">
        <b>{preview.summary.create}</b> new{preview.summary.update !== undefined && <> · <b>{preview.summary.update}</b> to add to</>} · <b>{preview.summary.skip}</b> skipped · <b className={preview.summary.error ? 'users-import-bad' : ''}>{preview.summary.error}</b> with errors
        {preview.imported > 0 && <> — <b>imported {preview.imported}</b></>}
      </p>
      <div className="users-table-wrap"><table className="users-import-table">
        <thead><tr><th>Row</th><th>Status</th>{kind === 'users'
          ? <><th>Name</th><th>Email</th><th>Username</th><th>Role</th><th>Project teams</th></>
          : <><th>Project team</th><th>Members to add</th></>}<th>Notes</th></tr></thead>
        <tbody>{preview.rows.map((r) => <tr key={r.row} className={`imp-${r.status}`}>
          <td>{r.row}</td><td><span className={`users-import-pill imp-${r.status}`}>{statusLabel(r.status)}</span></td>
          {kind === 'users'
            ? <><td>{r.full_name}</td><td>{r.email}</td><td>{r.username}</td><td>{r.role}</td><td>{r.teams.join(', ') || '—'}</td></>
            : <><td>{r.team}</td><td>{r.members.join(', ') || '—'}</td></>}
          <td>{r.messages.join(' ')}</td>
        </tr>)}</tbody>
      </table></div>
      {!preview.imported && <div className="button-row">
        <button type="button" className="button primary" disabled={!canImport || Boolean(busy)} onClick={doImport}>
          {busy === 'import' ? 'Importing…' : importLabel(kind, preview.summary)}</button>
        {preview.summary.error > 0 && <span className="muted">Rows with errors are left out. Fix them in the file and import it again later.</span>}
      </div>}
    </>}
  </section>;
}
