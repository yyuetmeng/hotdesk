// Preview of a floor plan draft as staff will see it (Book a desk / floor display drawing), in a pop-up.
// `floor` comes from previewFloor() in logic.js: every tagged seat shows as available.
import { useEffect } from 'react';
import CapacityBar from '../display/CapacityBar.jsx';
import FloorDrawing from '../display/FloorDrawing.jsx';
import '../display/display.css';

export default function FloorPreview({ floor, note, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="display-preview" role="dialog" aria-modal="true" aria-label={`Preview of ${floor.name}`} onClick={onClose}>
    <div className="display-preview-frame" onClick={(e) => e.stopPropagation()}>
      <div className="display-preview-bar">
        <span><b>Preview · {floor.name}</b> · {note}</span>
        <button type="button" className="button" onClick={onClose} autoFocus>Close</button>
      </div>
      <div className="display-preview-body">
        <main className="disp">
          <div className="disp-top"><section className="disp-summary"><CapacityBar title={floor.name} summary={floor.summary} /></section></div>
          <section className="disp-floors layout-rotate"><article className="disp-floor-card"><FloorDrawing floor={floor} /></article></section>
          <footer className="disp-foot"><div className="disp-legend">
            <span><i className="available" />Available</span><span><i className="not_bookable" />Not bookable (no project team)</span>
          </div></footer>
        </main>
      </div>
    </div>
  </div>;
}
