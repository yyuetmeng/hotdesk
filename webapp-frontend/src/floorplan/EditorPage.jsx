import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { formatDateTime } from '../format.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { CATALOG, MAX_ELEMENT_SIZE, baseSize, catalogByType, isResizable, setCatalog, sizeOf } from './palette.js';
import { addElement, metaChanged, moveElement, placementError, removeElement, resizeElement, rotateElement, validateAll } from './logic.js';
import './floorplan.css';

let localSeq = 0;
const nextId = () => `local-${Date.now()}-${localSeq++}`;
// Publishing state of the plan: what staff currently see, and whether the draft differs.
function PublishBanner({ plan, dirty }) {
  const published = plan.published_version
    ? `Published v${plan.published_version} · ${formatDateTime(plan.published_at)}${plan.published_by ? ` by ${plan.published_by}` : ''}`
    : null;
  const pending = plan.status === 'changed' || (dirty && plan.status !== 'draft' && plan.status !== 'unpublished');
  const text = {
    draft: 'Draft · not visible to staff yet. Publish when it is ready.',
    unpublished: 'Unpublished · not visible to staff. Publish to make it available again.',
  }[plan.status] ?? `${published}${pending ? ' · you have unpublished changes' : ''}`;
  return <p className={`fp-status fp-status-${pending ? 'changed' : plan.status}`} role="status">{text}</p>;
}

// Width/height inputs for the selected element. Keeps what the user typed and shows why a
// size was rejected (overlap, outside the grid, out of range) instead of silently ignoring it.
function SizeFields({ el, onResize }) {
  const base = baseSize(el);
  const entry = catalogByType[el.type];
  const [draft, setDraft] = useState({ w: String(base.w), h: String(base.h) });
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft({ w: String(base.w), h: String(base.h) }); setMessage(''); }, [el.id, base.w, base.h]);

  if (!isResizable(el.type)) return <p>Size: {entry.w} × {entry.h} (fixed)</p>;

  const apply = (next) => {
    setDraft(next);
    setMessage(onResize(Number(next.w), Number(next.h)) || '');
  };
  const isDefault = base.w === entry.w && base.h === entry.h;
  return <div className="fp-size">
    <label>Width <input type="number" min="1" max={MAX_ELEMENT_SIZE} value={draft.w} aria-label="Element width"
      onChange={(e) => apply({ ...draft, w: e.target.value })} /></label>
    <label>Height <input type="number" min="1" max={MAX_ELEMENT_SIZE} value={draft.h} aria-label="Element height"
      onChange={(e) => apply({ ...draft, h: e.target.value })} /></label>
    <button className="button subtle" disabled={isDefault}
      onClick={() => apply({ w: String(entry.w), h: String(entry.h) })}>Reset size</button>
    {message && <p className="fp-size-error" role="alert">{message}</p>}
  </div>;
}

// Per-type settings come from the catalog's default config (floor_elements.config).
const settingValue = (el, key) => el.config?.[key] ?? catalogByType[el.type]?.config?.[key];
const isUnbookable = (el) => 'bookable' in (catalogByType[el.type]?.config || {}) && settingValue(el, 'bookable') === false;
const SETTING_LABELS = { bookable: 'Allow booking' };

const SWATCHES = [
  '#1e293b', '#475569', '#64748b', '#94a3b8', '#cbd5e1',
  '#dc2626', '#e11d48', '#f87171', '#ea580c', '#fb923c',
  '#d97706', '#fbbf24', '#ca8a04', '#92400e', '#b45309',
  '#65a30d', '#16a34a', '#15803d', '#4ade80', '#059669',
  '#0d9488', '#0891b2', '#0284c7', '#2563eb', '#60a5fa',
  '#4f46e5', '#7c3aed', '#9333ea', '#c026d3', '#db2777', '#f472b6',
];

