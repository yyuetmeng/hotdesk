// Admin: configure public floor displays (spec 2026-10-15-floor-dashboard §3). Each display has
// its own link (/display/<slug>) to open on a location's TV.
import { useCallback, useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { slugify } from '../../display/displayLogic.js';

const EMPTY = { name: '', slug: '', plan_ids: [], show_overall: true, layout: 'rotate', rotate_seconds: 20 };
const linkFor = (slug) => `${window.location.origin}/display/${slug}`;

export function DisplaysPage() {
  const [items, setItems] = useState(null);
  const [plans, setPlans] = useState([]);
  const [editing, setEditing] = useState(null);   // null | 'new' | display
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([flaskRequest('/api/admin/displays'), flaskRequest('/api/admin/floor-plans')]);
      setItems(d.items); setPlans(p.items); setError(null);
    } catch (err) { setError(err.status === 403 ? 'You need an administrator account.' : err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const copy = async (slug) => {
    try { await navigator.clipboard.writeText(linkFor(slug)); setNotice({ kind: 'success', text: 'Link copied.' }); }
    catch { setNotice({ kind: 'info', text: linkFor(slug) }); }
  };
  const remove = async (d) => {
    if (!window.confirm(`Delete display "${d.name}"? TVs using its link will show "Display not found".`)) return;
    try { await flaskRequest(`/api/admin/displays/${d.id}`, { method: 'DELETE' }); setEditing(null); await load(); }
    catch (err) { setError(err.message); }
  };

  if (error && !items) return <main className="page"><PageTitle title="Manage Floor Display" /><Notice kind="error">{error}</Notice></main>;
  if (!items) return <main className="page"><Loading label="Loading displays..." /></main>;
  return <main className="page">
    <PageTitle title="Manage Floor Display"><p>Choose which floors each TV shows. Open a display's link on the TV at that location.</p></PageTitle>
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
    <div className="content-split">
      <section className="card">
        <div className="toolbar"><h2>Displays</h2>
          <button className="button primary" onClick={() => { setNotice(null); setEditing('new'); }}>New display</button></div>
        {items.length ? <table><thead><tr><th>Name</th><th>Link</th><th>Floors</th><th>Layout</th><th /></tr></thead>
          <tbody>{items.map((d) => <tr key={d.id}>
            <td><b>{d.name}</b></td>
            <td><code>/display/{d.slug}</code></td>
            <td>{d.floors.map((f) => f.published ? f.name : `${f.name} (not published)`).join(', ') || '—'}</td>
            <td>{d.layout === 'rotate' ? `Rotate every ${d.rotate_seconds}s` : 'All floors'}</td>
            <td><div className="row-actions">
              <a className="button" href={`/display/${d.slug}`} target="_blank" rel="noreferrer">Open</a>
              <button className="button" onClick={() => copy(d.slug)}>Copy link</button>
              <button className="button" onClick={() => { setNotice(null); setEditing(d); }}>Edit</button>
            </div></td></tr>)}</tbody></table>
          : <p className="state">No displays yet. Create one per location.</p>}
      </section>
      <aside className="card detail">
        {editing
          ? <DisplayForm key={editing === 'new' ? 'new' : editing.id} display={editing === 'new' ? null : editing} plans={plans}
              onCancel={() => setEditing(null)} onDelete={remove}
              onSaved={async (saved, created) => {
                setNotice({ kind: 'success', text: `${created ? 'Created' : 'Saved'} ${saved.name}. Link: /display/${saved.slug}` });
                setEditing(saved); await load();
              }} />
          : <p className="state">Select <b>New display</b> or <b>Edit</b>.</p>}
      </aside>
    </div>
  </main>;
}

function DisplayForm({ display, plans, onCancel, onSaved, onDelete }) {
  const isNew = !display;
  const [form, setForm] = useState(() => (isNew ? EMPTY : {
    name: display.name, slug: display.slug, plan_ids: display.plan_ids, show_overall: display.show_overall,
    layout: display.layout, rotate_seconds: display.rotate_seconds,
  }));
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [fields, setFields] = useState({});
  const [message, setMessage] = useState(null);
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const planName = Object.fromEntries(plans.map((p) => [p.id, p]));

  const move = (i, step) => {
    const ids = [...form.plan_ids];
    const j = i + step;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    set('plan_ids', ids);
  };
  const toggle = (id) => set('plan_ids', form.plan_ids.includes(id) ? form.plan_ids.filter((p) => p !== id) : [...form.plan_ids, id]);

  const save = async (event) => {
    event.preventDefault();
    setFields({}); setMessage(null);
    const body = { ...form, rotate_seconds: Number(form.rotate_seconds) };
    try {
      const saved = isNew
        ? await flaskRequest('/api/admin/displays', { method: 'POST', body })
        : await flaskRequest(`/api/admin/displays/${display.id}`, { method: 'PATCH', body });
      onSaved(saved, isNew);
    } catch (err) {
      if (err.fields) setFields(err.fields);
      setMessage(err.message);
    }
  };
  const err = (key) => fields[key] && <small className="users-field-error">{fields[key]}</small>;

  return <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
    <h2 style={{ margin: 0 }}>{isNew ? 'New display' : display.name}</h2>
    {message && <Notice kind="error">{message}</Notice>}
    <label>Name <input value={form.name} required onChange={(e) => {
      set('name', e.target.value);
      if (!slugTouched) set('slug', slugify(e.target.value));
    }} />{err('name')}</label>
    <label>Link name <input value={form.slug} required onChange={(e) => { setSlugTouched(true); set('slug', e.target.value); }} />
      <small>Opens at /display/{form.slug || '…'}</small>{err('slug')}</label>
    <fieldset style={{ display: 'grid', gap: 6, border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
      <legend>Floors (in order)</legend>
      {form.plan_ids.map((id, i) => <div key={id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ flex: 1 }}>{i + 1}. {planName[id]?.name ?? 'Deleted plan'}{planName[id] && planName[id].status === 'draft' ? ' (not published)' : ''}</span>
        <button type="button" className="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
        <button type="button" className="button" onClick={() => move(i, 1)} disabled={i === form.plan_ids.length - 1} aria-label="Move down">↓</button>
        <button type="button" className="button" onClick={() => toggle(id)} aria-label="Remove floor">✕</button>
      </div>)}
      <select value="" onChange={(e) => e.target.value && toggle(e.target.value)} aria-label="Add a floor">
        <option value="">Add a floor…</option>
        {plans.filter((p) => !form.plan_ids.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'draft' ? ' (not published)' : ''}</option>)}
      </select>
      {err('plan_ids')}
    </fieldset>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" checked={form.show_overall} onChange={(e) => set('show_overall', e.target.checked)} />Show overall capacity</label>
    <label>Layout <select value={form.layout} onChange={(e) => set('layout', e.target.value)}>
      <option value="rotate">Rotate one floor at a time</option><option value="grid">All floors side by side</option>
    </select>{err('layout')}</label>
    {form.layout === 'rotate' && <label>Seconds per floor
      <input type="number" min="10" max="120" value={form.rotate_seconds} onChange={(e) => set('rotate_seconds', e.target.value)} />
      {err('rotate_seconds')}</label>}
    <div className="button-row">
      <button className="button primary">{isNew ? 'Create display' : 'Save changes'}</button>
      <button type="button" className="button" onClick={onCancel}>Close</button>
      {!isNew && <button type="button" className="button" onClick={() => onDelete(display)}>Delete</button>}
    </div>
  </form>;
}
