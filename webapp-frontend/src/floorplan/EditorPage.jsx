import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { CATALOG, catalogByType, effectiveSize } from './palette.js';
import { addElement, moveElement, placementError, removeElement, rotateElement, validateAll } from './logic.js';
import './floorplan.css';

let localSeq = 0;
const nextId = () => `local-${Date.now()}-${localSeq++}`;
const SWATCHES = ['#64748b', '#16a34a', '#0d9488', '#7c3aed', '#b45309', '#2563eb', '#db2777', '#15803d', '#94a3b8'];

export default function EditorPage() {
  const { id } = useParams();
  const [plan, setPlan] = useState(null);
  const [elements, setElements] = useState([]);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cell, setCell] = useState(28);
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ name: '', cols: 20, rows: 15 });
  const gridRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    flaskRequest(`/api/admin/floor-plans/${id}`)
      .then((data) => {
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

  const save = async () => {
    const local = validateAll(elements, plan.cols, plan.rows);
    if (local.length) { setProblems(local); return; }
    setSaving(true); setProblems([]);
    try {
      const data = await flaskRequest(`/api/admin/floor-plans/${id}/elements`,
        { method: 'PUT', body: { elements } });
      setPlan(data); setElements(data.elements); setDirty(false); setSelectedId(null);
    } catch (err) {
      if (err.status === 400 && err.fields && err.fields.elements) setProblems([].concat(err.fields.elements));
      else setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
    } finally { setSaving(false); }
  };

  const applyMeta = async () => {
    if (dirty && !window.confirm('Applying grid changes reloads the plan and discards unsaved edits. Continue?')) return;
    try {
      const data = await flaskRequest(`/api/admin/floor-plans/${id}`,
        { method: 'PATCH', body: { name: meta.name, cols: Number(meta.cols), rows: Number(meta.rows) } });
      setPlan(data); setElements(data.elements); setDirty(false); setError(null);
      setMeta({ name: data.name, cols: data.cols, rows: data.rows });
    } catch (err) {
      if (err.status === 400 && err.fields) setProblems(Object.values(err.fields));
      else setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
    }
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
    </header>
    {problems.length > 0 && <Notice kind="error">{problems.join(' · ')}</Notice>}
    <div className="fp-panes">
      <aside className="fp-palette">
        <h2>Elements</h2>
        {CATALOG.map((entry) => <div key={entry.type} className="fp-chip" draggable
          onDragStart={(e) => { dragRef.current = { kind: 'add', type: entry.type }; e.dataTransfer.setData('text/plain', entry.type); }}>
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
            const size = effectiveSize(el.type, el.rotation || 0);
            const entry = catalogByType[el.type];
            return <div key={el.id} draggable
              className={`fp-el${selectedId === el.id ? ' selected' : ''}`}
              onDragStart={(e) => { dragRef.current = { kind: 'move', id: el.id }; e.dataTransfer.setData('text/plain', el.id); }}
              onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); }}
              title={`${el.type} (${el.x},${el.y})`}
              style={{ left: el.x * cell, top: el.y * cell, width: size.w * cell, height: size.h * cell,
                       background: el.color || entry.color }}>
              {el.label || entry.label}
            </div>;
          })}
          {preview && <div className={`fp-preview ${preview.valid ? 'ok' : 'bad'}`}
            style={{ left: preview.x * cell, top: preview.y * cell,
                     width: effectiveSize(preview.type, preview.rotation).w * cell,
                     height: effectiveSize(preview.type, preview.rotation).h * cell }} />}
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
  </main>;
}
