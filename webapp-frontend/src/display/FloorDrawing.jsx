// Style "E" floor drawing for the public display: architectural walls, door swings, glass windows,
// furniture and rooms with icons, seats as state circles with a chair icon or the person's initials.
// Spec: docs/superpowers/specs/2026-10-15-floor-dashboard-design.md §3.
import { footprint, initials, zoneCaption } from '../desk/deskLogic.js';
import { iconPath } from './icons.js';
import { thinBar } from './displayLogic.js';

const C = 28;  // drawing units per grid cell
const STATE_FILL = { available: '#16a34a', booked: '#f59e0b', occupied: '#dc2626', not_bookable: '#94a3b8' };
const ROOMS = new Set(['toilet', 'stairs', 'elevator', 'pantry']);

function Icon({ name, cx, cy, size, color, width = 2 }) {
  const d = iconPath(name);
  if (!d) return null;
  const k = size / 24;
  return <g transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${k})`} pointerEvents="none">
    <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
  </g>;
}

function Element({ el, catalog }) {
  const { w, h } = footprint(el);
  const x = el.x * C, y = el.y * C, W = w * C, H = h * C, cx = x + W / 2, cy = y + H / 2;
  const color = el.color || catalog[el.type]?.color || '#64748b';
  switch (el.type) {
    case 'wall':   // thin line along its run, not a filled block
      return <rect {...thinBar(x, y, W, H, 6)} rx="1.5" fill="#334155" />;
    case 'window': // thin glass pane: light fill with a blue edge
      return <rect {...thinBar(x, y, W, H, 6)} rx="1.5" fill="#e0f2fe" stroke="#38bdf8" strokeWidth="1.5" />;
    case 'door':
      return <g fill="none" stroke="#b45309" strokeWidth="1.5">
        <path d={`M ${x} ${y + H} A ${W} ${H} 0 0 1 ${x + W} ${y}`} />
        <line x1={x + W} y1={y} x2={x + W} y2={y + H} strokeWidth="2.5" /></g>;
    case 'corridor':
      return <rect x={x} y={y} width={W} height={H} fill="#f1f5f9" />;
    case 'table':
      return <rect x={x + 3} y={y + 3} width={W - 6} height={H - 6} rx="4" fill="#e7c9a0" stroke="#a16207" />;
    case 'plant':
      return <Icon name="plant" cx={cx} cy={cy} size={Math.min(W, H) * 0.8} color="#16a34a" />;
    case 'sofa': case 'locker':
      return <g><rect x={x + 2} y={y + 2} width={W - 4} height={H - 4} rx="5" fill="#fff" stroke={color} strokeWidth="1.5" />
        <Icon name={el.type} cx={cx} cy={cy} size={Math.min(W, H) * 0.7} color={color} /></g>;
    default:
      if (ROOMS.has(el.type)) {
        const name = el.label || catalog[el.type]?.label || el.type;
        return <g><rect x={x + 1} y={y + 1} width={W - 2} height={H - 2} rx="6" fill="#fff" stroke={color} strokeWidth="1.5" />
          <Icon name={el.type} cx={cx} cy={cy - Math.min(H, 40) * 0.18} size={Math.min(W, H, 56) * 0.5} color={color} />
          <text x={cx} y={cy + Math.min(H, 40) * 0.32} textAnchor="middle" fontSize="10" fontWeight="600" fill={color}>{name}</text></g>;
      }
      return <g><rect x={x + 2} y={y + 2} width={W - 4} height={H - 4} rx="4" fill="#fff" stroke={color} />
        <Icon name={el.type} cx={cx} cy={cy} size={Math.min(W, H) * 0.6} color={color} /></g>;
  }
}

function Seat({ el, seat, onClick, selected }) {
  const { w, h } = footprint(el);
  const cx = (el.x + w / 2) * C, cy = (el.y + h / 2) * C, r = Math.min(w, h) * C * 0.42;
  const who = seat.occupant?.name ?? seat.booking?.booked_for?.name;
  const label = [seat.label, seat.department, who].filter(Boolean).join(' · ');
  return <g className="disp-seat" onClick={() => onClick?.(seat)} role="button" tabIndex={0} aria-label={label}
    onKeyDown={(e) => { if (e.key === 'Enter') onClick?.(seat); }}>
    <title>{label}</title>
    {selected && <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="#2563eb" strokeWidth="3" />}
    <circle cx={cx} cy={cy} r={r} fill={STATE_FILL[seat.state] ?? '#94a3b8'} stroke={seat.open_to_all ? '#0f172a' : '#fff'} strokeWidth="2" />
    {who
      ? <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={r * 0.85} fontWeight="700" fill="#fff">{initials(who)}</text>
      : <Icon name="seat" cx={cx} cy={cy} size={r * 1.15} color="#fff" width={2.4} />}
  </g>;
}

// Zone outline with its name and "N of M free" (spec 2026-10-15-floor-zones §5); drawn under everything else.
function ZoneOutline({ zone }) {
  const color = zone.color || '#3b82f6';
  return <rect x={zone.x * C + 2} y={zone.y * C + 2} width={zone.w * C - 4} height={zone.h * C - 4} rx="6"
    fill={color} fillOpacity="0.06" stroke={color} strokeWidth="2" pointerEvents="none" />;
}

// Drawn after the seats so a seat in the zone's corner cannot hide the name; taps pass through.
function ZoneLabel({ zone }) {
  const x = zone.x * C, y = zone.y * C, color = zone.color || '#3b82f6';
  const caption = zoneCaption(zone);
  const width = Math.min(zone.w * C - 8, Math.max(zone.name.length * 8.2, caption.length * 6.2) + 14);
  return <g pointerEvents="none">
    <rect x={x + 4} y={y + 4} width={width} height={caption ? 36 : 22} rx="4" fill="#f8fafc" fillOpacity="0.9" />
    <text x={x + 10} y={y + 19} fontSize="14" fontWeight="700" fill="#0f172a">{zone.name}</text>
    {caption && <text x={x + 10} y={y + 34} fontSize="11" fontWeight="600" fill={color}>{caption}</text>}
  </g>;
}

export default function FloorDrawing({ floor, onSeatClick, selectedId = null }) {
  const catalog = Object.fromEntries((floor.catalog ?? []).map((c) => [c.type, c]));
  const seats = Object.fromEntries(floor.seats.map((s) => [s.id, s]));
  const order = (el) => (el.type === 'corridor' ? 0 : el.type === 'seat' ? 3 : ['wall', 'window', 'door'].includes(el.type) ? 2 : 1);
  const elements = floor.elements.filter((el) => el.type !== 'zone').sort((a, b) => order(a) - order(b));
  return <svg className="disp-floor" viewBox={`0 0 ${floor.cols * C} ${floor.rows * C}`} preserveAspectRatio="xMidYMid meet">
    <rect width={floor.cols * C} height={floor.rows * C} fill="#f8fafc" />
    {(floor.zones ?? []).map((z) => <ZoneOutline key={z.id} zone={z} />)}
    {elements.map((el) => (el.type === 'seat' && seats[el.id]
      ? <Seat key={el.id} el={el} seat={seats[el.id]} onClick={onSeatClick} selected={el.id === selectedId} />
      : <Element key={el.id} el={el} catalog={catalog} />))}
    {(floor.zones ?? []).map((z) => <ZoneLabel key={`${z.id}-label`} zone={z} />)}
  </svg>;
}