export default function EditorPage() {
  const { id } = useParams();
  const [plan, setPlan] = useState(null);
  const [elements, setElements] = useState([]);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [tip, setTip] = useState(null);
  const [cell, setCell] = useState(28);
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ name: '', cols: 20, rows: 15 });
  const gridRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    Promise.all([flaskRequest('/api/admin/floor-plans/catalog'), flaskRequest(`/api/admin/floor-plans/${id}`)])
      .then(([catalog, data]) => {
        setCatalog(catalog.items);
        setPlan(data); setElements(data.elements);
        setMeta({ name: data.name, cols: data.cols, rows: data.rows });
      })
      .catch((err) => setError(err.status === 401 ? 'Session expired — sign in again.' : err.message));
  }, [id]);

  const commit = useCallback((next) => {
    setPast((old) => [...old.slice(-49), elements]);
    setFuture([]); setElements(next); setDirty(true); setProblems([]);
  }, [elements]);

  const undo = () => {
    if (!past.length) return;
    setFuture((old) => [elements, ...old]); setElements(past[past.length - 1]);
    setPast((old) => old.slice(0, -1)); setDirty(true);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((old) => [...old, elements]); setElements(future[0]);
    setFuture((old) => old.slice(1)); setDirty(true);
  };

  const cellFromEvent = (event) => {
    const rect = gridRef.current.getBoundingClientRect();
    return {
      x: Math.min(Math.max(Math.floor((event.clientX - rect.left) / cell), 0), plan.cols - 1),
      y: Math.min(Math.max(Math.floor((event.clientY - rect.top) / cell), 0), plan.rows - 1),
    };
  };

  const dragSpec = (point) => {
    if (!dragRef.current) return null;
    if (dragRef.current.kind === 'add') return { id: null, type: dragRef.current.type, ...point, rotation: 0 };
    const current = elements.find((el) => el.id === dragRef.current.id);
    return current ? { ...current, ...point } : null;
  };

  const onDragOver = (event) => {
    if (!dragRef.current) return;
    event.preventDefault();
    const spec = dragSpec(cellFromEvent(event));
    if (spec) setPreview({ ...spec, valid: !placementError(spec, elements, plan.cols, plan.rows) });
  };

  const onDrop = (event) => {
    event.preventDefault();
    setPreview(null);
    const point = cellFromEvent(event);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const result = drag.kind === 'add'
      ? addElement(elements, drag.type, point.x, point.y, plan.cols, plan.rows, nextId)
      : moveElement(elements, drag.id, point.x, point.y, plan.cols, plan.rows);
    if (!result.error) commit(result.elements);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (!plan || !selectedId || event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
      if (event.key === 'r' || event.key === 'R') {
        const result = rotateElement(elements, selectedId, plan.cols, plan.rows);
        if (!result.error) commit(result.elements);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        commit(removeElement(elements, selectedId)); setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan, selectedId, elements, commit]);

  const updateSelected = (patch) => {
    commit(elements.map((el) => (el.id === selectedId ? { ...el, ...patch } : el)));
  };

  // Returns true when the draft was saved, so Publish can save first and stop on failure.
  const save = async () => {
    const local = validateAll(elements, plan.cols, plan.rows);
    if (local.length) { setProblems(local); return false; }
    setSaving(true); setProblems([]);
    try {
      const data = await flaskRequest(`/api/admin/floor-plans/${id}/elements`,
        { method: 'PUT', body: { elements } });
      setPlan(data); setElements(data.elements); setDirty(false); setSelectedId(null);
      return true;
    } catch (err) {
      if (err.status === 400 && err.fields && err.fields.elements) setProblems([].concat(err.fields.elements));
      else setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
      return false;
    } finally { setSaving(false); }
  };

  // Publish / Unpublish / Discard (docs/superpowers/specs/2026-10-15-floorplan-publishing-design.md §3).
  const lifecycle = async (action, { confirmText, resetDraft = false } = {}) => {
    if (confirmText && !window.confirm(confirmText)) return;
    // Publish exactly what the admin sees: unsaved elements first, then unapplied name/grid.
    if (action === 'publish' && dirty && !(await save())) return;
    if (action === 'publish' && metaChanged(meta, plan) && !(await patchMeta())) return;
    setSaving(true); setProblems([]);
    try {
      const data = await flaskRequest(`/api/admin/floor-plans/${id}/${action}`, { method: 'POST' });
      setPlan(data);
      if (resetDraft) {
        setElements(data.elements); setMeta({ name: data.name, cols: data.cols, rows: data.rows });
        setPast([]); setFuture([]); setDirty(false); setSelectedId(null);
      }
    } catch (err) {
      if (err.status === 400 && err.fields && err.fields.elements) setProblems([].concat(err.fields.elements));
      else if (err.status === 401) setError('Session expired — sign in again.');
      else setProblems([err.message]);
    } finally { setSaving(false); }
  };

  // PATCH name/grid; returns true on success. Reloads the plan (and its saved elements).
  const patchMeta = async () => {
    try {
      const data = await flaskRequest(`/api/admin/floor-plans/${id}`,
        { method: 'PATCH', body: { name: meta.name, cols: Number(meta.cols), rows: Number(meta.rows) } });
      setPlan(data); setElements(data.elements); setDirty(false); setError(null);
      setMeta({ name: data.name, cols: data.cols, rows: data.rows });
      return true;
    } catch (err) {
      if (err.status === 400 && err.fields) setProblems(Object.values(err.fields));
      else setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
      return false;
    }
  };

  const applyMeta = async () => {
    if (dirty && !window.confirm('Applying grid changes reloads the plan and discards unsaved edits. Continue?')) return;
    await patchMeta();
  };

  if (error) return <main className="page"><PageTitle title="Floor plan editor" /><Notice kind="error">{error}</Notice></main>;
  if (!plan) return <main className="page"><Loading label="Loading floor plan..." /></main>;
  const selected = elements.find((el) => el.id === selectedId);

  return <main className="page fp-editor">
    <PageTitle title={plan.name} />
    <header className="fp-toolbar">
      <input aria-label="Plan label" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
      <label>Cols <input type="number" min="5" max="80" value={meta.cols} aria-label="Columns"
        onChange={(e) => setMeta({ ...meta, cols: e.target.value })} /></label>
      <label>Rows <input type="number" min="5" max="80" value={meta.rows} aria-label="Rows"
        onChange={(e) => setMeta({ ...meta, rows: e.target.value })} /></label>
      <button className="button subtle" onClick={applyMeta}>Apply</button>
      <span className="fp-spacer" />
      <label>Zoom <input type="range" min="16" max="48" value={cell} aria-label="Zoom"
        onChange={(e) => setCell(Number(e.target.value))} /></label>
      <button className="button subtle" onClick={undo} disabled={!past.length}>Undo</button>
      <button className="button subtle" onClick={redo} disabled={!future.length}>Redo</button>
      <button className="button primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : dirty ? 'Save *' : 'Saved'}</button>
      <button className="button primary" onClick={() => lifecycle('publish')}
        disabled={saving || validateAll(elements, plan.cols, plan.rows).length > 0 || (plan.status === 'published' && !dirty && !metaChanged(meta, plan))}>
        {dirty || metaChanged(meta, plan) ? 'Save & publish' : 'Publish'}</button>
      {plan.status === 'changed' && <button className="button subtle" disabled={saving}
        onClick={() => lifecycle('discard', { resetDraft: true,
          confirmText: 'Discard all changes since the last publish? The draft goes back to the published version.' })}>
        Discard changes</button>}
      {(plan.status === 'published' || plan.status === 'changed') && <button className="button subtle" disabled={saving}
        onClick={() => lifecycle('unpublish', {
          confirmText: 'Unpublish this plan? Staff will no longer see it or be able to book it. The draft is kept.' })}>
        Unpublish</button>}
    </header>
    <PublishBanner plan={plan} dirty={dirty || metaChanged(meta, plan)} />
    {problems.length > 0 && <Notice kind="error">{problems.join(' · ')}</Notice>}
    <div className="fp-panes">
      <aside className="fp-palette">
        <h2>Elements</h2>
        {CATALOG.map((entry) => <div key={entry.type} className="fp-chip" draggable
          onDragStart={(e) => { dragRef.current = { kind: 'add', type: entry.type }; e.dataTransfer.setData('text/plain', entry.type); }}
          onDragEnd={() => { dragRef.current = null; setPreview(null); }}>
          <span className="fp-swatch" style={{ background: entry.color }} />
          <b>{entry.label}</b><small>{entry.w}×{entry.h}</small>
        </div>)}
        <p className="fp-hint">Drag onto the grid. Click an element to select; R rotates, Del removes.</p>
      </aside>
      <div className="fp-grid-wrap">
        <div ref={gridRef} className="fp-grid" onDragOver={onDragOver} onDrop={onDrop}
          style={{ width: plan.cols * cell, height: plan.rows * cell, '--cell': `${cell}px` }}
          onClick={(e) => { if (e.target === gridRef.current) setSelectedId(null); }}>
          {elements.map((el) => {
            const size = sizeOf(el);
            const base = baseSize(el);
            const entry = catalogByType[el.type];
            return <div key={el.id} draggable
              className={`fp-el${selectedId === el.id ? ' selected' : ''}${isUnbookable(el) ? ' not-bookable' : ''}`}
              onMouseEnter={(e) => setTip({ text: `${el.label ? `${el.label}\n` : ''}${entry.label} (${el.x},${el.y})`,
                                            rect: e.currentTarget.getBoundingClientRect() })}
              onMouseLeave={() => setTip(null)}
              onDragStart={(e) => { setTip(null); dragRef.current = { kind: 'move', id: el.id }; e.dataTransfer.setData('text/plain', el.id); }}
              onDragEnd={() => { dragRef.current = null; setPreview(null); }}
              onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); }}
              style={{ left: el.x * cell, top: el.y * cell, width: size.w * cell, height: size.h * cell,
                       backgroundColor: el.color || entry.color }}>
              {el.label && <span className="fp-el-label"
                style={{ width: base.w * cell, height: base.h * cell,
                         transform: `translate(-50%, -50%) rotate(${el.rotation || 0}deg)` }}>
                {el.label}
              </span>}
            </div>;
          })}
          {preview && <div className={`fp-preview ${preview.valid ? 'ok' : 'bad'}`}
            style={{ left: preview.x * cell, top: preview.y * cell,
                     width: sizeOf(preview).w * cell,
                     height: sizeOf(preview).h * cell }} />}
        </div>
      </div>
      <aside className="fp-inspector">
        <h2>{selected ? (catalogByType[selected.type].label) : 'Nothing selected'}</h2>
        {selected && <>
          <p>Type: {selected.type} · at {selected.x},{selected.y} · rotation {selected.rotation}°</p>
          <label>Label <input value={selected.label || ''} maxLength={60} aria-label="Element label"
            onChange={(e) => updateSelected({ label: e.target.value })} /></label>
          <p>Colour</p>
          <div className="fp-swatches">{SWATCHES.map((hex) => <button key={hex} aria-label={hex}
            className={selected.color === hex ? 'active' : ''} style={{ background: hex }}
            onClick={() => updateSelected({ color: hex })} />)}</div>
          <div className="fp-color-extra">
            <label>Custom <input type="color" aria-label="Custom colour"
              value={selected.color || catalogByType[selected.type].color}
              onChange={(e) => updateSelected({ color: e.target.value })} /></label>
            <button className="button subtle" disabled={!selected.color}
              onClick={() => updateSelected({ color: null })}>Default</button>
          </div>
          <SizeFields el={selected} onResize={(w, h) => {
            const result = resizeElement(elements, selected.id, w, h, plan.cols, plan.rows);
            if (!result.error) commit(result.elements);
            return result.error;
          }} />
          {(() => {
            const toggles = Object.entries(catalogByType[selected.type].config || {})
              .filter(([, value]) => typeof value === 'boolean');
            return toggles.length > 0 && <>
              <p>{catalogByType[selected.type].label} settings</p>
              {toggles.map(([key]) => <label key={key} className="fp-toggle">
                <input type="checkbox" checked={Boolean(settingValue(selected, key))}
                  onChange={(e) => updateSelected({ config: { ...selected.config, [key]: e.target.checked } })} />
                {SETTING_LABELS[key] ?? key}</label>)}
            </>;
          })()}
          <div className="fp-actions">
            <button className="button subtle" onClick={() => {
              const result = rotateElement(elements, selected.id, plan.cols, plan.rows);
              if (!result.error) commit(result.elements);
            }}>Rotate (R)</button>
            <button className="button subtle" onClick={() => {
              commit(removeElement(elements, selected.id)); setSelectedId(null);
            }}>Remove (Del)</button>
          </div>
        </>}
      </aside>
    </div>
    <HoverTip tip={tip} onDismiss={() => setTip(null)} />
  </main>;
}

// Element tooltip, fixed to the viewport so the grid's scroll area cannot clip it.
// Sits above the element, flips below near the top of the screen, and is kept on-screen sideways.
function HoverTip({ tip, onDismiss }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!tip || !ref.current) { setPos(null); return; }
    const { width, height } = ref.current.getBoundingClientRect();
    const gap = 6, margin = 4;
    let top = tip.rect.top - height - gap;
    if (top < margin) top = tip.rect.bottom + gap;
    const centered = tip.rect.left + tip.rect.width / 2 - width / 2;
    setPos({ top, left: Math.max(margin, Math.min(centered, window.innerWidth - width - margin)) });
  }, [tip]);
  useEffect(() => {
    if (!tip) return undefined;
    window.addEventListener('scroll', onDismiss, true);  // element moved under a stale tooltip
    return () => window.removeEventListener('scroll', onDismiss, true);
  }, [tip, onDismiss]);
  if (!tip) return null;
  return <div ref={ref} className="fp-tip" role="tooltip"
    style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}>{tip.text}</div>;
}
