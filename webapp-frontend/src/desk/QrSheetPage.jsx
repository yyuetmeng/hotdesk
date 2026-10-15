// Printable QR labels for every seat of a published plan (/floor-plans/:id/qr, admins).
// Each QR encodes only the seat link; checking in still requires signing in.
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import './desk.css';

export function QrSheetPage() {
  const { id } = useParams();
  const [labels, setLabels] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const pub = await flaskRequest(`/api/admin/floor-plans/${id}/published`);
        setName(pub.name);
        const seats = pub.elements.filter((el) => el.type === 'seat');
        setLabels(await Promise.all(seats.map(async (el) => ({
          id: el.id,
          label: el.label || `Seat ${el.x},${el.y}`,
          src: await QRCode.toDataURL(`${window.location.origin}/checkin/${el.id}`, { margin: 1, width: 320 }),
        }))));
      } catch (err) {
        setError(err.status === 404 ? 'Publish this floor plan first: QR codes are made from the published version.' : err.message);
      }
    })();
  }, [id]);

  if (error) return <main className="page"><PageTitle title="Seat QR codes" /><Notice kind="error">{error}</Notice></main>;
  if (!labels) return <main className="page"><Loading label="Making QR codes..." /></main>;
  return <main className="page">
    <PageTitle title={`Seat QR codes · ${name}`} />
    <div className="qr-toolbar button-row">
      <button className="button primary" onClick={() => window.print()}>Print</button>
      <Link className="button" to={`/floor-plans/${id}`}>Back to editor</Link>
      <span className="muted">{labels.length} seats · print on A4 and stick each label on its desk.</span>
    </div>
    <div className="qr-sheet">{labels.map((l) => <div key={l.id} className="qr-label">
      <img src={l.src} alt={`QR code for ${l.label}`} />
      <b>{l.label}</b><small>{name} · scan to check in</small>
    </div>)}</div>
  </main>;
}
