import { useCallback, useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { formatDate } from '../../format.js';
import { useAuth } from '../../auth.jsx';
import './users.css';

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

function messageOf(err) {
  if (err.status === 401) return 'Session expired — sign in again.';
  if (err.status === 403) return 'You need an administrator account to manage users.';
  return err.message;
}

export function UsersPage() {
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ q: '', role: '', status: '', department: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | user object

  const loadUsers = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try { setData(await flaskRequest(`/api/admin/users?${params}`)); setError(null); }
    catch (err) { setError(messageOf(err)); }
  }, [filters, page]);

  const loadDepartments = useCallback(async () => {
    try { setDepartments((await flaskRequest('/api/admin/departments')).items); }
    catch (err) { setError(messageOf(err)); }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadDepartments(); }, [loadDepartments]);

  const setFilter = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1); };
  const afterChange = async (message, kind = 'success') => {
    setNotice({ kind, message });
    await Promise.all([loadUsers(), loadDepartments()]);
  };

  if (error && !data) return <main className="page"><PageTitle title="Manage Users" /><Notice kind="error">{error}</Notice></main>;
  if (!data) return <main className="page"><Loading label="Loading users..." /></main>;

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  return <main className="page">
    <PageTitle title="Manage Users"><p>Invite people, set their role, departments and groups, and control access.</p></PageTitle>
    {error && <Notice kind="error">{error}</Notice>}
    {notice && <Notice kind={notice.kind}>{notice.message}</Notice>}

    <div className="content-split users-layout">
      <section className="card">
        <div className="toolbar">
          <label>Search <input type="search" placeholder="Name, username or email" value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)} /></label>
          <label>Role <select value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
            <option value="">All</option><option value="user">User</option><option value="admin">Admin</option>
          </select></label>
          <label>Status <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All</option><option value="active">Active</option><option value="inactive">Disabled</option>
          </select></label>
          <label>Department / group <select value={filters.department} onChange={(e) => setFilter('department', e.target.value)}>
            <option value="">All</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
          <button className="button primary" onClick={() => { setNotice(null); setEditing('new'); }}>New user</button>
        </div>

        <div className="users-table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Departments / groups</th><th>Access</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((u) => {
              const [label, cls] = STATUS[statusOf(u)];
              return <tr key={u.id} className={`users-row${editing?.id === u.id ? ' selected' : ''}`}
                onClick={() => { setNotice(null); setEditing(u); }}>
                <td><b>{u.full_name}</b><small>@{u.username}</small></td>
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
          ? <UserForm key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? null : editing}
              departments={departments} isSelf={editing !== 'new' && editing.id === me?.id}
              onClose={() => setEditing(null)} onChanged={afterChange}
              onSaved={(saved) => setEditing(saved)} />
          : <p className="state">Select a user to edit, or choose <b>New user</b>.</p>}
      </aside>
    </div>

    <DepartmentsSection departments={departments} onChanged={afterChange} />
  </main>;
}

