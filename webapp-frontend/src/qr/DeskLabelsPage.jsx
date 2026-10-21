// Print Desk Labels (admins): QR labels for the seats of published floors, with filters, and
// download one label as PNG or the selected labels as a ZIP. Labels are shown by zone (with a select-all per
// zone), and the ZIP has a folder per floor and zone.
// Each QR encodes only the seat link; checking in still requires signing in. The artwork is in labelArt.js.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { filterRows, groupByZone, isNewLabel, labelFileNames, labelZipPaths, seatRows, teamOptions, withDownloaded, zoneOptions } from './qrLogic.js';
import { makeZip } from './zip.js';
import { codeSvg, labelSvg, LABEL_HEIGHT, LABEL_WIDTH, qrMatrix } from './labelArt.js';
import './qr.css';
import { formatDateTime } from '../format.js';

const seatLink = (id) => `${window.location.origin}/checkin/${id}`;

const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const place = (row) => `${row.floorName}${row.zone ? ` · ${row.zone}` : ''}`;

// A printable label as PNG bytes: the label artwork drawn onto a canvas at twice its size, for sharp printing.
async function labelPng(row) {
  const img = new Image();
  img.src = svgUrl(labelSvg(qrMatrix(seatLink(row.id)), { label: row.label, place: place(row) }));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_WIDTH * 2; canvas.height = LABEL_HEIGHT * 2;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
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
  const [filters, setFilters] = useState({ floor: params.get('floor') || 'all', zone: 'all', team: 'all', label: 'all', q: '' });
  const [selected, setSelected] = useState(() => new Set());
  const [downloadInfo, setDownloadInfo] = useState({});   // seat id -> { at, by } of the latest download
  const [downloaded, setDownloaded] = useState(null);   // seat ids whose label any admin has downloaded

  useEffect(() => {
    (async () => {
      try {
        const list = (await flaskRequest('/api/public/floors')).items;
        const loaded = await Promise.all(list.map((f) => flaskRequest(`/api/public/floors/${f.id}`)));
        setFloors(list);
        setRows(loaded.flatMap(seatRows));
        flaskRequest('/api/admin/desk-labels/downloads')
          .then((d) => { setDownloaded(new Set(d.seat_ids)); setDownloadInfo(d.details ?? {}); }).catch(() => {});
      } catch (err) { setError(err.message); }
    })();
  }, []);

  // Preview images for the rows on screen, made once per seat.
  useEffect(() => {
    if (!rows) return;
    const made = rows.filter((r) => !images[r.id]).map((r) => [r.id, svgUrl(codeSvg(qrMatrix(seatLink(r.id)), 320))]);
    if (made.length) setImages((old) => ({ ...old, ...Object.fromEntries(made) }));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFloor = rows ? rows.filter((r) => filters.floor === 'all' || r.floorId === filters.floor) : [];
  const shown = useMemo(() => (rows ? filterRows(rows, filters, downloaded) : []), [rows, filters, downloaded]);
  const chosen = shown.filter((r) => selected.has(r.id));
  const allShownSelected = shown.length > 0 && chosen.length === shown.length;

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value, ...(key === 'floor' ? { zone: 'all' } : {}) }));
  const toggle = (id) => setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleMany = (list, on) => setSelected((old) => {
    const next = new Set(old);
    list.forEach((r) => (on ? next.add(r.id) : next.delete(r.id)));
    return next;
  });
  const toggleAllShown = () => toggleMany(shown, !allShownSelected);
  const groups = useMemo(() => groupByZone(shown), [shown]);
  const manyFloors = new Set(shown.map((r) => r.floorId)).size > 1;

  const run = async (label, fn) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  // After a download, remember it on the server so the label is no longer flagged New (for every admin).
  const markDownloaded = (ids) => {
    setDownloaded((old) => withDownloaded(old, ids));
    flaskRequest('/api/admin/desk-labels/downloads', { method: 'POST', body: { seat_ids: ids } }).catch(() => {});
  };
  const downloadOne = (row) => run(row.id, async () => {
    saveFile(await labelPng(row), labelFileNames([row])[0], 'image/png');
    markDownloaded([row.id]);
  });
  const downloadZip = () => run('zip', async () => {
    const names = labelZipPaths(chosen);
    const files = await Promise.all(chosen.map(async (r, i) => ({ name: names[i], data: await labelPng(r) })));
    saveFile(makeZip(files), `desk-labels-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
    markDownloaded(chosen.map((r) => r.id));
  });

  const title = <PageTitle title="Print Desk Labels"><p>QR labels for the seats of published floors. Stick each label on its desk; people scan it to check in.</p></PageTitle>;
  if (error && !rows) return <main className="page">{title}<Notice kind="error">{error}</Notice></main>;
  if (!rows) return <main className="page">{title}<Loading label="Loading desk labels..." /></main>;
  return <main className="page desk-labels">
    {title}
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
        <label>Labels <select value={filters.label} onChange={(e) => setFilter('label', e.target.value)}>
          <option value="all">All labels</option>
          <option value="new">New only (never downloaded)</option>
          <option value="downloaded">Downloaded</option>
        </select></label>
        <label>Search <input type="search" placeholder="Seat label" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} /></label>
      </section>
      <div className="labels-actions">
        <label className="labels-select-all"><input type="checkbox" checked={allShownSelected} disabled={!shown.length}
          onChange={toggleAllShown} />Select all shown ({shown.length})</label>
        <span className="muted">{chosen.length} selected</span>
        <button className="button primary" disabled={!chosen.length || Boolean(busy)} onClick={downloadZip}>
          {busy === 'zip' ? 'Making ZIP…' : `Download ${chosen.length || ''} as ZIP`}</button>
        {selected.size > 0 && <button className="button subtle" onClick={() => setSelected(new Set())}>Clear selection</button>}
      </div>
      {!shown.length ? <p className="state">No seats match these filters.</p>
        : groups.map((g) => {
          const picked = g.rows.filter((r) => selected.has(r.id)).length;
          const all = picked === g.rows.length;
          return <section key={g.key} className="qr-zone">
          <header className="qr-zone-head">
            <label className="labels-select-all"><input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = picked > 0 && !all; }}
              onChange={() => toggleMany(g.rows, !all)} aria-label={`Select all in ${g.zone ?? 'No zone'}`} />Select all in zone</label>
            <div className="qr-zone-title">
              <h2>{manyFloors && <span className="muted">{g.floorName} · </span>}{g.zone ?? 'No zone'}</h2>
              <span className="muted">{g.rows.length} label{g.rows.length === 1 ? '' : 's'}{picked ? ` · ${picked} selected` : ''}</span>
            </div>
          </header>
          <div className="qr-sheet">{g.rows.map((r) => <div key={r.id} className={`qr-label${selected.has(r.id) ? ' selected' : ''}`}>
          {isNewLabel(downloaded, r.id) && <span className="qr-new" title="This label has never been downloaded">New</span>}
          <label className="qr-check"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
            aria-label={`Select ${r.label}`} /></label>
          {images[r.id] ? <img src={images[r.id]} alt={`QR code for ${r.label}`} /> : <div className="qr-placeholder" />}
          <b title={downloadInfo[r.id] ? `Downloaded ${formatDateTime(downloadInfo[r.id].at)}${downloadInfo[r.id].by ? ` by ${downloadInfo[r.id].by}` : ''}` : 'Never downloaded'}>{r.label}</b><small>{r.floorName}{r.zone ? ` · ${r.zone}` : ''} · scan to check in</small>
          <button className="button subtle qr-download" disabled={busy === r.id} onClick={() => downloadOne(r)}>
            {busy === r.id ? 'Saving…' : 'Download PNG'}</button>
        </div>)}</div>
          </section>;
        })}
    </>}
  </main>;
}
