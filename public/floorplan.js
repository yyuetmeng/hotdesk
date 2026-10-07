'use strict';
/*
 * Floor-plan geometry and SVG drawing for the dashboard.
 *
 * Seats keep the row/column they get from each zone's `map` in config/building.json;
 * this file only decides how to draw them. Touching desks form a table: a bank two
 * desks wide becomes a table with chairs on both long sides, a bank one desk wide a
 * bench, and a single row of three or more a counter with chairs along it.
 *
 * A floor may also carry a `plan` (outline, walls, windows, doors, rooms, fixtures,
 * plants and a box per zone, all in plan units of roughly 10 cm). Without one, zones
 * are laid out side by side on a plain floor; nothing architectural is invented.
 *
 * No DOM access here, so the layout can be tested in Node (test/floorplan.test.js).
 */
const FloorPlan = (() => {
  const CHAIR = 3.6;       // chair footprint (square)
  const TABLE = 3.4;       // depth of a table between two rows of chairs
  const ROW_GAP = 1.8;     // gap between chairs along a table
  const BLANK = 3.4;       // an empty map row: a cross aisle
  const SPACE = 7.4;       // an empty map column: an aisle between tables
  const SIDE_GAP = 0.8;    // between chairs that sit side by side without a table between
  const COUNTER = 3.0;     // depth of a counter in front of a row of chairs
  const COUNTER_GAP = 0.4;
  const LABEL = 5.6;       // zone label strip: name, then free count
  const PAD = 2.6;         // padding inside a zone

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
   * @returns {{w:number,h:number,tables:object[],seats:object[],plants:number[][]}}
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
    const tableAfter = new Set(banks.filter((b) => b.kind !== 'counter').map((b) => b.c0));
    const colX = [];
    let x = 0;
    for (let c = 0; c <= maxCol; c++) {
      colX[c] = x;
      x += deskCols.has(c) ? CHAIR : SPACE;
      if (tableAfter.has(c)) x += TABLE;
      else if (deskCols.has(c) && deskCols.has(c + 1)) x += SIDE_GAP;
    }
    const w = x;

    // Row positions: a counter needs room in front of its chairs.
    const counterRows = new Set(banks.filter((b) => b.kind === 'counter').map((b) => b.r0));
    const rowY = [];
    let y = 0;
    for (let r = 0; r <= maxRow; r++) {
      if (counterRows.has(r)) y += COUNTER + COUNTER_GAP;
      rowY[r] = y;
      y += (deskRows.has(r) ? CHAIR : BLANK) + ROW_GAP;
    }
    const h = y - ROW_GAP;

    const at = new Map(seats.map((s) => [`${s.row},${s.col}`, s]));
    const tables = [], placed = [], plants = [];
    for (const b of banks) {
      if (b.kind === 'counter') {
        const tx = colX[b.c0] - 0.4, tw = colX[b.c1] + CHAIR + 0.4 - tx;
        const row = [];
        for (let c = b.c0; c <= b.c1; c++) if (at.has(`${b.r0},${c}`)) row.push(at.get(`${b.r0},${c}`));
        tables.push({ kind: 'counter', x: r1(tx), y: r1(rowY[b.r0] - COUNTER - COUNTER_GAP), w: r1(tw), h: COUNTER, seats: row.length });
        // Chairs are spread evenly along the counter.
        row.forEach((s, i) => placed.push({ id: s.id, x: r1(tx + (tw * (i + 0.5)) / row.length - CHAIR / 2), y: r1(rowY[b.r0]), side: 'bottom' }));
        continue;
      }
      const tx = colX[b.c0] + CHAIR, ty = rowY[b.r0] - 0.5;
      const th = rowY[b.r1] + CHAIR + 0.5 - ty;
      let count = 0;
      for (let r = b.r0; r <= b.r1; r++) {
        for (let c = b.c0; c <= b.c1; c++) {
          const s = at.get(`${r},${c}`);
          if (!s) continue;
          count++;
          placed.push({ id: s.id, x: r1(colX[c]), y: r1(rowY[r]), side: c === b.c0 ? 'left' : 'right' });
        }
        // A small plant on the table between chair rows, as on the reference plan.
        if (b.kind === 'pair' && r < b.r1) plants.push([r1(tx + TABLE / 2), r1((rowY[r] + CHAIR + rowY[r + 1]) / 2)]);
      }
      tables.push({ kind: b.kind, x: r1(tx), y: r1(ty), w: TABLE, h: r1(th), seats: count });
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
  const BACK = { left: [0, 0.3, 0.75, 3.0], right: [2.85, 0.3, 0.75, 3.0], bottom: [0.3, 2.85, 3.0, 0.75] };
  const CENTRE = { left: [2.05, 1.8], right: [1.55, 1.8], bottom: [1.8, 1.55] };

  /** The chair drawn for a seat; its fill, glyph and badge are set by the dashboard. */
  function chairMarkup(side = 'left') {
    const [bx, by, bw, bh] = BACK[side];
    return `<g class="chair">
      <rect class="ring" x="-0.6" y="-0.6" width="${CHAIR + 1.2}" height="${CHAIR + 1.2}" rx="1.3"/>
      <rect class="body" width="${CHAIR}" height="${CHAIR}" rx="0.85"/>
      <rect class="back" x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="0.37"/>
      <g class="glyph"></g>
    </g>`;
  }

  function seatMarkup(p) {
    const [cx, cy] = CENTRE[p.side];
    return `<g class="seat" data-seat="${esc(p.id)}" data-cx="${cx}" data-cy="${cy}" tabindex="-1" role="button" transform="translate(${p.x} ${p.y})">
      <rect class="hit" x="-0.9" y="-0.9" width="${CHAIR + 1.8}" height="${CHAIR + 1.8}" rx="1.2"/>${chairMarkup(p.side)}</g>`;
  }

  const plantMarkup = ([x, y], size = 1) => `<g class="fp-plant" transform="translate(${x} ${y}) scale(${size})">
    <circle r="1.25" class="leaf"/><circle r="0.62" class="leaf2"/></g>`;

  function tableMarkup(t) {
    const line = t.kind === 'counter'
      ? ''
      : `<line class="fp-table-line" x1="${r1(t.x + t.w / 2)}" y1="${r1(t.y + 0.5)}" x2="${r1(t.x + t.w / 2)}" y2="${r1(t.y + t.h - 0.5)}"/>`;
    return `<rect class="fp-table" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="0.5"/>${line}`;
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
    if (!p) return `<rect class="fp-floor fp-floor-plain" x="0.5" y="0.5" width="${r1(fl.w - 1)}" height="${r1(fl.h - 1)}" rx="2"/>`;
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
    const zones = fl.zones.map((z) => `
      <g class="fp-zone" role="group" aria-label="${esc(z.name)}" data-zone="${esc(fl.id)}|${esc(z.id)}">
        <rect class="fp-zone-area" x="${z.box.x}" y="${z.box.y}" width="${z.box.w}" height="${z.box.h}" rx="1.4"/>
        <text class="fp-zone-label" x="${r1(z.box.x + 1.6)}" y="${r1(z.box.y + 2.7)}">${esc(z.name)}</text>
        <text class="fp-zone-count" x="${r1(z.box.x + 1.6)}" y="${r1(z.box.y + 4.7)}" data-zone-count="${esc(fl.id)}|${esc(z.id)}"></text>
        <g transform="translate(${z.ox} ${z.oy})">
          ${z.layout.tables.map(tableMarkup).join('')}
          ${z.layout.plants.map((pt) => plantMarkup(pt, 0.6)).join('')}
          ${z.layout.seats.map(seatMarkup).join('')}
        </g>
      </g>`).join('');
    return `<svg class="fp" viewBox="-1 -1 ${r1(fl.w + 2)} ${r1(fl.h + 2)}" data-w="${r1(fl.w + 2)}" data-h="${r1(fl.h + 2)}" role="group" aria-label="${esc(fl.name)} floor plan">
      <g class="fp-arch" aria-hidden="true">${architecture(fl)}</g>${zones}</svg>`;
  }

  return { layoutZone, layoutFloor, floorSVG, chairMarkup, CHAIR };
})();
