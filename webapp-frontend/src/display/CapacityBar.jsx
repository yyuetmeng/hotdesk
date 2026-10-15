// Capacity line for a floor or the whole display: counts plus a stacked bar.
export default function CapacityBar({ title, summary, large = false }) {
  const s = summary ?? { bookable: 0, available: 0, booked: 0, occupied: 0, occupancy_pct: 0 };
  const pct = (n) => (s.bookable ? (100 * n) / s.bookable : 0);
  return <div className={`disp-capacity${large ? ' large' : ''}`}>
    <div className="disp-capacity-head">
      <b>{title}</b>
      <span className="disp-pct">{s.occupancy_pct}% occupied</span>
    </div>
    <div className="disp-bar" role="img"
      aria-label={`${s.occupied} occupied, ${s.booked} booked, ${s.available} available of ${s.bookable} seats`}>
      <span className="occupied" style={{ width: `${pct(s.occupied)}%` }} />
      <span className="booked" style={{ width: `${pct(s.booked)}%` }} />
      <span className="available" style={{ width: `${pct(s.available)}%` }} />
    </div>
    <div className="disp-counts">
      <span><i className="available" />{s.available} available</span>
      <span><i className="booked" />{s.booked} booked</span>
      <span><i className="occupied" />{s.occupied} occupied</span>
      <span>{s.bookable} seats</span>
    </div>
  </div>;
}
