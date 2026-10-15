import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { formatDateTime } from '../format.js';
import './floorplan.css';

const STATUS_LABEL = { draft: 'Draft', published: 'Published', changed: 'Unpublished changes', unpublished: 'Unpublished' };

export default function FloorPlansPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ name: '', cols: 20, rows: 15 });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await flaskRequest('/api/admin/floor-plans')).items);
      setError(null);
    } catch (err) {
      setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setCreating(true); setNotice(null);
    try {
      await flaskRequest('/api/admin/floor-plans', {
        method: 'POST', body: { name: form.name, cols: Number(form.cols), rows: Number(form.rows) },
      });
      setForm({ name: '', cols: 20, rows: 15 });
      await load();
    } catch (err) {
      if (err.status === 400 && err.fields) setNotice(Object.values(err.fields).join('; '));
      else setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
    } finally { setCreating(false); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete plan "${item.name}"? Its elements are removed too.`)) return;
    try { await flaskRequest(`/api/admin/floor-plans/${item.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err.status === 401 ? 'Session expired — sign in again.' : err.message); }
  };

  const title = <PageTitle title="Manage Floor Plan"><p>Design and manage office floor plan layouts.</p></PageTitle>;
  if (error) return <main className="page">{title}<Notice kind="error">{error}</Notice></main>;
  if (!items) return <main className="page">{title}<Loading label="Loading floor plans..." /></main>;

  return <main className="page">
    {title}
    {notice && <Notice kind="error">{notice}</Notice>}
    <section className="card">
      <form className="fp-form" onSubmit={create}>
        <input aria-label="Plan name" placeholder="Plan label" value={form.name}
               onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <label>Cols <input type="number" min="5" max="80" value={form.cols} aria-label="Columns"
               onChange={(e) => setForm({ ...form, cols: e.target.value })} /></label>
        <label>Rows <input type="number" min="5" max="80" value={form.rows} aria-label="Rows"
               onChange={(e) => setForm({ ...form, rows: e.target.value })} /></label>
        <button className="button primary" disabled={creating}>New plan</button>
      </form>
      <table className="fp-table">
        <thead><tr><th>Name</th><th>Status</th><th>Grid</th><th>Elements</th><th>Updated</th><th /></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id}>
          <td><Link to={`/floor-plans/${item.id}`}>{item.name}</Link></td>
          <td><span className={`fp-pill fp-status-${item.status}`}>{STATUS_LABEL[item.status]}</span>
            {item.published_version && <small>v{item.published_version} · {formatDateTime(item.published_at)}</small>}</td>
          <td>{item.cols}×{item.rows}</td>
          <td>{item.element_count}</td>
          <td>{formatDateTime(item.updated_at)}</td>
          <td><button className="button subtle" onClick={() => remove(item)}>Delete</button></td>
        </tr>)}</tbody>
      </table>
      {!items.length && <p>No plans yet — create one above.</p>}
    </section>
  </main>;
}
