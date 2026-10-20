// Upload Users from the Excel template (owner 2026-10-16): download the template (row 2 is a sample, Andy Lau,
// which upload ignores), fill it in, choose the file, check it (a row-by-row preview; nothing
// is saved), then upload. Rows with errors are left out and listed; rows whose email already exists are skipped,
// so uploading a fixed file again is safe. Project teams come from each row's "Project teams" column.
// holder: an account manager's upload. Teams must be ones they manage, and new users always get an invitation
// (the server refuses "Create missing project teams" and a default password from them with a 403, and always sends
// invitations whatever the checkbox says), so those options are hidden and never sent.
import { useState } from 'react';
import { apiUrl, readFlaskToken } from '../../api.js';
import { Notice } from '../../components.jsx';
import { downloadFile } from '../../download.js';
import { PasswordStrength, usePasswordCheck } from '../../PasswordStrength.jsx';
import { importLabel, resultText, statusLabel } from './importLogic.js';

const UPLOAD_URL = '/api/admin/users/import';

async function upload(file, options) {
  const form = new FormData();
  form.append('file', file);
  Object.entries(options).forEach(([k, v]) => { if (v === true) form.append(k, '1'); else if (v) form.append(k, v); });
  const res = await fetch(apiUrl(UPLOAD_URL), { method: 'POST', body: form, headers: { authorization: `Bearer ${readFlaskToken()}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The file could not be read.');
  return data;
}

export default function ImportPanel({ holder = false, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [createTeams, setCreateTeams] = useState(false);
  const [invite, setInvite] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const options = holder ? {}
    : { create_teams: createTeams, send_invitations: invite, default_password: usePassword ? password : '' };
  const passwordCheck = usePasswordCheck(password);
  const passwordProblem = !holder && usePassword && !passwordCheck.ok ? 'The default password does not meet the password rules.' : '';

  const run = async (label, fn) => { setBusy(label); setError(null); try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(''); } };
  const check = () => run('check', async () => setPreview(await upload(file, { ...options, dry_run: true })));
  const doUpload = () => run('upload', async () => {
    const done = await upload(file, options);
    setPreview(done);
    onDone(resultText(done.imported, done.summary));
  });
  const changed = (fn) => (e) => { fn(e); setPreview(null); };

  return <section className="card users-import">
    <div className="users-import-head"><h2>Upload users</h2><button type="button" className="button" onClick={onClose}>Close</button></div>
    <ol className="users-import-steps">
      <li><button type="button" className="button" disabled={busy === 'template'}
        onClick={() => run('template', () => downloadFile('/api/admin/users/import-template.xlsx', 'users-template.xlsx'))}>Download the Excel template</button>
        <span className="muted"> Row 2 (Andy Lau) is a sample and is ignored on upload. Everyone uploaded is a normal user. The Instructions sheet explains each column and lists the project teams.</span></li>
      <li>Fill it in, then choose the file: <input type="file" accept=".xlsx,.csv" onChange={changed((e) => setFile(e.target.files?.[0] ?? null))} /></li>
      {holder
        ? <li>New users get an invitation email to set their password.</li>
        : <li className="users-import-options">
        <label><input type="checkbox" checked={createTeams} onChange={changed((e) => setCreateTeams(e.target.checked))} />Create missing project teams</label>
        <label><input type="checkbox" checked={invite} onChange={changed((e) => setInvite(e.target.checked))} />Send invitation emails to new users</label>
        <label><input type="checkbox" checked={usePassword} onChange={changed((e) => setUsePassword(e.target.checked))} />Set a default password</label>
        {usePassword && <label className="users-import-password">Default password
          <input type="text" value={password} autoComplete="new-password" placeholder="8+ characters, letters and numbers"
            onChange={changed((e) => setPassword(e.target.value))} /></label>}
        {usePassword && <PasswordStrength check={passwordCheck} />}
        {usePassword && <small className="muted">Every new user can sign in with this password straight away; ask them to change it in My account.</small>}
      </li>}
      <li><button type="button" className="button primary" disabled={!file || Boolean(busy) || Boolean(passwordProblem)} onClick={check}>{busy === 'check' ? 'Checking…' : 'Check file'}</button>
        <span className="muted"> Shows what will happen; nothing is saved yet.</span>
        {passwordProblem && <small className="users-import-bad"> {passwordProblem}</small>}</li>
    </ol>
    {error && <Notice kind="error">{error}</Notice>}
    {preview && <>
      <p className="users-import-summary">
        <b>{preview.summary.create}</b> new · <b>{preview.summary.skip}</b> skipped · <b className={preview.summary.error ? 'users-import-bad' : ''}>{preview.summary.error}</b> with errors
        {preview.imported > 0 && <> — <b>uploaded {preview.imported}</b></>}
      </p>
      <div className="users-table-wrap"><table className="users-import-table">
        <thead><tr><th>Row</th><th>Status</th><th>Name</th><th>Email</th><th>Username</th><th>Project teams</th><th>Notes</th></tr></thead>
        <tbody>{preview.rows.map((r) => <tr key={r.row} className={`imp-${r.status}`}>
          <td>{r.row}</td><td><span className={`users-import-pill imp-${r.status}`}>{statusLabel(r.status)}</span></td>
          <td>{r.full_name}</td><td>{r.email}</td><td>{r.username}</td><td>{r.teams.join(', ') || '—'}</td>
          <td>{r.messages.join(' ')}</td>
        </tr>)}</tbody>
      </table></div>
      {!preview.imported && <div className="button-row">
        <button type="button" className="button primary" disabled={!preview.summary.create || Boolean(busy) || Boolean(passwordProblem)} onClick={doUpload}>
          {busy === 'upload' ? 'Uploading…' : importLabel(preview.summary)}</button>
        {preview.summary.error > 0 && <span className="muted">Rows with errors are left out. Fix them in the file and upload it again later.</span>}
      </div>}
    </>}
  </section>;
}
