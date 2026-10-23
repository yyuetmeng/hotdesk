// Scan to check in (owner 2026-10-16), the raised middle button of the mobile bottom bar: opens the back camera and
// shows a small square frame with a laser bar sweeping up and down (option A of preview scan-styles-v3);
// reads desk labels; a seat code goes straight to that seat's check-in (/checkin/<id>, which checks in).
// Uses the browser's BarcodeDetector where it exists (Chrome, Android) and the jsQR library otherwise (Safari on
// iPhone). Cameras only work on HTTPS (or localhost); without one the page says so (checking in needs a scan).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageTitle } from '../components.jsx';
import { seatFromCode } from './scanLogic.js';
import './desk.css';

const TEXT = {
  starting: 'Starting the camera…',
  scanning: 'Point the camera at the QR code on the desk.',
  denied: 'Camera access was not allowed. Allow the camera for this site in your browser settings, then try again.',
  unsupported: 'The camera is not available here (it needs a secure https:// address and a device with a camera).',
};

export function ScanPage() {
  const video = useRef(null);
  const navigate = useNavigate();
  const [state, setState] = useState('starting');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let alive = true, stream = null, timer = null, detector = null, jsQR = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const stop = () => { clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };

    const read = async (v) => {
      if (detector) {
        try { return (await detector.detect(v))[0]?.rawValue ?? null; } catch { detector = null; }
      }
      jsQR ??= (await import('jsqr')).default;          // loaded only when the browser has no QR reader of its own
      const scale = Math.min(1, 640 / v.videoWidth);
      canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (err) {
        setState(err?.name === 'NotAllowedError' ? 'denied' : 'unsupported');
        return;
      }
      if (!alive) { stop(); return; }
      const v = video.current;
      v.srcObject = stream;
      await v.play().catch(() => {});
      if ('BarcodeDetector' in window) {
        try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
      }
      setState('scanning');
      const tick = async () => {
        if (!alive) return;
        if (v.readyState >= 2 && v.videoWidth) {
          const text = await read(v).catch(() => null);
          const seat = text && seatFromCode(text);
          if (seat) { alive = false; stop(); navigate(`/checkin/${seat}`, { state: { scanned: true } }); return; }
          if (text) setNotice('That QR code is not a Hot Desk seat label. Scan the label on the desk.');
        }
        timer = setTimeout(tick, 150);                  // about 7 looks a second
      };
      tick();
    })();
    return () => { alive = false; stop(); };
  }, [navigate]);

  return <main className="page desk-scan">
    <PageTitle title="Scan to check in"><p>Scan the QR code on a desk to check in there.</p></PageTitle>
    <div className={`desk-scan-frame${state === 'scanning' ? ' live' : ''}`}>
      <video ref={video} muted playsInline aria-label="Camera" />
      {state === 'scanning' && <span className="desk-scan-target" aria-hidden="true"><span className="desk-scan-bar" /></span>}
    </div>
    <p className={state === 'denied' || state === 'unsupported' ? 'desk-scan-msg bad' : 'desk-scan-msg'} role="status">{TEXT[state]}</p>
    {notice && state === 'scanning' && <p className="desk-scan-msg warn">{notice}</p>}
    <p className="muted">Checking in needs a scan of the desk's QR code. To plan ahead, <Link to="/book">book a desk</Link>.</p>
  </main>;
}