function UserForm({ user, departments, isSelf, onClose, onChanged, onSaved }) {
  const isNew = !user;
  const [form, setForm] = useState(() => (isNew ? EMPTY_FORM : {
    email: user.email, username: user.username, full_name: user.full_name, role: user.role,
    start_date: user.start_date || '', end_date: user.end_date || '',
    department_ids: user.departments.map((d) => d.id), is_active: user.is_active,
  }));
  const [fields, setFields] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');

  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const toggleDept = (id) => set('department_ids', form.department_ids.includes(id)
    ? form.department_ids.filter((d) => d !== id) : [...form.department_ids, id]);

  const run = async (action) => {
    setBusy(true); setMessage(null); setFields({});
    try { await action(); }
    catch (err) {
      if (err.fields) setFields(err.fields);
      setMessage(messageOf(err));
    } finally { setBusy(false); }
  };

  const save = (event) => {
    event.preventDefault();
    run(async () => {
      const body = { ...form, start_date: form.start_date || null, end_date: form.end_date || null };
      if (isNew) {
        delete body.is_active;
        const created = await flaskRequest('/api/admin/users', { method: 'POST', body });
        await onChanged(created.invitation_sent
          ? `Created ${created.full_name}. An invitation email was sent to ${created.email}.`
          : `Created ${created.full_name}, but the invitation email could not be sent. `
            + 'Set a password for them below, or resend the invitation once email is configured.',
        created.invitation_sent ? 'success' : 'error');
        onSaved(created);
      } else {
        const changed = Object.fromEntries(Object.entries(body).filter(([key, value]) => {
          const before = key === 'department_ids' ? user.departments.map((d) => d.id) : (user[key] ?? (key.endsWith('_date') ? null : ''));
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

  return <form className="users-form" onSubmit={save}>
    <div className="users-form-head">
      <h2>{isNew ? 'New user' : user.full_name}</h2>
      <button type="button" className="button" onClick={onClose}>Close</button>
    </div>
    {message && <Notice kind="error">{message}</Notice>}

    <label>Full name <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />{err('full_name')}</label>
    <label>Username <input value={form.username} onChange={(e) => set('username', e.target.value)} required />{err('username')}</label>
    <label>Email <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />{err('email')}</label>
    <label>Role <select value={form.role} onChange={(e) => set('role', e.target.value)} disabled={isSelf}>
      <option value="user">User</option><option value="admin">Admin</option>
    </select>{err('role')}</label>
    <div className="users-dates">
      <label>Access from <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />{err('start_date')}</label>
      <label>Access until <input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />{err('end_date')}</label>
    </div>
    <fieldset className="users-depts">
      <legend>Departments / groups</legend>
      {departments.length
        ? departments.map((d) => <label key={d.id} className="users-check">
          <input type="checkbox" checked={form.department_ids.includes(d.id)} onChange={() => toggleDept(d.id)} />{d.name}</label>)
        : <small>No departments or groups yet — add one below the user list.</small>}
      {err('department_ids')}
    </fieldset>
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
          onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />{err('password')}</label>
        <button type="button" className="button" disabled={busy || password.length < 8} onClick={setUserPassword}>Set password</button>
      </div>
      {user.status === 'pending_activation' &&
        <button type="button" className="button" disabled={busy} onClick={resend}>Resend invitation</button>}
      {!isSelf && <button type="button" className="button users-danger" disabled={busy} onClick={remove}>Delete user</button>}
    </div>}
  </form>;
}

function DepartmentsSection({ departments, onChanged }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState(null);

  const run = async (action) => {
    setMessage(null);
    try { await action(); } catch (err) { setMessage(err.fields ? Object.values(err.fields).join('; ') : messageOf(err)); }
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
    const next = window.prompt('Rename department / group', dept.name);
    if (!next || next.trim() === dept.name) return;
    run(async () => {
      await flaskRequest(`/api/admin/departments/${dept.id}`, { method: 'PATCH', body: { name: next } });
      await onChanged(`Renamed ${dept.name} to ${next.trim()}.`);
    });
  };
  const remove = (dept) => {
    const extra = dept.user_count ? ` ${dept.user_count} user(s) will be removed from it.` : '';
    if (!window.confirm(`Delete ${dept.name}?${extra}`)) return;
    run(async () => {
      await flaskRequest(`/api/admin/departments/${dept.id}`, { method: 'DELETE' });
      await onChanged(`Deleted ${dept.name}.`);
    });
  };

  return <section className="card users-departments">
    <h2>Departments / groups</h2>
    {message && <Notice kind="error">{message}</Notice>}
    <form className="inline-form" onSubmit={add}>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering or Project Alpha" required /></label>
      <button className="button primary">Add</button>
    </form>
    {departments.length
      ? <table><thead><tr><th>Department / group</th><th>Users</th><th /></tr></thead>
        <tbody>{departments.map((d) => <tr key={d.id}>
          <td>{d.name}</td><td>{d.user_count}</td>
          <td className="users-dept-actions">
            <button className="button" onClick={() => rename(d)}>Rename</button>
            <button className="button users-danger" onClick={() => remove(d)}>Delete</button>
          </td>
        </tr>)}</tbody></table>
      : <p className="state">No departments or groups yet.</p>}
  </section>;
}
