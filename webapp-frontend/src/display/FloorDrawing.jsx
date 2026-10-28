// Floor drawing used everywhere a floor is shown (TV display, Book a desk, Colleague Finder, previews).
// Architectural style (owner's reference, 2026-10-16): thin pale walls, blue windows in the walls, thin doors,
// wooden tables with monitor marks, rounded chairs coloured by state, plants that fit their cell, stairs with
// treads, toilet tiles with a male / female / all-gender icon, zones with a coloured top edge.
// Colours come from CSS variables (floor.css), so the drawing follows the light / dark theme.
import { footprint, initials, zoneCaption } from '../desk/deskLogic.js';
import { iconPath } from './icons.js';
import { useState } from 'react';
import { doorSwing, monitorMarks, plantRadius, plantSpots, plateSide, seatCells, seatTip, tableLabel, thinBar, toiletGender } from './displayLogic.js';
import { departmentColor } from '../floorplan/selection.js';
import './floor.css';

const C = 28;  // drawing units per grid cell
const ROOMS = new Set(['elevator', 'pantry']);

function Icon({ name, cx, cy, size, className = 'fd-icon', width = 2 }) {
  const d = iconPath(name);
  if (!d) return null;
  const k = size / 24;
  return <g transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${k})`} pointerEvents="none">
    <path d={d} className={className} fill="none" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
  </g>;
}

// Toilet pictogram: head, body (a dress for female), legs; k scales a ~20-unit-tall figure.
function Person({ cx, cy, k, female }) {
  return <g className="fd-person">
    <circle cx={cx} cy={cy - 9 * k} r={2.6 * k} />
    {female
      ? <path d={`M${cx - 2.4 * k} ${cy - 5.5 * k} L${cx + 2.4 * k} ${cy - 5.5 * k} L${cx + 5 * k} ${cy + 3 * k} L${cx - 5 * k} ${cy + 3 * k} Z`} />
      : <rect x={cx - 3.4 * k} y={cy - 5.5 * k} width={6.8 * k} height={8.5 * k} rx={1.2 * k} />}
    <rect x={cx - 2.6 * k} y={cy + 3 * k} width={1.8 * k} height={6 * k} />
    <rect x={cx + 0.8 * k} y={cy + 3 * k} width={1.8 * k} height={6 * k} />
  </g>;
}

function Plant({ cx, cy, r }) {
  return <g className="fd-plant">
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <ellipse key={a} cx={cx} cy={cy - r * 0.5} rx={r * 0.26} ry={r * 0.5}
      transform={`rotate(${a} ${cx} ${cy})`} />)}
    <circle cx={cx} cy={cy} r={r * 0.28} opacity=".75" />
  </g>;
}

function Element({ el, catalog }) {
  const { w, h } = footprint(el);
  const x = el.x * C, y = el.y * C, W = w * C, H = h * C, cx = x + W / 2, cy = y + H / 2;
  switch (el.type) {
    case 'wall':
      return <rect {...thinBar(x, y, W, H, 5)} rx="1.5" className="fd-wall" />;
    case 'window':
      return <rect {...thinBar(x, y, W, H, 5)} rx="1.5" className="fd-window" />;
    case 'door': {   // thin: each open door leaf from its hinge and a light dashed swing arc (editor: door swing setting)
      const { radius, leaves } = doorSwing(el, x, y, W, H);
      return <g className="fd-door">{leaves.map((d) => <g key={`${d.hinge}`}>
        <line x1={d.hinge[0]} y1={d.hinge[1]} x2={d.open[0]} y2={d.open[1]} strokeWidth="2.2" strokeLinecap="round" />
        <path d={`M ${d.open[0]} ${d.open[1]} A ${radius} ${radius} 0 0 ${d.sweep} ${d.shut[0]} ${d.shut[1]}`} fill="none" strokeWidth="1" strokeDasharray="3 3" opacity=".7" />
      </g>)}</g>;
    }
    case 'corridor':
      return <rect x={x} y={y} width={W} height={H} className="fd-corridor" />;
    case 'table': {   // its label (if any) runs along the long side, on a plate over the monitor marks
      const marks = monitorMarks(x, y, W, H, C);
      const name = tableLabel(el.label, Math.max(W, H));
      return <g>
        <rect x={x + 4} y={y + 3} width={W - 8} height={H - 6} rx="3" className="fd-table" />
        {marks.at.map((o) => (marks.vertical
          ? <g key={o} className="fd-monitor"><rect x={cx - 4} y={y + o - 5} width="2.2" height="10" rx="1" /><rect x={cx + 1.8} y={y + o - 5} width="2.2" height="10" rx="1" /></g>
          : <rect key={o} className="fd-monitor" x={x + o - 5} y={cy - 1.2} width="10" height="2.4" rx="1" />))}
        {name && <g transform={marks.vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>
          <rect x={cx - name.length * 2.6 - 3} y={cy - 6} width={name.length * 5.2 + 6} height="12" rx="2" className="fd-table-plate" />
          <text x={cx} y={cy + 3.2} textAnchor="middle" fontSize="9" fontWeight="600" className="fd-table-label">{name}</text>
        </g>}
      </g>;
    }
    case 'plant':   // one plant per cell, so a resized plant becomes a row or block of them
      return <g>{plantSpots(x, y, w, h, C).map(([px, py]) => <Plant key={`${px},${py}`} cx={px} cy={py} r={plantRadius(C, C)} />)}</g>;
    case 'stairs': {
      const treads = Math.max(Math.floor((H - 40) / 7), 0);
      return <g className="fd-stairs">
        <rect x={x + 3} y={y + 3} width={W - 6} height={H - 6} fill="none" strokeWidth="1.2" />
        <text x={cx} y={y + 17} textAnchor="middle" fontSize="9" className="fd-stairs-label">{el.label || 'Stairs'}</text>
        {Array.from({ length: treads }, (_, i) => <line key={i} x1={x + 6} x2={x + W - 6} y1={y + 30 + i * 7} y2={y + 30 + i * 7} strokeWidth=".6" opacity=".6" />)}
        <line x1={cx} x2={cx} y1={y + H - 10} y2={y + 32} strokeWidth="1.2" />
        <path d={`M${cx - 5} ${y + 38} L${cx} ${y + 31} L${cx + 5} ${y + 38}`} fill="none" strokeWidth="1.2" />
      </g>;
    }
    case 'toilet': {
      const gender = toiletGender(el);
      const k = Math.min(W, H) / 40;
      return <g>
        <rect x={x + 1} y={y + 1} width={W - 2} height={H - 2} className="fd-tile" />
        {gender === 'unisex'
          ? <><Person cx={x + W * 0.33} cy={cy} k={k * 0.85} female={false} /><Person cx={x + W * 0.67} cy={cy} k={k * 0.85} female /></>
          : <Person cx={cx} cy={cy} k={k} female={gender === 'female'} />}
      </g>;
    }
    case 'sofa': case 'locker':
      return <g><rect x={x + 2} y={y + 2} width={W - 4} height={H - 4} rx="5" className="fd-furniture" />
        <Icon name={el.type} cx={cx} cy={cy} size={Math.min(W, H) * 0.7} /></g>;
    default:
      if (ROOMS.has(el.type)) {
        const name = el.label || catalog[el.type]?.label || el.type;
        return <g><rect x={x + 1} y={y + 1} width={W - 2} height={H - 2} className="fd-tile" />
          <Icon name={el.type} cx={cx} cy={cy - Math.min(H, 40) * 0.18} size={Math.min(W, H, 56) * 0.5} />
          <text x={cx} y={cy + Math.min(H, 40) * 0.32} textAnchor="middle" fontSize="10" fontWeight="600" className="fd-room-label">{name}</text></g>;
      }
      return <g><rect x={x + 2} y={y + 2} width={W - 4} height={H - 4} rx="4" className="fd-furniture" />
        <Icon name={el.type} cx={cx} cy={cy} size={Math.min(W, H) * 0.6} /></g>;
  }
}

// A seat as a rounded chair in its project team's colour (free for all: grey), with a corner dot for its state:
// green available, orange booked, red occupied (with initials). Not bookable = faded and dashed. Selection ring and the Colleague Finder pulse are kept.
const DOTTED = new Set(['available', 'booked', 'occupied']);

// Dark or white text, whichever reads on this #rrggbb fill.
function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? '#0f172a' : '#fff';
}

function seatBox(el) {
  const { w, h } = footprint(el);
  return { cx: (el.x + w / 2) * C, cy: (el.y + h / 2) * C, s: Math.min(w, h) * C * 0.66 };
}

function Seat({ el, seat, onClick, selected, highlight, onHover, note = null }) {
  const { cx, cy, s } = seatBox(el);
  const who = seat.occupant?.name ?? seat.booking?.booked_for?.name;
  const base = [seat.label, seat.department, who].filter(Boolean).join(' · ');
  const label = note ? `${base}. ${note.tip.join('. ')}` : base;
  const ring = (cls, pad, extra = {}) => <rect className={cls} x={cx - s / 2 - pad} y={cy - s / 2 - pad} width={s + pad * 2} height={s + pad * 2}
    rx={6 + pad / 2} fill="none" {...extra} />;
  const show = () => onHover?.({ seat, cx, top: cy - s / 2, bottom: cy + s / 2, lines: note?.tip });
  const hide = () => onHover?.(null);
  // Seat assignments colour assigned seats by their own key (green / amber / red), not by team.
  const team = DOTTED.has(seat.state) && seat.department_id && !seat.open_to_all && !note
    ? departmentColor(seat.department_id, seat.team_color) : null;
  return <g className={`disp-seat${highlight ? ' is-found' : ''}`} onClick={() => onClick?.(seat)} role="button" tabIndex={0} aria-label={label}
    onKeyDown={(e) => { if (e.key === 'Enter') onClick?.(seat); }} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
    {selected && ring('fd-selected', 4, { strokeWidth: 3 })}
    {highlight && <>{ring('disp-found-ring fd-found', 3, { strokeWidth: 3.5 })}{ring('disp-found-ring late fd-found', 3, { strokeWidth: 3.5 })}</>}
    <rect className={`fd-chair state-${seat.state}${seat.open_to_all ? ' ffa' : ''}${note ? ` assign-${note.tone}` : ''}`} x={cx - s / 2} y={cy - s / 2} width={s} height={s} rx="5"
      style={team ? { fill: team } : undefined} />
    {who
      ? <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={s * 0.48} fontWeight="800" className="fd-initials"
        style={team ? { fill: inkOn(team) } : undefined}>{initials(who)}</text>
      : <rect className="fd-chair-back" x={cx - s * 0.28} y={cy - s * 0.28} width={s * 0.56} height={s * 0.56} rx="2.5" fill="none" />}
    {DOTTED.has(seat.state) && <circle className={`fd-dot dot-${seat.state}`} cx={cx + s / 2 - 1} cy={cy - s / 2 + 1} r={s * 0.2} />}
  </g>;
}

// Assignment plate (first name and end date) for the seat assignments page. Drawn in its own layer after every seat,
// so a neighbouring chair never paints over it. The side comes from the grid (plateSide): right, left, or below /
// above the chair on a crowded row.
const PLATE_H = 22;
function AssignmentPlate({ el, note, side, width }) {
  const { cx, cy, s } = seatBox(el);
  const plateW = Math.max(note.name.length * 5.4, note.date.length * 4.8) + 8;
  const sideways = side === 'right' || side === 'left';
  const rawX = side === 'right' ? cx + s / 2 + 2 : side === 'left' ? cx - s / 2 - 2 - plateW : cx - plateW / 2;
  const x = Math.max(0, Math.min(rawX, width - plateW));
  const y = sideways ? cy - PLATE_H / 2 : side === 'below' ? cy + s / 2 + 2 : cy - s / 2 - 2 - PLATE_H;
  return <g pointerEvents="none">
    <rect x={x} y={y} width={plateW} height={PLATE_H} rx="3" className="fd-assign-plate" />
    <text x={x + plateW / 2} y={y + 9.5} textAnchor="middle" fontSize="9" fontWeight="600" className="fd-assign-text">{note.name}</text>
    {note.date && <text x={x + plateW / 2} y={y + 19} textAnchor="middle" fontSize="8" className="fd-assign-text">{note.date}</text>}
  </g>;
}

// All plates, after every seat. Sides are read from where the seats are on the grid, not from the text width.
function Plates({ elements, seats, notes, cols, rows }) {
  const seatEls = elements.filter((el) => el.type === 'seat');
  const rect = (el) => ({ x: el.x, y: el.y, ...footprint(el) });
  const cells = seatCells(seatEls.map(rect));
  return seatEls.filter((el) => seats[el.id] && notes[el.id]).map((el) => <AssignmentPlate key={`${el.id}-plate`} el={el} note={notes[el.id]}
    side={plateSide(rect(el), cells, cols, rows)} width={cols * C} />);
}

// Project team colours on these seats, then Free for all (grey), for the bottom-left legend. `as`: the item tag.
export function TeamKeys({ seats, as: Item = 'span' }) {
  const teams = new Map();
  seats.filter((s) => s.department_id && !s.open_to_all).forEach((s) => teams.set(s.department_id,
    { name: s.department ?? 'Project team', color: departmentColor(s.department_id, s.team_color) }));
  const sorted = [...teams.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  return <>
    {sorted.map(([id, t]) => <Item key={id}><SeatKey color={t.color} />{t.name}</Item>)}
    {seats.some((s) => s.open_to_all) && <Item><SeatKey />Free for all</Item>}
  </>;
}

// Legend key: the same chair as Seat, drawn small, so the legend matches the floor. `color`: a team key, no dot.
export function SeatKey({ state = 'team', color = null }) {
  return <svg className="fd fd-key" viewBox="0 0 24 24" aria-hidden="true">
    <rect className={`fd-chair state-${state}`} x="3" y="3" width="18" height="18" rx="4" style={color ? { fill: color } : undefined} />
    <rect className="fd-chair-back" x="7" y="7" width="10" height="10" rx="2" fill="none" />
    {DOTTED.has(state) && <circle className={`fd-dot dot-${state}`} cx="20" cy="4" r="3.6" />}
  </svg>;
}

// Zone: tinted area with a coloured top edge (drawn under everything else).
function ZoneOutline({ zone }) {
  const color = zone.color || '#3b82f6';
  const x = zone.x * C + 2, y = zone.y * C + 2, W = zone.w * C - 4, H = zone.h * C - 4;
  return <g pointerEvents="none">
    <rect x={x} y={y} width={W} height={H} rx="5" fill={color} fillOpacity="0.07" stroke={color} strokeOpacity="0.35" />
    <rect x={x} y={y} width={W} height="3" rx="1.5" fill={color} />
  </g>;
}

// Zone name and "N of M free" as a tab sitting on the zone's top edge, outside the zone, so it never
// covers a seat. The drawing keeps room above the grid (LABEL_SPACE) for zones in the first row.
const LABEL_SPACE = 22;
function ZoneLabel({ zone }) {
  const x = zone.x * C + 2, y = zone.y * C + 2, color = zone.color || '#3b82f6';
  const caption = zoneCaption(zone);
  const nameW = zone.name.length * 7.2;
  const width = Math.min(zone.w * C - 4, nameW + (caption ? caption.length * 5.6 + 14 : 0) + 14);
  return <g pointerEvents="none">
    <rect x={x} y={y - 18} width={width} height="18" rx="4" className="fd-label-plate" />
    <text x={x + 7} y={y - 5} fontSize="11.5" fontWeight="700" className="fd-zone-name">{zone.name}</text>
    {caption && <text x={x + 7 + nameW + 8} y={y - 5} fontSize="9.5" fontWeight="600" fill={color}>{caption}</text>}
  </g>;
}

// Hover / keyboard-focus tip over a seat (owner 2026-10-16): seat number and team, then who and when. Drawn in the
// SVG above everything, kept inside the drawing, flipped below the seat when there is no room above.
function SeatTip({ tip, width, top }) {
  const [a, b] = tip.lines ?? seatTip(tip.seat);
  const w = Math.max(a.length * 6.3, b.length * 5.7) + 18, h = 36;
  const x = Math.min(Math.max(tip.cx - w / 2, 2), width - w - 2);
  const above = tip.top - h - 6;
  const y = above >= -top + 2 ? above : tip.bottom + 6;
  return <g className="fd-tip" pointerEvents="none">
    <rect x={x} y={y} width={w} height={h} rx="6" />
    <text x={x + 9} y={y + 15} fontSize="11" fontWeight="700" className="fd-tip-head">{a}</text>
    <text x={x + 9} y={y + 29} fontSize="10">{b}</text>
  </g>;
}

export default function FloorDrawing({ floor, onSeatClick, selectedId = null, selectedIds = [], highlightId = null, notes = null }) {
  const catalog = Object.fromEntries((floor.catalog ?? []).map((c) => [c.type, c]));
  const seats = Object.fromEntries(floor.seats.map((s) => [s.id, s]));
  const order = (el) => (el.type === 'corridor' ? 0 : el.type === 'seat' ? 3 : ['wall', 'window', 'door'].includes(el.type) ? 2 : 1);
  const elements = floor.elements.filter((el) => el.type !== 'zone').sort((a, b) => order(a) - order(b));
  const top = floor.zones?.length ? LABEL_SPACE : 0;
  const [tip, setTip] = useState(null);
  return <svg className="disp-floor fd" viewBox={`0 ${-top} ${floor.cols * C} ${floor.rows * C + top}`} preserveAspectRatio="xMidYMid meet">
    <rect y={-top} width={floor.cols * C} height={floor.rows * C + top} className="fd-bg" />
    {(floor.zones ?? []).map((z) => <ZoneOutline key={z.id} zone={z} />)}
    {elements.map((el) => (el.type === 'seat' && seats[el.id]
      ? <Seat key={el.id} el={el} seat={seats[el.id]} onClick={onSeatClick} selected={el.id === selectedId || selectedIds.includes(el.id)} highlight={el.id === highlightId} onHover={setTip}
        note={notes?.[el.id] ?? null} />
      : <Element key={el.id} el={el} catalog={catalog} />))}
    {notes && <Plates elements={elements} seats={seats} notes={notes} cols={floor.cols} rows={floor.rows} />}
    {(floor.zones ?? []).map((z) => <ZoneLabel key={`${z.id}-label`} zone={z} />)}
    {tip && <SeatTip tip={tip} width={floor.cols * C} top={top} />}
  </svg>;
}
