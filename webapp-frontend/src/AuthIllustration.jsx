// Sign-in illustration: a small live floor (seats coloured by state, two tables) with a floating
// "Checked in" card. Deliberately different from the pin-drop page loader. Decorative only.
const SEATS = [
  // [x, y, state]  around two tables; a few seats slowly change state (class "swap-*")
  [70, 52, 'free'], [118, 52, 'busy'], [166, 52, 'free swap-a'], [214, 52, 'booked'],
  [70, 140, 'booked'], [118, 140, 'free'], [166, 140, 'busy swap-b'], [214, 140, 'free'],
  [300, 52, 'busy'], [348, 52, 'free swap-b'], [300, 140, 'free'], [348, 140, 'booked swap-a'],
];

export default function AuthIllustration() {
  return <div className="auth-illus" aria-hidden="true">
    <svg viewBox="0 0 420 200" className="auth-illus-floor">
      <rect x="1" y="1" width="418" height="198" rx="14" className="auth-illus-room" />
      <rect x="50" y="80" width="184" height="40" rx="8" className="auth-illus-table" />
      <rect x="282" y="80" width="84" height="40" rx="8" className="auth-illus-table" />
      <text x="20" y="28" className="auth-illus-zone">AI LAB</text>
      <line x1="262" y1="20" x2="262" y2="180" className="auth-illus-wall" />
      {SEATS.map(([x, y, state], i) => <circle key={i} cx={x} cy={y} r="13" className={`auth-illus-seat ${state}`} />)}
    </svg>
    <div className="auth-illus-toast">
      <span className="auth-illus-check">✓</span>
      <div><b>Checked in · A3</b><small>AI Lab · since 09:02</small></div>
    </div>
    <ul className="auth-illus-legend">
      <li><i className="free" />Available</li><li><i className="booked" />Booked</li><li><i className="busy" />Occupied</li>
    </ul>
  </div>;
}
