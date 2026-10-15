// Read-only floor plan for booking and check-in: published elements, seats coloured by state,
// initials of who is on (or booked for) each seat. Spec 2026-10-15-seat-booking-and-checkin §2.8.
import { footprint, initials, stateLabel } from './deskLogic.js';
import './desk.css';

export default function FloorView({ floor, selectedId, onSelect, cell = 30 }) {
  const catalog = Object.fromEntries((floor.catalog ?? []).map((c) => [c.type, c]));
  const seats = Object.fromEntries(floor.seats.map((s) => [s.id, s]));
  return <div className="desk-floor-wrap">
    <div className="desk-floor" style={{ width: floor.cols * cell, height: floor.rows * cell, '--cell': `${cell}px` }}>
      {floor.elements.map((el) => {
        const size = footprint(el);
        const style = { left: el.x * cell, top: el.y * cell, width: size.w * cell, height: size.h * cell };
        const seat = seats[el.id];
        if (!seat) {
          return <div key={el.id} className="desk-el" title={el.label || catalog[el.type]?.label}
            style={{ ...style, background: el.color || catalog[el.type]?.color || '#94a3b8' }} />;
        }
        const who = seat.occupant?.name ?? seat.booking?.booked_for?.name;
        const title = [el.label || seat.label, stateLabel(seat.state), who].filter(Boolean).join(' · ');
        return <button key={el.id} type="button" title={title} aria-label={title}
          className={`desk-seat state-${seat.state}${seat.open_to_all ? ' free-for-all' : ''}${selectedId === el.id ? ' selected' : ''}`}
          style={style} onClick={() => onSelect?.(seat)}>
          {who ? initials(who) : ''}
        </button>;
      })}
    </div>
    <ul className="desk-legend">
      <li><span className="state-available" />Available</li>
      <li><span className="state-booked" />Booked</li>
      <li><span className="state-occupied" />Occupied</li>
      <li><span className="state-not_bookable" />Not bookable</li>
      <li><span className="state-available free-for-all" />Free for all (bookable)</li>
    </ul>
  </div>;
}
