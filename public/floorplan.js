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
 * are laid out side by side inside a generic office shell (marked as such).
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
   * A plain office shell for a floor without a mapped plan: outer walls, windows along
   * the long sides, a door, plants in the corners and storage along one wall. It is
   * marked `generic` so the dashboard can say the floor is not mapped yet.
   */
  function genericShell(W, H) {
    const windows = [];
    for (let x = 10; x + 8 < W - 8; x += 14) windows.push([x, 0, x + 8, 0]);
    for (let y = 9; y + 8 < H - 12; y += 14) { windows.push([0, y, 0, y + 8]); windows.push([W, y, W, y + 8]); }
    const mid = r1(W / 2);
    return {
      generic: true, width: r1(W), height: r1(H), zones: {},
      windows,
      doors: [{ x: mid - 3, y: H, r: 6, from: 0, to: -90 }],
      fixtures: [{ kind: 'storage', x: 1.4, y: H - 22, w: 3, h: 9 }, { kind: 'storage', x: r1(W - 4.4), y: H - 22, w: 3, h: 9 }],
      plants: [[4.5, 4.5], [r1(W - 4.5), 4.5], [4.5, r1(H - 4.5)], [r1(W - 4.5), r1(H - 4.5)], [r1(mid + 8), r1(H - 3.5)]],
    };
  }

  /**
   * Lay out a floor: each zone's tables inside its box from `plan.zones`. Zones without
   * a box (or a floor without a plan) are placed side by side; a floor without a plan
   * gets a generic office shell around them.
   */
  function layoutFloor(floor, seats, plan) {
    const zones = floor.zones.map((z) => {
      const layout = layoutZone(seats.filter((s) => s.floor === floor.id && s.zone === z.id));
      return { id: z.id, name: z.name, layout, need: { w: layout.w + 2 * PAD, h: layout.h + LABEL + 2 * PAD } };
    });
    const hasPlan = Boolean(plan && plan.width > 0 && plan.height > 0);
    let W = hasPlan ? plan.width : 0, H = hasPlan ? plan.height : 0;
    const start = hasPlan ? 4 : 9;
    let cursor = start, stripY = hasPlan ? plan.height + 6 : 8, stripH = 0;
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
    if (!hasPlan) {
      W = Math.max(cursor - 6 + start, 60); H = stripY + stripH + 12;
      return { id: floor.id, name: floor.name, w: r1(W), h: r1(H), plan: genericShell(W, H), zones };
    }
    if (stripH) { W = Math.max(W, cursor - 2); H = Math.max(H, stripY + stripH + 4); }
    return { id: floor.id, name: floor.name, w: r1(W), h: r1(H), plan, zones };
  }

  // ---------- SVG ----------
  // Shared gradients and shapes, defined once per floor drawing. Colours come from CSS
  // (stop-color / fill classes) so light and dark themes both work.
  const LEAF = 'M0 0C0.42-0.45 0.46-1.35 0-1.95C-0.46-1.35-0.42-0.45 0 0Z';
  const leaves = (n, scale, offset, cls) => Array.from({ length: n }, (_, i) =>
    `<path class="${cls}" d="${LEAF}" transform="rotate(${r1(offset + (360 / n) * i)}) scale(${scale})"/>`).join('');
  const DEFS = `<defs>
    <linearGradient id="fpg-chair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="fpg-chair-hi"/><stop offset="1" class="fpg-chair-lo"/></linearGradient>
    <linearGradient id="fpg-table" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="fpg-table-hi"/><stop offset="1" class="fpg-table-lo"/></linearGradient>
    <linearGradient id="fpg-cab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="fpg-cab-hi"/><stop offset="1" class="fpg-cab-lo"/></linearGradient>
    <linearGradient id="fpg-leaf" x1="0" y1="1" x2="0" y2="0"><stop offset="0" class="fpg-leaf-lo"/><stop offset="1" class="fpg-leaf-hi"/></linearGradient>
    <radialGradient id="fpg-soil"><stop offset="0" class="fpg-soil-hi"/><stop offset="1" class="fpg-soil-lo"/></radialGradient>
    <g id="fp-plant">
      <ellipse class="fp-drop" cx="0.35" cy="0.45" rx="1.5" ry="1.45"/>
      <circle class="fp-pot" r="1.2"/><circle r="0.98" fill="url(#fpg-soil)"/>
      ${leaves(7, 0.95, 0, 'fp-leaf')}${leaves(7, 0.7, 26, 'fp-leaf fp-leaf-in')}
      <circle class="fp-leaf-core" r="0.32"/>
    </g>
  </defs>`;

  /**
   * An office chair seen from above, drawn with its desk to the right (+x) in a
   * CHAIR x CHAIR cell: a shadow for its base, armrests, a cushioned seat and a
   * curved back. The tilt group turns it a little (set per seat); the inner group lets
   * CSS push it back (away status); the person is only shown while someone is there.
   */
  const CHAIR_SHAPE = `<ellipse class="ws-shadow" cx="2.05" cy="2.05" rx="1.65" ry="1.6"/>
      <g class="ws-chair-in">
        <rect class="ws-arm" x="0.95" y="0.24" width="1.95" height="0.44" rx="0.22"/>
        <rect class="ws-arm" x="0.95" y="2.92" width="1.95" height="0.44" rx="0.22"/>
        <rect class="ws-seat" x="0.62" y="0.62" width="2.55" height="2.36" rx="0.8"/>
        <rect class="ws-seat-hi" x="1.05" y="0.95" width="1.6" height="1.7" rx="0.55"/>
        <path class="ws-back" d="M0.85 0.42C0.3 0.6 0.08 1.2 0.08 1.8S0.3 3 0.85 3.18L1.02 2.75C0.72 2.55 0.6 2.2 0.6 1.8S0.72 1.05 1.02 0.85Z"/>
      </g>
      <g class="ws-person"><ellipse class="ws-shoulders" cx="1.55" cy="1.8" rx="0.92" ry="1.42"/><circle class="ws-head" cx="2.15" cy="1.8" r="0.68"/></g>`;

  /** A stable small turn for some chairs, so the plan doesn't look machine-aligned. */
  function tiltFor(id) {
    let h = 2166136261;
    for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const u = (h >>> 0) / 4294967296;
    return u < 0.35 ? 0 : r1((u - 0.675) * 30); // about a third straight, the rest within ±10°
  }

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

  const LIGHT = `<circle class="ws-light-halo" r="1.25"/><circle class="ws-light" r="0.85"/><circle class="ws-light-hi" cx="-0.25" cy="-0.28" r="0.28"/>
    <path class="ws-glyph ws-glyph-away" d="M0 -0.42V0l0.3 0.22"/>
    <path class="ws-glyph ws-glyph-off" d="M0 -0.45V0.08M0 0.36v0.02"/>`;

  /** A monitor seen from above: a thin screen on a small stand, facing the chair. */
  function monitorMarkup(m) {
    const vertical = m.h > m.w;
    const stand = vertical
      ? `<rect class="ws-stand" x="${r1(m.x + m.w / 2 - 0.25)}" y="${r1(m.y + m.h / 2 - 0.45)}" width="0.5" height="0.9" rx="0.12"/>`
      : `<rect class="ws-stand" x="${r1(m.x + m.w / 2 - 0.45)}" y="${r1(m.y + m.h / 2 - 0.25)}" width="0.9" height="0.5" rx="0.12"/>`;
    return `${stand}<rect class="ws-monitor" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="0.14"/>`;
  }

  /** One interactive workstation. Its look is driven entirely by classes on the outer group. */
  function seatMarkup(p) {
    const b = wsBox(p);
    const num = String(p.id).split('-').pop();
    const tilt = tiltFor(p.id);
    return `<g class="seat" data-seat="${esc(p.id)}" data-side="${p.side}" data-kind="${esc(p.kind)}" data-table-seats="${p.tableSeats}" tabindex="-1" role="button">
      <rect class="ws-hit" x="${r1(b.x - 0.3)}" y="${r1(b.y - 0.3)}" width="${r1(b.w + 0.6)}" height="${r1(b.h + 0.6)}"/>
      <rect class="ws-desk" x="${p.desk.x}" y="${p.desk.y}" width="${p.desk.w}" height="${p.desk.h}"/>
      ${monitorMarkup(p.monitor)}
      <g class="ws-chair" transform="${chairTransform(p)}"><g class="ws-tilt"${tilt ? ` transform="rotate(${tilt} 1.8 1.8)"` : ''}>${CHAIR_SHAPE}</g></g>
      <g class="ws-status" transform="translate(${p.light[0]} ${p.light[1]})">${LIGHT}</g>
      <text class="ws-num" x="${p.label[0]}" y="${p.label[1]}">${esc(num)}</text>
    </g>`;
  }

  /** A stand-alone workstation for the legend, with a status class such as "st-available". */
  function sampleSVG(cls = '', style = '') {
    const p = { id: 'sample', x: 0, y: 0.9, side: 'left', kind: '', tableSeats: 0,
      desk: { x: CHAIR, y: 0, w: DESK, h: 5.4 }, monitor: { x: CHAIR + DESK - 0.62, y: 1.5, w: 0.36, h: 2.4 },
      light: [CHAIR + DESK * 0.4, 2.7], label: [0, 0] };
    const ws = seatMarkup(p).replace('class="seat"', `class="seat ${cls}" style="${style}"`)
      .replace(/tabindex="-1" role="button"/, '').replace(/<text class="ws-num"[^]*?<\/text>/, '')
      .replace(/ transform="rotate\([^)]*\)"/, '');
    return `<svg class="ws-sample" viewBox="-0.6 -0.6 ${r1(CHAIR + DESK + 1.8)} 6.8" aria-hidden="true">${DEFS}
      <rect class="fp-table" x="${CHAIR}" y="0" width="${DESK}" height="5.4" rx="0.3"/>${ws}</svg>`;
  }

  /** A potted plant from above; `turn` varies the leaves so plants don't look stamped. */
  const plantMarkup = ([x, y], size = 1, turn = 0) =>
    `<use href="#fp-plant" class="fp-plant" transform="translate(${x} ${y}) scale(${size}) rotate(${turn})"/>`;

  function tableMarkup(t) {
    const lines = t.kind === 'counter'
      ? t.dividers.map((x) => `<line class="fp-table-div" x1="${x}" y1="${r1(t.y + 0.2)}" x2="${x}" y2="${r1(t.y + t.h - 0.2)}"/>`)
      : t.dividers.map((y) => `<line class="fp-table-div" x1="${r1(t.x + 0.2)}" y1="${y}" x2="${r1(t.x + t.w - 0.2)}" y2="${y}"/>`);
    if (t.spine !== null) lines.push(`<line class="fp-table-spine" x1="${t.spine}" y1="${r1(t.y + 0.3)}" x2="${t.spine}" y2="${r1(t.y + t.h - 0.3)}"/>`);
    return `<rect class="fp-table-shadow" x="${r1(t.x + 0.3)}" y="${r1(t.y + 0.45)}" width="${t.w}" height="${t.h}" rx="0.45"/>
      <rect class="fp-table" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="0.35"/>
      <rect class="fp-table-edge" x="${r1(t.x + 0.12)}" y="${r1(t.y + 0.12)}" width="${r1(t.w - 0.24)}" height="${r1(t.h - 0.24)}" rx="0.28"/>${lines.join('')}`;
  }

  const ICONS = {
    man: '<circle cx="0" cy="-1.7" r="0.75"/><path d="M-1 -0.6h2v2.6h-0.55v2.2h-0.9v-2.2h-0.55z"/>',
    woman: '<circle cx="0" cy="-1.7" r="0.75"/><path d="M-0.7 -0.6h1.4l1 2.8h-0.95v1.9h-0.9v-1.9h-0.95z"/>',
    cup: '<path d="M-1.6 -0.8h2.6v1.6a1.3 1.3 0 0 1-1.3 1.3h0a1.3 1.3 0 0 1-1.3-1.3z"/><path d="M1 -0.4h0.5a0.65 0.65 0 0 1 0 1.3H0.9" fill="none" stroke-width="0.35"/><path d="M-1.9 2.6h3.4" fill="none" stroke-width="0.35"/>',
  };

  /** A raised box seen from above: drop shadow, a lit top face and a bevelled edge. */
  const box = (x, y, w, h, cls = 'fp-box', rx = 0.35) =>
    `<rect class="fp-drop" x="${r1(x + 0.3)}" y="${r1(y + 0.4)}" width="${w}" height="${h}" rx="${rx}"/>
     <rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>
     <rect class="fp-bevel" x="${r1(x + 0.18)}" y="${r1(y + 0.18)}" width="${r1(w - 0.36)}" height="${r1(h - 0.36)}" rx="${r1(Math.max(0.1, rx - 0.1))}"/>`;

  function roomMarkup(r) {
    const cx = r1(r.x + r.w / 2), cy = r1(r.y + r.h / 2);
    const label = r.label ? `<text class="fp-room-label" x="${cx}" y="${r1(r.y + r.h - 1.6)}">${esc(r.label)}</text>` : '';
    switch (r.kind) {
      case 'pantry': {
        // A counter along the back wall with a sink and a coffee machine, and a small round table.
        const cw = Math.min(r.w - 4, 18), ch = 3.2, x0 = r1(cx - cw / 2), y0 = r1(r.y + r.h - ch - 0.9);
        return `<rect class="fp-room fp-room-pantry" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>
          ${box(x0, y0, r1(cw), ch, 'fp-counter')}
          <rect class="fp-sink" x="${r1(x0 + 1.2)}" y="${r1(y0 + 0.6)}" width="3.4" height="2" rx="0.5"/>
          <rect class="fp-appliance" x="${r1(x0 + cw - 3.6)}" y="${r1(y0 + 0.5)}" width="2.4" height="2.2" rx="0.3"/>
          <circle class="fp-appliance-hi" cx="${r1(x0 + cw - 2.4)}" cy="${r1(y0 + 1.6)}" r="0.55"/>
          <circle class="fp-drop" cx="${r1(cx + 0.3)}" cy="${r1(r.y + 5.4)}" r="2.6"/>
          <circle class="fp-table" cx="${cx}" cy="${r1(r.y + 5)}" r="2.6"/>
          <g class="fp-icon" transform="translate(${cx} ${r1(r.y + 5)}) scale(0.75)">${ICONS.cup}</g>
          <text class="fp-room-label" x="${cx}" y="${r1(r.y + 10.6)}">${esc(r.label ?? 'Pantry')}</text>`;
      }
      case 'toilet-m': case 'toilet-f':
        return `<rect class="fp-room fp-room-wc" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>
          <rect class="fp-wc-inner" x="${r1(r.x + 0.5)}" y="${r1(r.y + 0.5)}" width="${r1(r.w - 1)}" height="${r1(r.h - 1)}" rx="0.3"/>
          <g class="fp-icon fp-icon-wc" transform="translate(${cx} ${r1(cy - 0.6)}) scale(1.15)">${r.kind === 'toilet-m' ? ICONS.man : ICONS.woman}</g>${label}`;
      case 'lift': {
        // Lift cars along the back of the lobby, drawn the architectural way (a crossed box).
        const n = Math.max(1, Math.min(4, Math.floor(r.w / 9))), cw = 6, gap = (r.w - n * cw) / (n + 1);
        const cars = Array.from({ length: n }, (_, i) => {
          const x = r1(r.x + gap + i * (cw + gap)), y = r1(r.y + r.h - 5.2);
          return `<rect class="fp-lift-car" x="${x}" y="${y}" width="${cw}" height="4.6" rx="0.2"/>
            <path class="fp-lift-x" d="M${x} ${y}L${r1(x + cw)} ${r1(y + 4.6)}M${r1(x + cw)} ${y}L${x} ${r1(y + 4.6)}"/>
            <rect class="fp-lift-door" x="${r1(x + 1)}" y="${r1(y - 0.25)}" width="${cw - 2}" height="0.5"/>`;
        }).join('');
        return `<rect class="fp-room fp-room-lift" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>${cars}
          <text class="fp-room-label fp-room-label-lg" x="${cx}" y="${r1(r.y + 3.4)}">${esc(r.label ?? 'Lift lobby')}</text>`;
      }
      default:
        return `<rect class="fp-room fp-room-${esc(r.kind ?? 'service')}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>${label}`;
    }
  }

  function fixtureMarkup(f) {
    if (f.kind === 'planter') {
      const n = Math.max(1, Math.floor(f.w / 4));
      const plants = Array.from({ length: n }, (_, i) => plantMarkup([r1(f.x + (f.w * (i + 0.5)) / n), r1(f.y + f.h / 2)], 0.95, i * 37)).join('');
      return `${box(f.x, f.y, f.w, f.h, 'fp-planter', 0.4)}<rect class="fp-soil" x="${r1(f.x + 0.5)}" y="${r1(f.y + 0.5)}" width="${r1(f.w - 1)}" height="${r1(f.h - 1)}" rx="0.25"/>${plants}`;
    }
    // Storage: a cabinet with doors and handles.
    const vertical = f.h > f.w, n = Math.max(1, Math.round((vertical ? f.h : f.w) / 4.5));
    const splits = Array.from({ length: n - 1 }, (_, i) => vertical
      ? `<line class="fp-cab-line" x1="${r1(f.x + 0.3)}" y1="${r1(f.y + (f.h * (i + 1)) / n)}" x2="${r1(f.x + f.w - 0.3)}" y2="${r1(f.y + (f.h * (i + 1)) / n)}"/>`
      : `<line class="fp-cab-line" x1="${r1(f.x + (f.w * (i + 1)) / n)}" y1="${r1(f.y + 0.3)}" x2="${r1(f.x + (f.w * (i + 1)) / n)}" y2="${r1(f.y + f.h - 0.3)}"/>`).join('');
    const handles = Array.from({ length: n }, (_, i) => vertical
      ? `<line class="fp-cab-handle" x1="${r1(f.x + f.w - 0.75)}" y1="${r1(f.y + (f.h * (i + 0.5)) / n - 0.6)}" x2="${r1(f.x + f.w - 0.75)}" y2="${r1(f.y + (f.h * (i + 0.5)) / n + 0.6)}"/>`
      : `<line class="fp-cab-handle" x1="${r1(f.x + (f.w * (i + 0.5)) / n - 0.6)}" y1="${r1(f.y + f.h - 0.75)}" x2="${r1(f.x + (f.w * (i + 0.5)) / n + 0.6)}" y2="${r1(f.y + f.h - 0.75)}"/>`).join('');
    return `${box(f.x, f.y, f.w, f.h, 'fp-cabinet', 0.25)}${splits}${handles}`;
  }

  function doorMarkup(d) {
    const rad = (a) => (a * Math.PI) / 180;
    const ax = r1(d.x + d.r * Math.cos(rad(d.from))), ay = r1(d.y + d.r * Math.sin(rad(d.from)));
    const bx = r1(d.x + d.r * Math.cos(rad(d.to))), by = r1(d.y + d.r * Math.sin(rad(d.to)));
    return `<path class="fp-door-sweep" d="M${d.x} ${d.y}L${ax} ${ay}A${d.r} ${d.r} 0 0 ${d.to > d.from ? 1 : 0} ${bx} ${by}Z"/>
      <path class="fp-door-swing" d="M${ax} ${ay} A${d.r} ${d.r} 0 0 ${d.to > d.from ? 1 : 0} ${bx} ${by}"/>
      <line class="fp-door" x1="${d.x}" y1="${d.y}" x2="${bx}" y2="${by}"/>`;
  }

  /** A window set into the wall: glass between two frame lines, with mullions. */
  function windowMarkup([x1, y1, x2, y2]) {
    const vertical = x1 === x2, len = vertical ? Math.abs(y2 - y1) : Math.abs(x2 - x1);
    const t = 1.3, n = Math.max(1, Math.round(len / 3.2));
    const x = vertical ? x1 - t / 2 : Math.min(x1, x2), y = vertical ? Math.min(y1, y2) : y1 - t / 2;
    const w = vertical ? t : len, h = vertical ? len : t;
    const mull = Array.from({ length: n - 1 }, (_, i) => vertical
      ? `<line class="fp-window-mullion" x1="${r1(x)}" y1="${r1(y + (len * (i + 1)) / n)}" x2="${r1(x + t)}" y2="${r1(y + (len * (i + 1)) / n)}"/>`
      : `<line class="fp-window-mullion" x1="${r1(x + (len * (i + 1)) / n)}" y1="${r1(y)}" x2="${r1(x + (len * (i + 1)) / n)}" y2="${r1(y + t)}"/>`).join('');
    const glass = vertical
      ? `<line class="fp-window-glass" x1="${r1(x1)}" y1="${r1(y)}" x2="${r1(x1)}" y2="${r1(y + len)}"/>`
      : `<line class="fp-window-glass" x1="${r1(x)}" y1="${r1(y1)}" x2="${r1(x + len)}" y2="${r1(y1)}"/>`;
    return `<rect class="fp-window" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"/>${glass}${mull}`;
  }

  /** Walls, rooms and other context: drawn once, never interactive. */
  function architecture(fl) {
    const p = fl.plan;
    const line = (cls) => ([x1, y1, x2, y2]) => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    // The generic shell's entrance is a gap in the bottom wall.
    const outline = p.generic
      ? `<path class="fp-outline" d="M${r1(p.width / 2 - 3)} ${p.height}H0V0H${p.width}V${p.height}H${r1(p.width / 2 + 3)}"/>`
      : `<rect class="fp-outline" x="0" y="0" width="${p.width}" height="${p.height}"/>`;
    return `<rect class="fp-floor" x="0" y="0" width="${p.width}" height="${p.height}"/>
      <rect class="fp-floor-edge" x="0.9" y="0.9" width="${r1(p.width - 1.8)}" height="${r1(p.height - 1.8)}"/>
      ${(p.rooms ?? []).map(roomMarkup).join('')}
      ${(p.fixtures ?? []).map(fixtureMarkup).join('')}
      ${(p.walls ?? []).map(line('fp-wall')).join('')}
      ${outline}
      ${(p.windows ?? []).map(windowMarkup).join('')}
      ${(p.doors ?? []).map(doorMarkup).join('')}
      ${(p.plants ?? []).map((pt, i) => plantMarkup(pt, 1, i * 53)).join('')}`;
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
          ${z.layout.plants.map((pt, k) => plantMarkup(pt, 0.55, k * 41)).join('')}
          ${z.layout.seats.map(seatMarkup).join('')}
        </g>
      </g>`).join('');
    return `<svg class="fp" viewBox="-1 -1 ${r1(fl.w + 2)} ${r1(fl.h + 2)}" data-w="${r1(fl.w + 2)}" data-h="${r1(fl.h + 2)}" role="group" aria-label="${esc(fl.name)} floor plan">
      ${DEFS}<g class="fp-arch" aria-hidden="true">${architecture(fl)}</g>${zones}</svg>`;
  }

  return { layoutZone, layoutFloor, floorSVG, sampleSVG, CHAIR };
})();
