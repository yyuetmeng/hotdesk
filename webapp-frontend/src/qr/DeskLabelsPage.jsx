// Print Desk Labels (admins): QR labels for the seats of published floors, with filters, and
// download one label as PNG or many as a ZIP, or print the selected labels on A4.
// Each QR encodes only the seat link; checking in still requires signing in.
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { filterRows, labelFileNames, seatRows, teamOptions, zoneOptions } from './qrLogic.js';
import { makeZip } from './zip.js';
import './qr.css';

const seatLink = (id) => `${window.location.origin}/checkin/${id}`;

// A printable label as PNG bytes: the QR code with the seat name and floor underneath.
async function labelPng(row) {
  const size = 600, qr = 480;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = 680;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const code = document.createElement('canvas');
  await QRCode.toCanvas(code, seatLink(row.id), { margin: 1, width: qr });
  ctx.drawImage(code, (size - qr) / 2, 24, qr, qr);
  ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center';
  ctx.font = '700 44px Inter, system-ui, sans-serif';
  ctx.fillText(row.label, size / 2, 570, size - 40);
  ctx.fillStyle = '#475569'; ctx.font = '26px Inter, system-ui, sans-serif';
  ctx.fillText(`${row.floorName}${row.zone ? ` · ${row.zone}` : ''} · scan to check in`, size / 2, 620, size - 40);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

function saveFile(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DeskLabelsPage() {
  const [params] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [floors, setFloors] = useState([]);
  const [images, setImages] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [filters, setFilters] = useState({ floor: params.get('floor') || 'all', zone: 'all', team: 'all', q: '' });
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    (async () => {
      try {
        const list = (await flaskRequest('/api/public/floors')).items;
        const loaded = await Promise.all(list.map((f) => flaskRequest(`/api/public/floors/${f.id}`)));
        setFloors(list);
        setRows(loaded.flatMap(seatRows));
      } catch (err) { setError(err.message); }
    })();
  }, []);

  // Preview images for the rows on screen, made once per seat.
  useEffect(() => {
    if (!rows) return;
    let alive = true;
    (async () => {
      const missing = rows.filter((r) => !images[r.id]);
      const made = await Promise.all(missing.map(async (r) => [r.id, await QRCode.toDataURL(seatLink(r.id), { margin: 1, width: 320 })]));
      if (alive && made.length) setImages((old) => ({ ...old, ...Object.fromEntries(made) }));
    })();
    return () => { alive = false; };
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFloor = rows ? rows.filter((r) => filters.floor === 'all' || r.floorId === filters.floor) : [];
  const shown = useMemo(() => (rows ? filterRows(rows, filters) : []), [rows, filters]);
  const chosen = shown.filter((r) => selected.has(r.id));
  const allShownSelected = shown.length > 0 && chosen.length === shown.length;

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value, ...(key === 'floor' ? { zone: 'all' } : {}) }));
  const toggle = (id) => setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAllShown = () => setSelected((old) => {
    const next = new Set(old);
    shown.forEach((r) => (allShownSelected ? next.delete(r.id) : next.add(r.id)));
    return next;
  });

  const run = async (label, fn) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const downloadOne = (row) => run(row.id, async () => saveFile(await labelPng(row), labelFileNames([row])[0], 'image/png'));
  const downloadZip = () => run('zip', async () => {
    const names = labelFileNames(chosen);
    const files = await Promise.all(chosen.map(async (r, i) => ({ name: names[i], data: await labelPng(r) })));
    saveFile(makeZip(files), `desk-labels-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
  });

  if (error && !rows) return <main className="page"><PageTitle title="Print Desk Labels" /><Notice kind="error">{error}</Notice></main>;
  if (!rows) return <main className="page"><Loading label="Loading desk labels..." /></main>;
  return <main className="page desk-labels">
    <PageTitle title="Print Desk Labels"><p>QR labels for the seats of published floors. Stick each label on its desk; people scan it to check in.</p></PageTitle>
    {error && <Notice kind="error">{error}</Notice>}
    {!floors.length ? <Notice>No published floors yet. Publish a floor plan to make its desk labels.</Notice> : <>
      <section className="card labels-filters toolbar">
        <label>Floor <select value={filters.floor} onChange={(e) => setFilter('floor', e.target.value)}>
          <option value="all">All floors</option>
          {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        <label>Zone <select value={filters.zone} onChange={(e) => setFilter('zone', e.target.value)}>
          <option value="all">All zones</option>
          {zoneOptions(onFloor).map((z) => <option key={z} value={z}>{z}</option>)}
          <option value="none">No zone</option>
        </select></label>
        <label>Project team <select value={filters.team} onChange={(e) => setFilter('team', e.target.value)}>
          <option value="all">All seats</option>
          <option value="open">Free for all</option>
          {teamOptions(rows).map((t) => <option key={t} value={t}>{t}</option>)}
          <option value="none">No project team</option>
        </select></label>
        <label>Search <input type="search" placeholder="Seat label" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} /></label>
      </section>
      <div className="labels-actions">
        <label className="labels-select-all"><input type="checkbox" checked={allShownSelected} disabled={!shown.length}
          onChange={toggleAllShown} />Select all shown ({shown.length})</label>
        <span className="muted">{chosen.length} selected</span>
        <button className="button primary" disabled={!chosen.length || Boolean(busy)} onClick={downloadZip}>
          {busy === 'zip' ? 'Making ZIP…' : `Download ${chosen.length || ''} as ZIP`}</button>
        <button className="button" disabled={!chosen.length} onClick={() => window.print()}>Print selected</button>
        {selected.size > 0 && <button className="button subtle" onClick={() => setSelected(new Set())}>Clear selection</button>}
      </div>
      {!shown.length ? <p className="state">No seats match these filters.</p>
        : <div className="qr-sheet">{shown.map((r) => <div key={r.id} className={`qr-label${selected.has(r.id) ? ' selected' : ''}`}>
          <label className="qr-check"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
            aria-label={`Select ${r.label}`} /></label>
          {images[r.id] ? <img src={images[r.id]} alt={`QR code for ${r.label}`} /> : <div className="qr-placeholder" />}
          <b>{r.label}</b><small>{r.floorName}{r.zone ? ` · ${r.zone}` : ''} · scan to check in</small>
          <button className="button subtle qr-download" disabled={busy === r.id} onClick={() => downloadOne(r)}>
            {busy === r.id ? 'Saving…' : 'Download PNG'}</button>
        </div>)}</div>}
    </>}
  </main>;
}
