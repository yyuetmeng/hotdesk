import { PasswordStrength, usePasswordCheck } from '../../PasswordStrength.jsx';
import ImportPanel from './ImportPanel.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { formatDate } from '../../format.js';
import { useAuth } from '../../auth.jsx';
import './users.css';
import { seatGroups, seatName } from './usualSeat.js';
import AuditTimeline from '../audit/AuditTimeline.jsx';
import { relativeTime } from '../audit/auditLogic.js';
import { isAccountManager } from '../../roles.js';
import { errorText, holderChanges, managedLine, teamsOwnFirst } from './teamAccess.js';
import { departmentColor } from '../../floorplan/selection.js';

const PAGE_SIZE = 20;
const EMPTY_FORM = { email: '', username: '', full_name: '', role: 'user', start_date: '', end_date: '',
  department_ids: [], is_active: true };

const STATUS = {
  active: ['Active', 'status-available'],
  disabled: ['Disabled', 'status-offline'],
  pending_activation: ['Pending activation', 'status-away'],
};

function statusOf(user) {
  if (user.status === 'pending_activation') return 'pending_activation';
  return user.is_active ? 'active' : 'disabled';
}

export function UsersPage() {
  const { user: me } = useAuth();
  // An account manager sees only the people in the teams they manage, and none of the admin-only parts.
  const holder = isAccountManager(me);
  const [filters, setFilters] = useState({ q: '', role: '', status: '', department: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [adminDepartments, setDepartments] = useState([]);
  // An account manager can't fetch /api/admin/departments; their teams are the ones they manage.
  const departments = holder ? (me.manages ?? []) : adminDepartments;
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | user object

  const loadUsers = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try { setData(await flaskRequest(`/api/admin/users?${params}`)); setError(null); }
    catch (err) { setError(errorText(err)); }
  }, [filters, page]);

  const loadDepartments = useCallback(async () => {
    if (holder) return;
    try { setDepartments((await flaskRequest('/api/admin/departments')).items); }
    catch (err) { setError(errorText(err)); }
  }, [holder]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadDepartments(); }, [loadDepartments]);
  // Seats of published floors, for the Usual seat picker and the seat shown under each name.
  const [floors, setFloors] = useState([]);
  useEffect(() => {
    flaskRequest('/api/public/floors')
      .then((d) => Promise.all(d.items.map((f) => flaskRequest(`/api/public/floors/${f.id}`))))
      .then(setFloors).catch(() => setFloors([]));
  }, []);

  const setFilter = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1); };
  const [changes, setChanges] = useState(0);   // bumps after every change so the health strip reloads too
  const [importing, setImporting] = useState(false);   // the Upload Users panel
  const afterChange = async (message, kind = 'success') => {
    setNotice({ kind, message });
    await Promise.all([loadUsers(), loadDepartments()]);
    setChanges((n) => n + 1);
  };

  const title = holder
    ? <PageTitle title="Manage Users"><p>{managedLine(me.manages)}</p></PageTitle>
    : <PageTitle title="Manage Users / Project Teams"><p>Invite people, set their role and project teams, and control access.</p></PageTitle>;
  if (error && !data) return <main className="page">{title}<Notice kind="error">{error}</Notice></main>;
  if (!data) return <main className="page">{title}<Loading label="Loading users..." /></main>;

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  return <main className="page">
    {title}
    {error && <Notice kind="error">{error}</Notice>}
    {notice && <Notice kind={notice.kind}>{notice.message}</Notice>}
    {!holder && <SecurityStrip refreshKey={changes} onFilter={(status) => setFilter('status', status)} />}
    {importing && <ImportPanel holder={holder} onClose={() => setImporting(false)} onDone={(message) => afterChange(message)} />}

    <div className="content-split users-layout">
      <section className="card">
        <div className="toolbar">
          <label>Search <input type="search" placeholder="Name, username or email" value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)} /></label>
          {!holder && <label>Role <select value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
            <option value="">All</option><option value="user">User</option><option value="admin">Admin</option>
          </select></label>}
          <label>Status <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All</option><option value="active">Active</option><option value="inactive">Disabled</option>
            <option value="locked">Locked</option><option value="pending">Not activated</option>
          </select></label>
          <label>Project team <select value={filters.department} onChange={(e) => setFilter('department', e.target.value)}>
            <option value="">All</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
          <button className="button primary" onClick={() => { setNotice(null); setEditing('new'); }}>New user</button>
          <button className="button" onClick={() => { setNotice(null); setImporting(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Upload Users</button>
        </div>

        <div className="users-table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Project teams</th><th>Access</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((u) => {
              const [label, cls] = STATUS[statusOf(u)];
              return <tr key={u.id} className={`users-row${editing?.id === u.id ? ' selected' : ''}`}
                onClick={() => { setNotice(null); setEditing(u); }}>
                <td><b>{u.full_name}</b><small>@{u.username}{seatName(floors, u.usual_seat_id) ? ` · seat ${seatName(floors, u.usual_seat_id)}` : ''}</small>
                  <span className="users-badges">
                    <small>{u.last_login_at ? `Last sign-in ${relativeTime(u.last_login_at)}` : 'Never signed in'}</small>
                    {u.locked && <span className="users-badge red">Locked</span>}
                    {u.failed_logins_7d > 0 && <span className="users-badge amber">{u.failed_logins_7d} failed sign-in{u.failed_logins_7d === 1 ? '' : 's'} (7 days)</span>}
                    {!holder && u.manages?.length > 0 && <span className="users-badge manages" title={u.manages.map((d) => d.name).join(', ')}>Manages accounts</span>}
                  </span></td>
                <td>{u.email}</td>
                <td className="users-role">{u.role}</td>
                <td>{u.departments.map((d) => d.name).join(', ') || '—'}</td>
                <td>{u.start_date || u.end_date
                  ? `${u.start_date ? formatDate(u.start_date) : 'Any time'} – ${u.end_date ? formatDate(u.end_date) : 'No end'}`
                  : 'Always'}</td>
                <td><span className={`status ${cls}`}>{label}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {!data.items.length && <p className="state">No users match these filters.</p>}
        <div className="users-pager">
          <span>{data.total} user{data.total === 1 ? '' : 's'}</span>
          <button className="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </section>

      <aside className="card detail">
        {editing
          ? <UserForm floors={floors} key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? null : editing}
              departments={departments} holder={holder} isSelf={editing !== 'new' && editing.id === me?.id}
              onClose={() => setEditing(null)} onChanged={afterChange}
              onSaved={(saved) => setEditing(saved)} />
          : <p className="state">Select a user to edit, or choose <b>New user</b>.</p>}
      </aside>
    </div>

    {!holder && <DepartmentsSection departments={departments} onChanged={afterChange} refreshKey={changes} />}
  </main>;
}

// holder: the account manager's cut-down form (spec 2026-10-19-team-account-management §4.2).
function UserForm({ user, departments, floors, holder, isSelf, onClose, onChanged, onSaved }) {
  const isNew = !user;
  const [form, setForm] = useState(() => (isNew ? EMPTY_FORM : {
    email: user.email, username: user.username, full_name: user.full_name, role: user.role,
    start_date: user.start_date || '', end_date: user.end_date || '',
    department_ids: user.departments.map((d) => d.id), is_active: user.is_active,
    booking_allowance: user.booking_allowance ?? 0, usual_seat_id: user.usual_seat_id ?? '',
    ...(holder ? {} : { manages_department_ids: (user.manages ?? []).map((d) => d.id) }),
  }));
  const [fields, setFields] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const passwordCheck = usePasswordCheck(password, { username: user?.username, email: user?.email });
  const [tab, setTab] = useState('details');
  const readOnly = holder && !isNew;   // an account manager can't change username, email or teams

  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const toggleIn = (key, id) => set(key, form[key].includes(id) ? form[key].filter((d) => d !== id) : [...form[key], id]);
  const toggleDept = (id) => toggleIn('department_ids', id);

  const run = async (action) => {
    setBusy(true); setMessage(null); setFields({});
    try { await action(); }
    catch (err) {
      if (err.fields) setFields(err.fields);
      setMessage(errorText(err));
    } finally { setBusy(false); }
  };

  const save = (event) => {
    event.preventDefault();
    run(async () => {
      const body = { ...form, start_date: form.start_date || null, end_date: form.end_date || null };
      if (body.booking_allowance !== undefined) body.booking_allowance = Number(body.booking_allowance);
      if (body.usual_seat_id !== undefined) body.usual_seat_id = body.usual_seat_id || null;
      // The grant section is hidden for admins (they already manage every account), so don't send it.
      if (body.role === 'admin') delete body.manages_department_ids;
      if (isNew) {
        delete body.is_active;
        if (holder) body.role = 'user';
        const created = await flaskRequest('/api/admin/users', { method: 'POST', body });
        await onChanged(created.invitation_sent
          ? `Created ${created.full_name}. An invitation email was sent to ${created.email}.`
          : `Created ${created.full_name}, but the invitation email could not be sent. `
            + 'Set a password for them below, or resend the invitation once email is configured.',
        created.invitation_sent ? 'success' : 'error');
        onSaved(created);
      } else {
        const changed = holder ? holderChanges(form, user) : Object.fromEntries(Object.entries(body).filter(([key, value]) => {
          const before = key === 'department_ids' ? user.departments.map((d) => d.id)
            : key === 'manages_department_ids' ? (user.manages ?? []).map((d) => d.id)
              : (user[key] ?? (key.endsWith('_date') || key === 'usual_seat_id' ? null : ''));
          return JSON.stringify(value) !== JSON.stringify(before);
        }));
        if (!Object.keys(changed).length) { setMessage('Nothing to save.'); return; }
        const saved = await flaskRequest(`/api/admin/users/${user.id}`, { method: 'PATCH', body: changed });
        await onChanged(`Saved ${saved.full_name}.`);
        onSaved(saved);
      }
    });
  };

  const setUserPassword = () => run(async () => {
    await flaskRequest(`/api/admin/users/${user.id}/password`, { method: 'POST', body: { password } });
    setPassword('');
    await onChanged(`Password set for ${user.full_name}. The account is active and unlocked.`);
  });

  const resend = () => run(async () => {
    await flaskRequest(`/api/admin/users/${user.id}/resend-invitation`, { method: 'POST' });
    await onChanged(`Invitation re-sent to ${user.email}.`);
  });

  const remove = () => {
    if (!window.confirm(`Delete ${user.full_name}? This cannot be undone.`)) return;
    run(async () => {
      await flaskRequest(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      onClose();
      await onChanged(`Deleted ${user.full_name}.`);
    });
  };

  const err = (key) => fields[key] && <small className="users-field-error">{fields[key]}</small>;

  const head = <>
    <div className="users-form-head">
      <h2>{isNew ? 'New user' : user.full_name}</h2>
      <button type="button" className="button" onClick={onClose}>Close</button>
    </div>
    {!isNew && !holder && <div className="users-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Details</button>
      <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
    </div>}
  </>;
  if (tab === 'history') return <div className="users-form">{head}<UserHistory userId={user.id} /></div>;
  return <form className="users-form" onSubmit={save}>
    {head}
    {message && <Notice kind="error">{message}</Notice>}

    <label>Full name <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />{err('full_name')}</label>
    {readOnly
      ? <dl className="users-readonly">
        <dt>Username</dt><dd>@{user.username}</dd>
        <dt>Email</dt><dd>{user.email}</dd>
      </dl>
      : <>
        <label>Username <input value={form.username} onChange={(e) => set('username', e.target.value)} required />{err('username')}</label>
        <label>Email <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />{err('email')}</label>
      </>}
    {!holder && <label>Role <select value={form.role} onChange={(e) => set('role', e.target.value)} disabled={isSelf}>
      <option value="user">User</option><option value="admin">Admin</option>
    </select>{err('role')}</label>}
    <div className="users-dates">
      <label>Access from <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />{err('start_date')}</label>
      <label>Access until <input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />{err('end_date')}</label>
    </div>
    {readOnly
      ? <dl className="users-readonly"><dt>Project teams</dt><dd>{user.departments.map((d) => d.name).join(', ') || '—'}</dd></dl>
      : <fieldset className="users-depts">
        <legend>Project teams</legend>
        {departments.length
          ? departments.map((d) => <label key={d.id} className="users-check">
            <input type="checkbox" checked={form.department_ids.includes(d.id)} onChange={() => toggleDept(d.id)} />{d.name}</label>)
          : <small>No project teams yet — add one below the user list.</small>}
        {err('department_ids')}
      </fieldset>}
    {!isNew && !holder && form.role !== 'admin' && <fieldset className="users-depts">
      <legend>Can manage accounts for</legend>
      {teamsOwnFirst(departments, form.department_ids).map((d) => <label key={d.id} className="users-check">
        <input type="checkbox" checked={form.manages_department_ids.includes(d.id)} onChange={() => toggleIn('manages_department_ids', d.id)} />{d.name}</label>)}
      <small className="users-hint">They can add people to these teams and edit or turn off their non-admin accounts. Untick all to remove this.</small>
      {err('manages_department_ids')}
    </fieldset>}
    {!isNew && <label>Usual seat <select value={form.usual_seat_id} onChange={(e) => set('usual_seat_id', e.target.value)}>
      <option value="">None</option>
      {form.usual_seat_id && !seatName(floors, form.usual_seat_id) && <option value={form.usual_seat_id}>Seat no longer published</option>}
      {seatGroups(floors).map((g) => <optgroup key={g.plan} label={g.plan}>
        {g.seats.map((seat) => <option key={seat.id} value={seat.id}>{seat.text}</option>)}</optgroup>)}
    </select><small className="users-hint">Shown in Colleague Finder and on their dashboard. It does not reserve the seat.</small>
      {err('usual_seat_id')}</label>}
    {!isNew && <label>Can book seats for others (0–20 colleagues per day)
      <input type="number" min="0" max="20" required value={form.booking_allowance}
        onChange={(e) => set('booking_allowance', e.target.value)} />{err('booking_allowance')}</label>}
    {!isNew && <label className="users-check">
      <input type="checkbox" checked={form.is_active} disabled={isSelf}
        onChange={(e) => set('is_active', e.target.checked)} />Account enabled{isSelf && ' (you cannot disable yourself)'}</label>}

    <div className="button-row">
      <button className="button primary" disabled={busy}>{isNew ? 'Create and invite' : 'Save changes'}</button>
    </div>

    {!isNew && <div className="users-actions">
      <h3>Account actions</h3>
      <div className="inline-form">
        <label>New password <input type="password" minLength={8} autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters, letters and numbers" />{err('password')}</label>
        <button type="button" className="button" disabled={busy || !passwordCheck.ok} onClick={setUserPassword}>Set password</button>
        {password && <PasswordStrength check={passwordCheck} />}
      </div>
      {user.status === 'pending_activation' &&
        <button type="button" className="button" disabled={busy} onClick={resend}>Resend invitation</button>}
      {!isSelf && !holder && <button type="button" className="button users-danger" disabled={busy} onClick={remove}>Delete user</button>}
    </div>}
  </form>;
}

function DepartmentsSection({ departments, onChanged, refreshKey }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState(null);

  const run = async (action) => {
    setMessage(null);
    try { await action(); } catch (err) { setMessage(err.fields ? Object.values(err.fields).join('; ') : errorText(err)); }
  };
  const add = (event) => {
    event.preventDefault();
    run(async () => {
      await flaskRequest('/api/admin/departments', { method: 'POST', body: { name } });
      setName('');
      await onChanged(`Added ${name.trim()}.`);
    });
  };
  const rename = (dept) => {
    const next = window.prompt('Rename project team', dept.name);
    if (!next || next.trim() === dept.name) return;
    run(async () => {
      await flaskRequest(`/api/admin/departments/${dept.id}`, { method: 'PATCH', body: { name: next } });
      await onChanged(`Renamed ${dept.name} to ${next.trim()}.`);
    });
  };
  const recolor = (dept, color) => run(async () => {
    await flaskRequest(`/api/admin/departments/${dept.id}`, { method: 'PATCH', body: { color } });
    await onChanged(color ? `Changed the colour of ${dept.name}.` : `${dept.name} uses an automatic colour again.`);
  });
  const remove = (dept) => {
    const extra = dept.user_count ? ` ${dept.user_count} user(s) will be removed from it.` : '';
    if (!window.confirm(`Delete ${dept.name}?${extra}`)) return;
    run(async () => {
      await flaskRequest(`/api/admin/departments/${dept.id}`, { method: 'DELETE' });
      await onChanged(`Deleted ${dept.name}.`);
    });
  };

  return <section className="card users-departments">
    <h2>Project teams</h2>
    {message && <Notice kind="error">{message}</Notice>}
    <form className="inline-form" onSubmit={add}>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. eWorkplace or SAP" required /></label>
      <button className="button primary">Add</button>
    </form>
    {departments.length
      ? <table><thead><tr><th>Project team</th><th>Users</th><th>Colour on floor plans</th><th /></tr></thead>
        <tbody>{departments.map((d) => <tr key={d.id}>
          <td>{d.name}</td><td>{d.user_count}</td>
          <td><TeamColor dept={d} onPick={(color) => recolor(d, color)} /></td>
          <td><div className="row-actions">
            <button className="button" onClick={() => rename(d)}>Rename</button>
            <button className="button users-danger" onClick={() => remove(d)}>Delete</button>
          </div></td>
        </tr>)}</tbody></table>
      : <p className="state">No project teams yet.</p>}
    <details className="users-team-changes">
      <summary>Recent changes</summary>
      <TeamChanges refreshKey={refreshKey} />
    </details>
  </section>;
}

// The team's seat-marker colour in the floor plan editor. Saved when the picker closes (the native change event),
// not on every step of a drag; "Auto" goes back to the colour worked out from the team's id.
function TeamColor({ dept, onPick }) {
  const ref = useRef(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const input = ref.current;
    const changed = () => { if (input.value.toLowerCase() !== (dept.color ?? '').toLowerCase()) pick.current(input.value); };
    input.addEventListener('change', changed);
    return () => input.removeEventListener('change', changed);
  }, [dept.color]);
  return <span className="users-team-color">
    <input ref={ref} type="color" key={dept.color ?? 'auto'} defaultValue={departmentColor(dept.id, dept.color)}
      aria-label={`Colour for ${dept.name}`} title="Choose the colour of this team's seats on floor plans" />
    {dept.color ? <button type="button" className="button subtle" onClick={() => onPick(null)}>Auto</button>
      : <small className="muted">Automatic</small>}
  </span>;
}

// Everything that happened to or was done by this user (spec 2026-10-16-audit-views §2).
function UserHistory({ userId }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    flaskRequest(`/api/admin/audit?subject=${userId}&page_size=100`).then((d) => setItems(d.items)).catch((err) => setError(err.message));
  }, [userId]);
  return <div className="users-history">
    {error && <Notice kind="error">{error}</Notice>}
    <AuditTimeline items={error ? [] : items} empty="Nothing recorded for this user yet." />
  </div>;
}

