'use strict';
/*
 * Floor-plan geometry and SVG drawing for the dashboard.
 *
 * Seats keep the row/column they get from each zone's `map` in config/building.json;
 * this file only decides how to draw them. Touching desks form a table: a bank two
 * desks wide becomes a shared table with a workstation on each side, a bank one desk
 * wide a bench desk, and a single row of three or more a counter with seats along it.
 *
 * Each seat is drawn as a workstation: its own segment of the table with a monitor, an
 * office chair, and a status light on the desk once it is taken (none while free).
 * Furniture is neutral; status is colour; selection turns the chair itself blue.
 *
 * A floor may also carry a `plan` (outline, walls, windows, doors, rooms, fixtures,
 * plants and a box per zone, all in plan units of roughly 10 cm). Without one, zones
 * are laid out side by side on a plain floor; nothing architectural is invented.
 *
 * No DOM access here, so the layout can be tested in Node (test/floorplan.test.js).
 */
const FloorPlan = (() => {
  const CHAIR = 3.6;       // chair footprint (square cell)
  const DESK = 2.6;        // depth of one workstation's desk
  const PAIR = DESK * 2;   // shared table: two desks back to back
  const BENCH = DESK + 0.2;
  const ROW_GAP = 1.8;     // between chairs along a table
  const BLANK = 3.4;       // an empty map row: a cross aisle
  const SPACE = 6;         // an empty map column: an aisle between tables
  const SIDE_GAP = 0.8;    // between chairs side by side without a table between
  const COUNTER = 2.8;     // depth of a counter in front of a row of chairs
  const OVERHANG = 0.6;    // table beyond the first and last chair
  const LABEL = 5.6;       // zone label strip: name, then free count
  const PAD = 2.6;         // padding inside a zone
  const KIND = { pair: 'Shared table', single: 'Bench desk', counter: 'Counter seat' };

  const r1 = (n) => Math.round(n * 100) / 100;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** Groups of touching desks, each as rectangles: the whole group if it is one, else one per row run. */
  function deskRects(seats) {
    const at = new Map(seats.map((s) => [`${s.row},${s.col}`, s]));
    const seen = new Set();
    const rects = [];
    for (const s of seats) {
      if (seen.has(`${s.row},${s.col}`)) continue;
      const group = [];
      const stack = [s];
      seen.add(`${s.row},${s.col}`);
      while (stack.length) {
        const c = stack.pop();
        group.push(c);
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${c.row + dr},${c.col + dc}`;
          if (at.has(k) && !seen.has(k)) { seen.add(k); stack.push(at.get(k)); }
        }
      }
      const rows = group.map((g) => g.row), cols = group.map((g) => g.col);
      const rect = { r0: Math.min(...rows), r1: Math.max(...rows), c0: Math.min(...cols), c1: Math.max(...cols) };
      if ((rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1) === group.length) { rects.push(rect); continue; }
      const byRow = new Map();
      for (const g of group) byRow.set(g.row, [...(byRow.get(g.row) ?? []), g.col].sort((a, b) => a - b));
      for (const [row, list] of byRow) {
        let start = list[0];
        list.forEach((col, i) => {
          if (list[i + 1] !== col + 1) { rects.push({ r0: row, r1: row, c0: start, c1: col }); start = list[i + 1]; }
        });
      }
    }
    return rects;
  }

  /**
   * Lay out one zone's seats in zone-local plan units.
   *
   * Tables: { kind, x, y, w, h, seats, dividers: [y or x], spine: x | null }.
   * Seats:  { id, x, y (chair cell), side ('left' | 'right' | 'bottom': where the chair
   *           sits relative to its desk), desk {x,y,w,h}, monitor {x,y,w,h},
   *           light [x,y], label [x,y], kind, tableSeats }.
   */
  function layoutZone(seats) {
    if (!seats.length) return { w: 0, h: 0, tables: [], seats: [], plants: [] };
    const maxRow = Math.max(...seats.map((s) => s.row));
    const maxCol = Math.max(...seats.map((s) => s.col));
    const deskRows = new Set(seats.map((s) => s.row));
    const deskCols = new Set(seats.map((s) => s.col));

    const banks = [];
    for (const r of deskRects(seats)) {
      const w = r.c1 - r.c0 + 1, h = r.r1 - r.r0 + 1;
      if (h === 1 && w >= 3) { banks.push({ kind: 'counter', ...r }); continue; }
      for (let c = r.c0; c <= r.c1; c += 2) {
        banks.push(c + 1 <= r.c1 ? { kind: 'pair', r0: r.r0, r1: r.r1, c0: c, c1: c + 1 } : { kind: 'single', r0: r.r0, r1: r.r1, c0: c, c1: c });
      }
    }

    // Column positions: a table sits after the first chair of a pair or bench.
    const tableAfter = new Map(banks.filter((b) => b.kind !== 'counter').map((b) => [b.c0, b.kind === 'pair' ? PAIR : BENCH]));
    const colX = [];
    let x = 0;
    for (let c = 0; c <= maxCol; c++) {
      colX[c] = x;
      x += deskCols.has(c) ? CHAIR : SPACE;
      if (tableAfter.has(c)) x += tableAfter.get(c);
      else if (deskCols.has(c) && deskCols.has(c + 1)) x += SIDE_GAP;
    }
    const w = x;

    // Row positions: a counter needs room in front of its chairs.
    const counterRows = new Set(banks.filter((b) => b.kind === 'counter').map((b) => b.r0));
    const rowY = [];
    let y = 0;
    for (let r = 0; r <= maxRow; r++) {
      if (counterRows.has(r)) y += COUNTER;
      rowY[r] = y;
      y += (deskRows.has(r) ? CHAIR : BLANK) + ROW_GAP;
    }
    const h = y - ROW_GAP;

    const at = new Map(seats.map((s) => [`${s.row},${s.col}`, s]));
    const tables = [], placed = [], plants = [];
    for (const b of banks) {
      if (b.kind === 'counter') {
        const tx = colX[b.c0] - 0.4, tw = colX[b.c1] + CHAIR + 0.4 - tx, ty = rowY[b.r0] - COUNTER;
        const row = [];
        for (let c = b.c0; c <= b.c1; c++) if (at.has(`${b.r0},${c}`)) row.push(at.get(`${b.r0},${c}`));
        const seg = tw / row.length;
        tables.push({ kind: 'counter', x: r1(tx), y: r1(ty), w: r1(tw), h: COUNTER, seats: row.length, spine: null,
          dividers: row.slice(1).map((_, i) => r1(tx + seg * (i + 1))) });
        // Seats are spread evenly along the counter.
        row.forEach((s, i) => {
          const cx = tx + seg * (i + 0.5);
          placed.push({
            id: s.id, x: r1(cx - CHAIR / 2), y: r1(rowY[b.r0]), side: 'bottom', kind: KIND.counter, tableSeats: row.length,
            desk: { x: r1(tx + seg * i), y: r1(ty), w: r1(seg), h: COUNTER },
            monitor: { x: r1(cx - 1.2), y: r1(ty + 0.3), w: 2.4, h: 0.36 },
            light: [r1(cx), r1(ty + COUNTER * 0.62)], label: [r1(cx + 1.75), r1(ty + COUNTER * 0.62)],
          });
        });
        continue;
      }
      const depth = b.kind === 'pair' ? PAIR : BENCH;
      const tx = colX[b.c0] + CHAIR, ty = rowY[b.r0] - OVERHANG;
      const th = rowY[b.r1] + CHAIR + OVERHANG - ty;
      const dividers = [];
      const first = placed.length;
      let count = 0;
      for (let r = b.r0; r <= b.r1; r++) {
        const top = r === b.r0 ? ty : rowY[r] - ROW_GAP / 2;
        const bottom = r === b.r1 ? ty + th : rowY[r] + CHAIR + ROW_GAP / 2;
        if (r < b.r1) dividers.push(r1(bottom));
        const cy = rowY[r] + CHAIR / 2;
        for (let c = b.c0; c <= b.c1; c++) {
          const s = at.get(`${r},${c}`);
          if (!s) continue;
          count++;
          const left = c === b.c0;
          // A left seat's desk is the near half of the table; its monitor faces it from the far edge.
          const dx = left ? tx : tx + DESK;
          const dw = b.kind === 'pair' ? DESK : BENCH;
          const monX = left ? tx + dw - 0.62 : tx + DESK + 0.26;
          const lightX = left ? tx + dw * 0.4 : tx + DESK + DESK * 0.6;
          placed.push({
            id: s.id, x: r1(colX[c]), y: r1(rowY[r]), side: left ? 'left' : 'right', kind: KIND[b.kind], tableSeats: 0,
            desk: { x: r1(dx), y: r1(top), w: r1(dw), h: r1(bottom - top) },
            monitor: { x: r1(monX), y: r1(cy - 1.2), w: 0.36, h: 2.4 },
            light: [r1(lightX), r1(cy)], label: [r1(lightX), r1(cy + 1.75)],
          });
        }
        // A small plant on shared tables between workstations, as on the reference plan.
        if (b.kind === 'pair' && r < b.r1 && (r - b.r0) % 2 === 0) plants.push([r1(tx + DESK), r1(bottom)]);
      }
      for (const p of placed.slice(first)) p.tableSeats = count;
      tables.push({ kind: b.kind, x: r1(tx), y: r1(ty), w: r1(depth), h: r1(th), seats: count, dividers, spine: b.kind === 'pair' ? r1(tx + DESK) : null });
    }
    return { w: r1(w), h: r1(h), tables, seats: placed, plants };
  }

  /**
   * Lay out a floor: each zone's tables inside its box from `plan.zones`, or side by
   * side when the floor has no plan. Zones without a box go in a strip below the plan.
   */
  function layoutFloor(floor, seats, plan) {
    const zones = floor.zones.map((z) => {
      const layout = layoutZone(seats.filter((s) => s.floor === floor.id && s.zone === z.id));
      return { id: z.id, name: z.name, layout, need: { w: layout.w + 2 * PAD, h: layout.h + LABEL + 2 * PAD } };
    });
    const hasPlan = Boolean(plan && plan.width > 0 && plan.height > 0);
    let W = hasPlan ? plan.width : 0, H = hasPlan ? plan.height : 0;
    let cursor = 4, stripY = hasPlan ? plan.height + 6 : 4, stripH = 0;
    for (const z of zones) {
      const box = hasPlan ? plan.zones?.[z.id] : null;
      if (box) {
        z.box = { x: box.x, y: box.y, w: Math.max(box.w, z.need.w), h: Math.max(box.h, z.need.h) };
      } else {
        z.box = { x: cursor, y: stripY, w: z.need.w, h: z.need.h };
        cursor += z.need.w + 6;
        stripH = Math.max(stripH, z.need.h);
      }
      z.ox = r1(z.box.x + (z.box.w - z.layout.w) / 2);
      z.oy = r1(z.box.y + LABEL + (z.box.h - LABEL - z.layout.h) / 2);
    }
    if (stripH) { W = Math.max(W, cursor - 2); H = Math.max(H, stripY + stripH + 4); }
    return { id: floor.id, name: floor.name, w: r1(W), h: r1(H), plan: hasPlan ? plan : null, zones };
  }

  // ---------- SVG ----------
  /**
   * An office chair seen from above, drawn with its desk to the right (+x) in a
   * CHAIR x CHAIR cell. The inner group lets CSS push the chair back (away status);
   * the person is only shown while someone is there.
   */
  const CHAIR_SHAPE = `<g class="ws-chair-in">
      <rect class="ws-arm" x="0.95" y="0.28" width="1.95" height="0.42" rx="0.21"/>
      <rect class="ws-arm" x="0.95" y="2.9" width="1.95" height="0.42" rx="0.21"/>
      <rect class="ws-seat" x="0.6" y="0.62" width="2.55" height="2.36" rx="0.75"/>
      <rect class="ws-back" x="0.12" y="0.45" width="0.74" height="2.7" rx="0.37"/>
    </g>
    <g class="ws-person"><ellipse cx="1.6" cy="1.8" rx="0.95" ry="1.42"/><circle cx="2.15" cy="1.8" r="0.7"/></g>`;

  function chairTransform(p) {
    if (p.side === 'right') return `translate(${r1(p.x + CHAIR)} ${p.y}) scale(-1 1)`;
    if (p.side === 'bottom') return `translate(${p.x} ${r1(p.y + CHAIR)}) rotate(-90)`;
    return `translate(${p.x} ${p.y})`;
  }

  /** The bounding box of a workstation: its desk segment and its chair. */
  function wsBox(p) {
    const x0 = Math.min(p.desk.x, p.x), y0 = Math.min(p.desk.y, p.y);
    const x1 = Math.max(p.desk.x + p.desk.w, p.x + CHAIR), y1 = Math.max(p.desk.y + p.desk.h, p.y + CHAIR);
    return { x: r1(x0), y: r1(y0), w: r1(x1 - x0), h: r1(y1 - y0) };
  }

  const LIGHT = `<circle class="ws-light-halo" r="1.25"/><circle class="ws-light" r="0.85"/>
    <path class="ws-glyph ws-glyph-away" d="M0 -0.42V0l0.3 0.22"/>
    <path class="ws-glyph ws-glyph-off" d="M0 -0.45V0.08M0 0.36v0.02"/>`;

  /** One interactive workstation. Its look is driven entirely by classes on the outer group. */
  function seatMarkup(p) {
    const b = wsBox(p);
    const num = String(p.id).split('-').pop();
    return `<g class="seat" data-seat="${esc(p.id)}" data-side="${p.side}" data-kind="${esc(p.kind)}" data-table-seats="${p.tableSeats}" tabindex="-1" role="button">
      <rect class="ws-hit" x="${r1(b.x - 0.3)}" y="${r1(b.y - 0.3)}" width="${r1(b.w + 0.6)}" height="${r1(b.h + 0.6)}"/>
      <rect class="ws-desk" x="${p.desk.x}" y="${p.desk.y}" width="${p.desk.w}" height="${p.desk.h}"/>
      <rect class="ws-monitor" x="${p.monitor.x}" y="${p.monitor.y}" width="${p.monitor.w}" height="${p.monitor.h}" rx="0.12"/>
      <g class="ws-chair" transform="${chairTransform(p)}">${CHAIR_SHAPE}</g>
      <g class="ws-status" transform="translate(${p.light[0]} ${p.light[1]})">${LIGHT}</g>
      <text class="ws-num" x="${p.label[0]}" y="${p.label[1]}">${esc(num)}</text>
    </g>`;
  }

  /** A stand-alone workstation for the legend, with a status class such as "st-available". */
  function sampleSVG(cls = '', style = '') {
    const p = { id: 'x', x: 0, y: 0.9, side: 'left', kind: '', tableSeats: 0,
      desk: { x: CHAIR, y: 0, w: DESK, h: 5.4 }, monitor: { x: CHAIR + DESK - 0.62, y: 1.5, w: 0.36, h: 2.4 },
      light: [CHAIR + DESK * 0.4, 2.7], label: [0, 0] };
    return `<svg class="ws-sample" viewBox="-0.6 -0.6 ${r1(CHAIR + DESK + 1.8)} 6.8" aria-hidden="true">
      <rect class="fp-table" x="${CHAIR}" y="0" width="${DESK}" height="5.4" rx="0.3"/>
      ${seatMarkup(p).replace('class="seat"', `class="seat ${cls}" style="${style}"`).replace(/tabindex="-1" role="button"/, '').replace(/<text class="ws-num"[^]*?<\/text>/, '')}</svg>`;
  }

  const plantMarkup = ([x, y], size = 1) => `<g class="fp-plant" transform="translate(${x} ${y}) scale(${size})">
    <circle r="1.25" class="leaf"/><circle r="0.62" class="leaf2"/></g>`;

  function tableMarkup(t) {
    const lines = t.kind === 'counter'
      ? t.dividers.map((x) => `<line class="fp-table-div" x1="${x}" y1="${r1(t.y + 0.2)}" x2="${x}" y2="${r1(t.y + t.h - 0.2)}"/>`)
      : t.dividers.map((y) => `<line class="fp-table-div" x1="${r1(t.x + 0.2)}" y1="${y}" x2="${r1(t.x + t.w - 0.2)}" y2="${y}"/>`);
    if (t.spine !== null) lines.push(`<line class="fp-table-spine" x1="${t.spine}" y1="${r1(t.y + 0.3)}" x2="${t.spine}" y2="${r1(t.y + t.h - 0.3)}"/>`);
    return `<rect class="fp-table-shadow" x="${r1(t.x + 0.15)}" y="${r1(t.y + 0.25)}" width="${t.w}" height="${t.h}" rx="0.35"/>
      <rect class="fp-table" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="0.35"/>${lines.join('')}`;
  }

  const ICONS = {
    man: '<circle cx="0" cy="-1.7" r="0.75"/><path d="M-1 -0.6h2v2.6h-0.55v2.2h-0.9v-2.2h-0.55z"/>',
    woman: '<circle cx="0" cy="-1.7" r="0.75"/><path d="M-0.7 -0.6h1.4l1 2.8h-0.95v1.9h-0.9v-1.9h-0.95z"/>',
    cup: '<path d="M-1.6 -0.8h2.6v1.6a1.3 1.3 0 0 1-1.3 1.3h0a1.3 1.3 0 0 1-1.3-1.3z"/><path d="M1 -0.4h0.5a0.65 0.65 0 0 1 0 1.3H0.9" fill="none" stroke-width="0.35"/><path d="M-1.9 2.6h3.4" fill="none" stroke-width="0.35"/>',
  };

  function roomMarkup(r) {
    const cx = r1(r.x + r.w / 2), cy = r1(r.y + r.h / 2);
    const label = r.label ? `<text class="fp-room-label" x="${cx}" y="${r1(r.y + r.h - 1.6)}">${esc(r.label)}</text>` : '';
    switch (r.kind) {
      case 'pantry': {
        const fw = Math.min(r.w * 0.55, 14), fh = Math.min(r.h * 0.55, 10);
        return `<rect class="fp-room fp-room-pantry" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>
          <rect class="fp-fixture-dark" x="${r1(cx - fw / 2)}" y="${r1(cy - fh / 2 - 1)}" width="${r1(fw)}" height="${r1(fh)}" rx="0.4"/>
          <g class="fp-icon" transform="translate(${cx} ${r1(cy - 1)}) scale(1.1)">${ICONS.cup}</g>${label}`;
      }
      case 'toilet-m': case 'toilet-f':
        return `<rect class="fp-room fp-room-wc" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>
          <g class="fp-icon fp-icon-wc" transform="translate(${cx} ${r1(cy - 0.6)}) scale(1.15)">${r.kind === 'toilet-m' ? ICONS.man : ICONS.woman}</g>${label}`;
      case 'lift':
        return `<rect class="fp-room fp-room-lift" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>
          <text class="fp-room-label fp-room-label-lg" x="${cx}" y="${r1(cy + 0.6)}">${esc(r.label ?? 'Lift lobby')}</text>`;
      default:
        return `<rect class="fp-room fp-room-${esc(r.kind ?? 'service')}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>${label}`;
    }
  }

  function fixtureMarkup(f) {
    if (f.kind === 'planter') {
      const n = Math.max(1, Math.floor(f.w / 4));
      const plants = Array.from({ length: n }, (_, i) => plantMarkup([r1(f.x + (f.w * (i + 0.5)) / n), r1(f.y + f.h / 2)], 0.9)).join('');
      return `<rect class="fp-planter" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="0.4"/>${plants}`;
    }
    return `<rect class="fp-fixture" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="0.3"/>`;
  }

  function doorMarkup(d) {
    const rad = (a) => (a * Math.PI) / 180;
    const ax = r1(d.x + d.r * Math.cos(rad(d.from))), ay = r1(d.y + d.r * Math.sin(rad(d.from)));
    const bx = r1(d.x + d.r * Math.cos(rad(d.to))), by = r1(d.y + d.r * Math.sin(rad(d.to)));
    return `<path class="fp-door-swing" d="M${ax} ${ay} A${d.r} ${d.r} 0 0 ${d.to > d.from ? 1 : 0} ${bx} ${by}"/>
      <line class="fp-door" x1="${d.x}" y1="${d.y}" x2="${bx}" y2="${by}"/>`;
  }

  /** Walls, rooms and other context: drawn once, never interactive. */
  function architecture(fl) {
    const p = fl.plan;
    if (!p) return `<rect class="fp-floor fp-floor-plain" x="0.5" y="0.5" width="${r1(fl.w - 1)}" height="${r1(fl.h - 1)}" rx="1"/>`;
    const line = (cls) => ([x1, y1, x2, y2]) => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    return `<rect class="fp-floor" x="0" y="0" width="${p.width}" height="${p.height}"/>
      ${(p.rooms ?? []).map(roomMarkup).join('')}
      ${(p.fixtures ?? []).map(fixtureMarkup).join('')}
      ${(p.walls ?? []).map(line('fp-wall')).join('')}
      <rect class="fp-outline" x="0" y="0" width="${p.width}" height="${p.height}"/>
      ${(p.windows ?? []).map((w) => line('fp-window')(w) + line('fp-window-in')(w)).join('')}
      ${(p.doors ?? []).map(doorMarkup).join('')}
      ${(p.plants ?? []).map((pt) => plantMarkup(pt)).join('')}`;
  }

  /** The whole floor as one SVG string. Size is set by the caller (see dashboard.js). */
  function floorSVG(fl) {
    // Zones are areas of the same office: a faint floor tint each, a hairline edge, a label.
    const zones = fl.zones.map((z, i) => `
      <g class="fp-zone fp-zone-t${i % 4}" role="group" aria-label="${esc(z.name)}" data-zone="${esc(fl.id)}|${esc(z.id)}">
        <rect class="fp-zone-area" x="${z.box.x}" y="${z.box.y}" width="${z.box.w}" height="${z.box.h}" rx="0.5"/>
        <rect class="fp-zone-tab" x="${z.box.x}" y="${z.box.y}" width="${z.box.w}" height="0.45"/>
        <text class="fp-zone-label" x="${r1(z.box.x + 1.6)}" y="${r1(z.box.y + 2.9)}">${esc(z.name)}</text>
        <text class="fp-zone-count" x="${r1(z.box.x + 1.6)}" y="${r1(z.box.y + 4.8)}" data-zone-count="${esc(fl.id)}|${esc(z.id)}"></text>
        <g transform="translate(${z.ox} ${z.oy})">
          ${z.layout.tables.map(tableMarkup).join('')}
          ${z.layout.plants.map((pt) => plantMarkup(pt, 0.55)).join('')}
          ${z.layout.seats.map(seatMarkup).join('')}
        </g>
      </g>`).join('');
    return `<svg class="fp" viewBox="-1 -1 ${r1(fl.w + 2)} ${r1(fl.h + 2)}" data-w="${r1(fl.w + 2)}" data-h="${r1(fl.h + 2)}" role="group" aria-label="${esc(fl.name)} floor plan">
      <g class="fp-arch" aria-hidden="true">${architecture(fl)}</g>${zones}</svg>`;
  }

  return { layoutZone, layoutFloor, floorSVG, sampleSVG, CHAIR };
})();