// Reloads after every change on the page (refreshKey), so adding, renaming or deleting a team shows up at once.
function TeamChanges({ refreshKey }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    flaskRequest('/api/admin/audit?category=teams&page_size=10').then((d) => setItems(d.items)).catch(() => setItems([]));
  }, [refreshKey]);
  return <AuditTimeline items={items} empty="No project team changes yet." />;
}

// Sign-in health at a glance; each figure filters the users list or opens the audit log.
function SecurityStrip({ refreshKey, onFilter }) {
  const [s, setS] = useState(null);
  useEffect(() => { flaskRequest('/api/admin/audit/security-summary').then(setS).catch(() => setS(null)); }, [refreshKey]);
  if (!s) return null;
  return <div className="users-health">
    <Link to={`/audit?category=security&q=login_failed&from=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date())}`} className={`users-health-tile${s.failed_today ? ' amber' : ''}`}>
      <b>{s.failed_today}</b><small>failed sign-ins today</small></Link>
    <button type="button" className={`users-health-tile${s.locked ? ' red' : ''}`} onClick={() => onFilter('locked')}>
      <b>{s.locked}</b><small>locked accounts</small></button>
    <button type="button" className="users-health-tile" onClick={() => onFilter('pending')}>
      <b>{s.pending}</b><small>invitations not accepted</small></button>
  </div>;
}
