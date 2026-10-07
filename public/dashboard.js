'use strict';

const STATUS = {
  available: { label: 'Available', sub: 'free to take now' },
  occupied: { label: 'Occupied', sub: 'presence detected / checked in' },
  away: { label: 'Away (held)', sub: '' },
  offline: { label: 'Sensor offline', sub: 'sensors needing attention' },
};

const svg = (d, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  person: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  seat: svg('<path d="M7 11V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5"/><path d="M5 11h14v4H5zM8 15v5M16 15v5"/>', 'i'),
  gauge: svg('<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4-4"/>', 'i'),
  alert: svg('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>', 'i'),
  pin: svg('<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', 'i'),
  sensor: svg('<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>', 'i'),
  qr: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path d="M14 14h2v2h-2zM18 18h2.5M14 20.5h2.5M20.5 14v2"/>', 'i'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>', 'i'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 'i'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>', 'i'),
  pointer: svg('<path d="m5 3 14 7-6 2-2 6z"/>', 'i'),
  okCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>', 'i'),
};
const STATUS_ICON = { available: ICON.seat, occupied: ICON.person.replace('<svg class=""', '<svg class="i"'), away: ICON.clock.replace('<svg class=""', '<svg class="i"'), offline: ICON.alert };

const params = new URLSearchParams(location.search);
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
let token = params.get('token') || safeGet('hotdesk.token') || '';

const state = {
  seats: new Map(), summary: null, projects: [], options: null,
  floor: safeGet('hotdesk.floor') || '', status: '', team: '', project: '', mode: safeGet('hotdesk.mode') || 'project',
  selected: null, flash: null,
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (m) => (m % 60 ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)} h ` : ''}${m % 60} min` : `${m / 60} hour${m === 60 ? '' : 's'}`);
const pct = (x) => `${Math.round(x * 100)}%`;
const narrow = () => matchMedia('(max-width: 1180px)').matches;

function withToken(path) {
  if (!token) return path;
  return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

async function api(path) {
  const res = await fetch(withToken(path));
  if (res.status === 401) {
    const t = prompt('Administrator token');
    if (t === null) throw new Error('unauthorised');
    token = t; safeSet('hotdesk.token', t);
    return api(path);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- Filters ----------
const teamKey = (t) => t ?? '_';
const hasTeams = () => (state.summary?.teams ?? []).some((t) => t.id !== null);
function teamInfo(id) { return (state.summary?.teams ?? []).find((t) => t.id === id); }
const inFloor = (s) => !state.floor || s.floor === state.floor;
/** The area the summary cards describe: the chosen floor and layout team. */
const inScope = (s) => inFloor(s) && (!state.team || teamKey(s.team) === state.team);
/** Status and project team highlight matching seats; the rest are dimmed in place. */
const matches = (s) => inScope(s) && (!state.status || s.status === state.status) && (!state.project || s.projectTeam === state.project);
const filtersActive = () => Boolean(state.status || state.project || state.team);

// ---------- Summary cards ----------
function renderKpis() {
  const s = state.summary; if (!s) return;
  const c = { total: 0, available: 0, occupied: 0, away: 0, offline: 0 };
  for (const seat of state.seats.values()) if (inScope(seat)) { c.total++; c[seat.status]++; }
  const rate = c.total ? (c.occupied + c.away) / c.total : 0;
  const floorName = state.floor ? (s.floors.find((f) => f.id === state.floor)?.name ?? state.floor) : 'All floors';
  const teamName = state.team ? (teamInfo(state.team === '_' ? null : state.team)?.name ?? '') : '';
  $('scope').innerHTML = `Showing <b>${esc([floorName, teamName].filter(Boolean).join(' · '))}</b> · ${c.total} seat${c.total === 1 ? '' : 's'}`;
  const tile = (k, color, icon, label, value, sub, extra = '') => `
    <div class="card kpi" style="--k:${color}">
      <div class="icon">${icon}</div>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="sub">${sub}</div>${extra}
    </div>`;
  $('kpis').innerHTML =
    tile('rate', 'var(--accent)', ICON.gauge, 'Occupancy', pct(rate), `${c.occupied + c.away} of ${c.total} seats in use`,
      `<div class="meter" role="presentation"><i style="width:${pct(rate)}"></i></div>`) +
    tile('available', 'var(--available)', STATUS_ICON.available, 'Available', c.available, STATUS.available.sub) +
    tile('occupied', 'var(--seat-occ-ink)', STATUS_ICON.occupied, 'Occupied', c.occupied, STATUS.occupied.sub) +
    tile('away', 'var(--away-ink)', STATUS_ICON.away, 'Away (held)', c.away, `held ≤ ${s.rules.awayGraceMinutes} min, then released`) +
    tile('offline', 'var(--text-muted)', STATUS_ICON.offline, 'Sensor offline', c.offline, STATUS.offline.sub);
}

function renderUpdated() {
  if (state.summary) $('live').dataset.updated = fmtTime(state.summary.at);
  renderLive();
}
let liveOn = false;
function renderLive(text) {
  if (text !== undefined) $('live').dataset.text = text;
  const t = $('live').dataset.text || 'Connecting…';
  const u = $('live').dataset.updated;
  $('live').innerHTML = `${esc(t)}${u ? ` <span class="sep">·</span> Updated ${esc(u)}` : ''}`;
  $('live').classList.toggle('on', liveOn);
}

// ---------- Filter bar ----------
function renderFloorFilter() {
  const floors = state.summary?.floors ?? [];
  if (state.floor && !floors.some((f) => f.id === state.floor)) state.floor = '';
  const opts = [{ id: '', name: 'All floors' }, ...floors];
  $('floorFilter').innerHTML = opts.map((f) =>
    `<button type="button" data-floor="${esc(f.id)}" aria-pressed="${f.id === state.floor}">${esc(f.name)}</button>`).join('');
}

function renderStatusFilter() {
  const opts = [['', 'All statuses', null], ...Object.entries(STATUS).map(([k, v]) => [k, v.label, k])];
  const dot = { available: 'var(--available)', occupied: 'var(--seat-occ-ink)', away: 'var(--away)', offline: 'var(--offline)' };
  $('statusFilter').innerHTML = opts.map(([k, label, d]) =>
    `<button type="button" class="chipbtn" data-status="${k}" aria-pressed="${state.status === k}">${d ? `<span class="dot" style="background:${dot[d]}"></span>` : ''}${esc(label)}</button>`).join('');
}

function renderTeamFilter() {
  // Team features only make sense when the building layout assigns desks to teams.
  const show = hasTeams();
  for (const id of ['layoutTeamMode', 'teamFilter', 'teamSection']) $(id).hidden = !show;
  if (!show) { state.team = ''; if (state.mode === 'team') state.mode = 'project'; }
  syncModeButtons();
  const sel = $('teamFilter');
  const opts = (state.summary?.teams ?? []).map((t) => `<option value="${esc(teamKey(t.id))}">${esc(t.name)}</option>`).join('');
  sel.innerHTML = `<option value="">All teams</option>${opts}`;
  sel.value = state.team;
}

function renderProjectFilter() {
  const sel = $('projectFilter');
  sel.innerHTML = '<option value="">All project teams</option>' +
    state.projects.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');
  if (!state.projects.some((t) => t.name === state.project)) state.project = '';
  sel.value = state.project;
}

function syncFilterControls() {
  syncModeButtons();
  for (const b of $('floorFilter').children) b.setAttribute('aria-pressed', String(b.dataset.floor === state.floor));
  for (const b of $('statusFilter').children) b.setAttribute('aria-pressed', String(b.dataset.status === state.status));
  $('projectFilter').value = state.project; $('projectFilter').classList.toggle('active', Boolean(state.project));
  $('teamFilter').value = state.team; $('teamFilter').classList.toggle('active', Boolean(state.team));
  $('clearFilters').hidden = !filtersActive();
}

function syncModeButtons() {
  for (const x of $('viewMode').children) x.setAttribute('aria-pressed', String(x.dataset.mode === state.mode));
}

/** Filters changed: restyle seats in place (no rebuild), then refresh counts. */
function onFiltersChanged() {
  syncFilterControls(); patchAllSeats(); renderKpis(); updateCounts();
}

$('viewMode').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.mode = b.dataset.mode; safeSet('hotdesk.mode', state.mode);
  syncModeButtons(); renderLegend(); patchAllSeats();
});
$('floorFilter').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.floor = b.dataset.floor; safeSet('hotdesk.floor', state.floor);
  const sel = state.selected && state.seats.get(state.selected);
  if (sel && !inFloor(sel)) select(null);
  syncFilterControls(); renderPlan(); renderKpis(); renderPanel();
});
$('statusFilter').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.status = b.dataset.status; onFiltersChanged();
});
$('projectFilter').addEventListener('change', (e) => { state.project = e.target.value; onFiltersChanged(); });
$('teamFilter').addEventListener('change', (e) => { state.team = e.target.value; onFiltersChanged(); });
function clearFilters() { state.status = ''; state.project = ''; state.team = ''; onFiltersChanged(); }
$('clearFilters').addEventListener('click', clearFilters);
$('noMatch').querySelector('[data-clear]').addEventListener('click', clearFilters);
// Team colours have separate light and dark steps: redraw when the theme changes.
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { renderLegend(); patchAllSeats(); renderProjects(); });

// ---------- Project team colours ----------
const rootStyle = () => getComputedStyle(document.documentElement);
function projectInfo(name) { return name ? state.projects.find((t) => t.name === name) : undefined; }
/** The team's colour as a hex for the current light/dark mode. */
function projectColor(t) {
  if (t.color) return t.color;
  const v = t.slot === null || t.slot === undefined ? '--anon' : `--team-${(t.slot % 8) + 1}`;
  return rootStyle().getPropertyValue(v).trim() || '#7a7974';
}

// ---------- Floor plan ----------
/**
 * Desk surfaces drawn behind the seats. Each group of touching desks becomes one
 * table; a group that isn't a full rectangle falls back to one table per row run.
 * Purely decorative: seats keep their configured row and column.
 */
function deskBlocks(seats) {
  const at = new Map(seats.map((s) => [`${s.row},${s.col}`, s]));
  const seen = new Set();
  const blocks = [];
  for (const s of seats) {
    const key = `${s.row},${s.col}`;
    if (seen.has(key)) continue;
    const group = []; const stack = [s]; seen.add(key);
    while (stack.length) {
      const c = stack.pop(); group.push(c);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${c.row + dr},${c.col + dc}`;
        if (at.has(k) && !seen.has(k)) { seen.add(k); stack.push(at.get(k)); }
      }
    }
    const r0 = Math.min(...group.map((g) => g.row)), r1 = Math.max(...group.map((g) => g.row));
    const c0 = Math.min(...group.map((g) => g.col)), c1 = Math.max(...group.map((g) => g.col));
    if ((r1 - r0 + 1) * (c1 - c0 + 1) === group.length) { blocks.push({ r0, r1, c0, c1 }); continue; }
    const byRow = new Map();
    for (const g of group) byRow.set(g.row, [...(byRow.get(g.row) ?? []), g.col].sort((a, b) => a - b));
    for (const [row, cols] of byRow) {
      let start = cols[0];
      cols.forEach((col, i) => {
        if (cols[i + 1] !== col + 1) { blocks.push({ r0: row, r1: row, c0: start, c1: col }); start = cols[i + 1]; }
      });
    }
  }
  return blocks;
}

function renderPlan() {
  hidePop();
  const floors = (state.summary?.floors ?? []).filter((f) => !state.floor || f.id === state.floor);
  const seats = [...state.seats.values()];
  $('plan').innerHTML = floors.map((f) => `
    <div class="floor">
      <div class="floor-head"><h3>${esc(f.name)}</h3><span class="count" data-floor-count="${esc(f.id)}"></span></div>
      <div class="zones">${f.zones.map((z) => {
        const zs = seats.filter((s) => s.floor === f.id && s.zone === z.id);
        const cols = Math.max(1, ...zs.map((s) => s.col + 1));
        const rows = Math.max(1, ...zs.map((s) => s.row + 1));
        return `<div class="zone">
          <div class="zone-head"><span class="name">${esc(z.name)}</span><span class="free" data-zone-count="${esc(f.id)}|${esc(z.id)}"></span></div>
          <div class="zone-grid" role="group" aria-label="${esc(`${f.name}, ${z.name}`)}" style="grid-template-columns:repeat(${cols}, var(--cell));grid-template-rows:repeat(${rows}, var(--cell))">
            ${deskBlocks(zs).map((b) => `<div class="desk" style="grid-area:${b.r0 + 1} / ${b.c0 + 1} / ${b.r1 + 2} / ${b.c1 + 2}"></div>`).join('')}
            ${zs.map((s) => `<button type="button" class="seat" data-seat="${esc(s.id)}" tabindex="-1" style="grid-area:${s.row + 1} / ${s.col + 1}"></button>`).join('')}
          </div></div>`;
      }).join('')}</div>
    </div>`).join('') || '<div class="empty">No seats configured.</div>';
  // Restart the fade so a floor switch reads as a transition.
  $('plan').style.animation = 'none'; void $('plan').offsetWidth; $('plan').style.animation = '';
  patchAllSeats();
  updateCounts();
}

/** How a seat looks in the current colour mode. */
function seatLook(s) {
  const glyph = { available: '<i class="dot"></i>', occupied: ICON.person, away: ICON.clock, offline: '!' }[s.status];
  if (state.mode === 'team') {
    const color = teamInfo(s.team)?.color;
    return color ? { cls: 'layout', color, text: glyph } : { cls: 'layout-none', color: '', text: glyph };
  }
  if (state.mode === 'project' && (s.status === 'occupied' || s.status === 'away')) {
    const t = projectInfo(s.projectTeam);
    if (t) return { cls: `st-${s.status} team`, color: projectColor(t), text: esc(t.code) };
  }
  return { cls: `st-${s.status}`, color: '', text: glyph };
}

function seatLabel(s) {
  const parts = [`Seat ${s.id}`, STATUS[s.status].label];
  if (s.projectTeam) parts.push(s.projectTeam);
  if (hasTeams()) parts.push(s.teamName ? `assigned to ${s.teamName}` : 'unassigned');
  if (state.selected === s.id) parts.push('selected');
  return parts.join(', ');
}

function patchSeat(el, s = state.seats.get(el.dataset.seat)) {
  if (!s) return;
  const look = seatLook(s);
  const sel = state.selected === s.id;
  const dim = !matches(s);
  const sig = [look.cls, look.color, look.text, sel, dim].join('|');
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    el.className = `seat ${look.cls}${sel ? ' is-selected' : ''}`;
    if (look.color) el.style.setProperty('--c', look.color); else el.style.removeProperty('--c');
    el.innerHTML = look.text + (sel ? `<span class="seat-badge">${ICON.check}</span>` : '');
    el.disabled = dim;
    el.setAttribute('aria-pressed', String(sel));
  }
  el.setAttribute('aria-label', seatLabel(s));
  if (popFor === el) fillPop(el);
}

function patchAllSeats() {
  for (const el of $('plan').querySelectorAll('.seat')) patchSeat(el);
  for (const g of $('plan').querySelectorAll('.zone-grid')) updateRoving(g);
  const any = [...state.seats.values()].some((s) => inFloor(s) && matches(s));
  $('noMatch').hidden = any || !state.seats.size;
}

/** One tab stop per area: the selected seat, else the last focused, else the first enabled seat. */
function updateRoving(grid) {
  const seats = [...grid.querySelectorAll('.seat')];
  const enabled = seats.filter((b) => !b.disabled);
  const current = enabled.find((b) => b.dataset.seat === state.selected)
    ?? enabled.find((b) => b === document.activeElement)
    ?? enabled.find((b) => b.tabIndex === 0) ?? enabled[0];
  for (const b of seats) b.tabIndex = b === current ? 0 : -1;
}

function countsFor(pred) {
  let total = 0, available = 0;
  for (const s of state.seats.values()) if (pred(s)) { total++; if (s.status === 'available') available++; }
  return { total, available };
}
function updateCounts() {
  for (const el of $('plan').querySelectorAll('[data-zone-count]')) {
    const [f, z] = el.dataset.zoneCount.split('|');
    const c = countsFor((s) => s.floor === f && s.zone === z);
    el.innerHTML = `<b>${c.available}</b> of ${c.total} free`;
  }
  for (const el of $('plan').querySelectorAll('[data-floor-count]')) {
    const c = countsFor((s) => s.floor === el.dataset.floorCount);
    el.textContent = `${c.available} of ${c.total} seats available`;
  }
}

// ---------- Selection and keyboard ----------
function select(id) {
  const prev = state.selected;
  state.selected = id;
  if (prev !== id) state.flash = null;
  for (const sid of [prev, id]) {
    if (!sid) continue;
    const el = $('plan').querySelector(`[data-seat="${CSS.escape(sid)}"]`);
    if (el) { patchSeat(el); updateRoving(el.closest('.zone-grid')); }
  }
  renderPanel();
}

$('plan').addEventListener('click', (e) => {
  const b = e.target.closest('.seat'); if (!b || b.disabled) return;
  hidePop();
  select(state.selected === b.dataset.seat ? null : b.dataset.seat);
});

const KEYS = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
$('plan').addEventListener('keydown', (e) => {
  const b = e.target.closest('.seat'); if (!b) return;
  const dir = KEYS[e.key]; if (!dir) return;
  e.preventDefault();
  const cur = state.seats.get(b.dataset.seat);
  let best = null, bestScore = Infinity;
  for (const el of b.closest('.zone-grid').querySelectorAll('.seat:not(:disabled)')) {
    if (el === b) continue;
    const s = state.seats.get(el.dataset.seat);
    const dr = s.row - cur.row, dc = s.col - cur.col;
    if (dir[0] && Math.sign(dr) !== dir[0]) continue;
    if (dir[1] && (Math.sign(dc) !== dir[1] || dr !== 0)) continue;
    const score = dir[0] ? Math.abs(dr) * 1000 + Math.abs(dc) : Math.abs(dc);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return;
  b.tabIndex = -1; best.tabIndex = 0; best.focus();
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !state.selected) return;
  if (e.target.closest?.('input, select')) return;
  const el = $('plan').querySelector(`[data-seat="${CSS.escape(state.selected)}"]`);
  select(null);
  el?.focus({ preventScroll: true });
});

// ---------- Seat popover ----------
const pop = $('pop');
let popFor = null, popTimer = null;
function seatDetails(s) {
  const rows = [['Status', STATUS[s.status].label], ['Location', `${s.floorName} · ${s.zoneName}`]];
  if (hasTeams()) rows.push(['Assigned', s.teamName ?? 'Unassigned (open hot desk)']);
  if (s.projectTeam) rows.push(['Project team', s.projectTeam]);
  if (s.checkedInBy) rows.push(['Checked in', `${s.checkedInBy}, until ${fmtTime(s.checkedInUntil)}`]);
  if (s.status === 'away' && s.lastPresenceAt) rows.push(['Last seen', fmtTime(s.lastPresenceAt)]);
  if (s.holdExpiresAt) rows.push(['Auto-release', fmtTime(s.holdExpiresAt)]);
  rows.push(['Detection', s.hasSensor ? `Sensor ${s.sensorOnline ? (s.presence ? '· presence' : '· no presence') : '· offline'}` : 'QR check-in only']);
  return rows;
}
function fillPop(el) {
  const s = state.seats.get(el.dataset.seat); if (!s) return;
  const hint = state.selected === s.id ? 'Selected · details on the right' : s.status === 'available' ? 'Click to select this seat' : 'Click to view details';
  pop.innerHTML = `<div class="ptitle"><b>${esc(s.id)}</b><span class="pill k-${s.status}">${STATUS[s.status].label}</span></div>
    <dl>${seatDetails(s).slice(1).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="hint">${hint}</div>`;
}
function showPop(el) {
  popFor = el; fillPop(el);
  const r = el.getBoundingClientRect(), p = pop.getBoundingClientRect();
  let top = r.top - p.height - 10;
  if (top < 8) top = r.bottom + 10;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - p.width / 2, innerWidth - p.width - 8));
  pop.style.top = `${top}px`; pop.style.left = `${left}px`;
  pop.classList.add('show');
}
function hidePop() { clearTimeout(popTimer); popFor = null; pop.classList.remove('show'); }
$('plan').addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const b = e.target.closest('.seat');
  if (!b || b.disabled || b === popFor) return;
  clearTimeout(popTimer);
  popTimer = setTimeout(() => showPop(b), popFor ? 0 : 80);
});
$('plan').addEventListener('pointerout', (e) => {
  const b = e.target.closest('.seat');
  if (b && !b.contains(e.relatedTarget)) { clearTimeout(popTimer); if (!b.matches(':focus-visible')) hidePop(); }
});
$('plan').addEventListener('focusin', (e) => {
  const b = e.target.closest('.seat');
  if (b && b.matches(':focus-visible')) { clearTimeout(popTimer); showPop(b); }
});
$('plan').addEventListener('focusout', hidePop);
addEventListener('scroll', hidePop, { passive: true, capture: true });

// ---------- Seat panel ----------
let panelKey = '';
function durationOptions() {
  const o = state.options; if (!o) return '';
  const def = o.checkinDurationMinutes, opts = new Set([def]);
  for (let m = 60; m <= o.checkinMaxMinutes; m += 60) opts.add(m);
  return [...opts].sort((a, b) => a - b)
    .map((m) => `<option value="${m}"${m === def ? ' selected' : ''}>${fmtDuration(m)}${m === def ? ' (default)' : ''}</option>`).join('');
}
function teamOptions(current) {
  const teams = state.options?.projectTeams ?? state.projects.filter((t) => t.configured).map((t) => t.name);
  return '<option value="">Choose a project team…</option>' +
    teams.map((t) => `<option${t === current ? ' selected' : ''}>${esc(t)}</option>`).join('');
}

function renderPanel() {
  const panel = $('panel');
  const s = state.selected && state.seats.get(state.selected);
  panel.classList.toggle('open', Boolean(s));
  if (!s) {
    const key = 'empty';
    const c = countsFor(inScope);
    const html = `<div class="panel-empty">
      <div class="big">${ICON.pointer}</div>
      <h3>Select a seat</h3>
      <p>Hover a seat on the plan to preview it. Click it to see its details and check someone in.</p>
      <div class="stat"><b>${c.available}</b>of ${c.total} seats available${state.floor ? ' on this floor' : ''}</div>
      <div class="kbd-hint"><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> select · <kbd>Esc</kbd> clear</div>
    </div>`;
    if (panelKey === key) panel.querySelector('.panel-empty').outerHTML = html;
    else panel.innerHTML = html;
    panelKey = key;
    return;
  }
  // The form only re-renders when what it does changes, so live updates never wipe typed input.
  const mode = s.checkedInBy ? `manage:${s.checkedInBy}` : 'checkin';
  const key = `${s.id}|${mode}`;
  const details = panelDetails(s);
  if (key === panelKey && panel.querySelector('[data-details]')) {
    panel.querySelector('[data-details]').innerHTML = details;
    return;
  }
  panelKey = key;
  panel.innerHTML = `<div class="panel-inner"><div data-details>${details}</div>${s.checkedInBy ? manageForm(s) : checkinForm(s)}</div>`;
  const form = panel.querySelector('form');
  form?.addEventListener('submit', onPanelSubmit);
}

function panelDetails(s) {
  const usage = [];
  if (s.checkedInBy) usage.push(['Checked in by', s.checkedInBy]);
  if (s.projectTeam) usage.push(['Project team', s.projectTeam]);
  if (s.checkedInAt) usage.push(['Since', fmtTime(s.checkedInAt)]);
  if (s.checkedInUntil) usage.push(['Until', fmtTime(s.checkedInUntil)]);
  if (s.status === 'away' && s.lastPresenceAt) usage.push(['Last seen', fmtTime(s.lastPresenceAt)]);
  if (s.holdExpiresAt) usage.push(['Auto-release', fmtTime(s.holdExpiresAt)]);
  const sensor = s.hasSensor
    ? `<li>${ICON.sensor}<span><b>Presence sensor</b> · ${s.sensorOnline ? (s.presence ? 'someone is at the desk' : 'online, nobody detected') : 'offline'}<br><span class="muted">${esc(s.sensorId)}</span></span></li>`
    : `<li>${ICON.qr}<span><b>QR check-in only</b> · no sensor on this desk</span></li>`;
  const flash = state.flash && state.flash.seatId === s.id
    ? `<div class="flash ok" role="status">${ICON.okCircle}<span>${esc(state.flash.text)}</span></div>` : '';
  return `<div class="phead">
      <div><h2>Seat ${esc(s.id)}</h2><span class="pill k-${s.status}">${STATUS[s.status].label}</span></div>
      <button type="button" class="btn btn-ghost close" aria-label="Close seat details" onclick="select(null)">${ICON.close}</button>
    </div>
    <ul class="meta">
      <li>${ICON.pin}<span><b>${esc(s.floorName)}</b> · ${esc(s.zoneName)}</span></li>
      ${hasTeams() ? `<li>${ICON.users}<span>${s.teamName ? `Assigned to <b>${esc(s.teamName)}</b>` : 'Unassigned (open hot desk)'}</span></li>` : ''}
      ${sensor}
    </ul>
    ${usage.length ? `<div class="usage">${usage.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>` : ''}
    ${flash}`;
}

function checkinForm(s) {
  const lead = s.status === 'available' ? 'Starts now and lasts for the chosen time.'
    : s.status === 'offline' ? 'The sensor is offline, so a check-in is the only way to show this desk as taken.'
    : 'Someone is at this desk but nobody has checked in. You can check in the person sitting here.';
  return `<form class="pform" data-kind="checkin" novalidate>
    <h3>Check in to this seat</h3>
    <p class="lead">${lead}</p>
    <label>Name or employee ID<input name="user" autocomplete="off" maxlength="100" required></label>
    <label>Project team<select name="team" required>${teamOptions('')}</select></label>
    <label>Duration<select name="minutes">${durationOptions()}</select></label>
    <div class="form-msg" role="alert"></div>
    <button type="submit" class="btn btn-primary btn-block" value="checkin">Check in to this seat</button>
    <p class="note">${ICON.info}<span>One seat per person: checking in releases any other seat held under the same name.</span></p>
  </form>`;
}

function manageForm(s) {
  return `<form class="pform" data-kind="manage" novalidate>
    <h3>Manage this check-in</h3>
    <p class="lead">Extend restarts the check-in from now. Check out frees the desk straight away.</p>
    <label>Project team<select name="team" required>${teamOptions(s.projectTeam)}</select></label>
    <label>Duration (for extend)<select name="minutes">${durationOptions()}</select></label>
    <div class="form-msg" role="alert"></div>
    <div class="btnrow">
      <button type="submit" class="btn btn-primary" value="renew">Extend</button>
      <button type="submit" class="btn" value="checkout">Check out</button>
    </div>
  </form>`;
}

async function onPanelSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const action = e.submitter?.value ?? 'checkin';
  const s = state.seats.get(state.selected); if (!s) return;
  const msg = form.querySelector('.form-msg');
  const fail = (text, field) => { msg.textContent = text; if (field) form.elements[field].focus(); };
  msg.textContent = '';
  const user = action === 'checkin' ? form.elements.user.value.trim() : s.checkedInBy;
  const projectTeam = form.elements.team.value;
  if (!user) return fail('Enter the name or employee ID of the person checking in.', 'user');
  if (!projectTeam) return fail('Choose a project team.', 'team');
  const buttons = [...form.querySelectorAll('button')];
  const label = e.submitter?.textContent;
  buttons.forEach((b) => { b.disabled = true; });
  if (e.submitter) e.submitter.textContent = { checkin: 'Checking in…', renew: 'Extending…', checkout: 'Checking out…' }[action];
  try {
    const path = `/api/seats/${encodeURIComponent(s.id)}/${action === 'checkout' ? 'checkout' : 'checkin'}`;
    const body = action === 'checkout' ? { user, projectTeam } : { user, projectTeam, minutes: Number(form.elements.minutes.value) };
    const seat = await post(path, body);
    state.flash = {
      seatId: s.id,
      text: action === 'checkout' ? `${user} checked out. The desk is free for others.`
        : action === 'renew' ? `Extended: ${user} (${projectTeam}) until ${fmtTime(seat.checkedInUntil)}.`
        : `${user} (${projectTeam}) is checked in until ${fmtTime(seat.checkedInUntil)}.`,
    };
    // Renewals and check-ins on an already-occupied desk don't change status, so no live event
    // arrives for them: reload the seats to show the new holder and times straight away.
    await reloadSeats();
  } catch (err) {
    buttons.forEach((b) => { b.disabled = false; });
    if (e.submitter) e.submitter.textContent = label;
    fail(err.message);
  }
}

async function reloadSeats() {
  const seats = await api('/api/seats');
  for (const s of seats) state.seats.set(s.id, s);
  panelKey = '';
  patchAllSeats(); updateCounts(); renderKpis(); renderPanel();
  refreshSummarySoon();
}

// ---------- Legend ----------
function sample(cls, inner, style = '') { return `<span class="seat ${cls}" style="${style}" aria-hidden="true">${inner}</span>`; }
function renderLegend() {
  const status = `<div class="lgroup"><b>Seats</b>
    <span class="litem">${sample('st-available', '<i class="dot"></i>')}Available</span>
    <span class="litem">${sample('st-available is-selected', `<i class="dot"></i><span class="seat-badge">${ICON.check}</span>`)}Selected</span>
    <span class="litem">${sample('st-occupied', ICON.person)}Occupied${state.mode === 'project' ? ', not checked in' : ''}</span>
    <span class="litem">${sample('st-away', ICON.clock)}Away (held)${state.mode === 'project' ? ', not checked in' : ''}</span>
    <span class="litem">${sample('st-offline', '!')}Sensor offline</span>
    <span class="litem"><span class="desk" style="display:inline-block;width:28px;height:14px;margin:0"></span>Desk</span></div>`;
  let extra = '';
  if (state.mode === 'project') {
    const t0 = state.projects.find((t) => t.configured);
    extra = `<div class="lgroup"><b>Project teams</b>${state.projects.filter((t) => t.configured).map((t) =>
      `<span class="litem"><span class="chip" style="--c:${projectColor(t)}">${esc(t.code)}</span>${esc(t.name)}</span>`).join('')}
      ${t0 ? `<span class="litem">${sample('st-away team', esc(t0.code), `--c:${projectColor(t0)};--cell:auto;min-width:34px;height:20px;padding:0 5px`)}Away, held for the team (dashed)</span>` : ''}</div>`;
  } else if (state.mode === 'team') {
    extra = `<div class="lgroup"><b>Team assignment</b>${(state.summary?.teams ?? []).map((t) => t.color
      ? `<span class="litem"><span class="swatch" style="background:${t.color}"></span>${esc(t.name)}</span>`
      : `<span class="litem"><span class="swatch" style="box-shadow:inset 0 0 0 1.5px var(--text-muted)"></span>${esc(t.name)}</span>`).join('')}</div>`;
  }
  $('legend').innerHTML = status + extra;
}

// ---------- Zone and team tables ----------
const meterCell = (rate) => `<td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i style="width:${pct(rate)}"></i></div>
  <span style="width:3em;text-align:right">${pct(rate)}</span></div></td>`;
function renderZones() {
  const rows = (state.summary?.floors ?? []).flatMap((f) => f.zones.map((z) => ({ floor: f.name, ...z })));
  $('zones').innerHTML = `<thead><tr><th>Floor</th><th>Zone</th><th class="num">Seats</th><th class="num">Available</th>
    <th class="num">Occupied</th><th class="num">Away</th><th class="num">Offline</th><th>Occupancy</th></tr></thead>
    <tbody>${rows.map((z) => `<tr><td>${esc(z.floor)}</td><td>${esc(z.name)}</td><td class="num">${z.total}</td>
      <td class="num">${z.available}</td><td class="num">${z.occupied}</td><td class="num">${z.away}</td><td class="num">${z.offline}</td>
      ${meterCell(z.occupancyRate)}</tr>`).join('')}</tbody>`;
}

function renderTeams() {
  const rows = state.summary?.teams ?? [];
  $('teamsTable').innerHTML = `<thead><tr><th>Team</th><th class="num">Desks</th><th class="num">Available</th>
    <th class="num">Occupied</th><th class="num">Away</th><th class="num">Offline</th><th>Occupancy</th></tr></thead>
    <tbody>${rows.map((t) => `<tr><td><span style="display:inline-flex;align-items:center;gap:8px">
      <span class="swatch" style="${t.color ? `background:${t.color}` : 'box-shadow:inset 0 0 0 1.5px var(--text-muted)'}"></span>${esc(t.name)}</span></td>
      <td class="num">${t.total}</td><td class="num">${t.available}</td><td class="num">${t.occupied}</td><td class="num">${t.away}</td><td class="num">${t.offline}</td>
      ${meterCell(t.occupancyRate)}</tr>`).join('')}</tbody>`;
}

// ---------- Project teams ----------
function renderProjects() {
  const rows = state.projects;
  const total = (k) => rows.reduce((n, t) => n + t[k], 0);
  const person = (r) => `<li><span>${esc(r.name)}</span><span class="muted">${r.checkedInAt
    ? `at <b>${esc(r.checkedInAt)}</b> until ${fmtTime(r.checkedInUntil)}`
    : r.lastCheckInAt ? `last in ${new Date(r.lastCheckInAt).toLocaleDateString()} (${esc(r.lastSeatId ?? '')})` : ''}</span></li>`;
  $('projects').innerHTML = `<thead><tr><th>Project team</th><th class="num">Checked in now</th><th class="num">Check-ins today</th>
    <th class="num">Check-outs today</th><th>Requesters</th></tr></thead>
    <tbody>${rows.map((t) => `<tr>
      <td><span style="display:inline-flex;align-items:center;gap:10px"><span class="chip" style="--c:${projectColor(t)}">${esc(t.code)}</span>${esc(t.name)}${t.configured ? '' : ' <span class="muted">(no longer offered)</span>'}</span></td>
      <td class="num">${t.checkedInNow}</td><td class="num">${t.checkinsToday}</td><td class="num">${t.checkoutsToday}</td>
      <td>${t.requesters.length
        ? `<details class="reqs"><summary>${t.requesters.length} requester${t.requesters.length === 1 ? '' : 's'}</summary><ul>${t.requesters.map(person).join('')}</ul></details>`
        : '<span class="muted">none yet</span>'}</td></tr>`).join('')}
      <tr><td><b>Total</b></td><td class="num"><b>${total('checkedInNow')}</b></td><td class="num"><b>${total('checkinsToday')}</b></td>
      <td class="num"><b>${total('checkoutsToday')}</b></td><td class="muted">${rows.reduce((n, t) => n + t.requesters.length, 0)} requesters</td></tr></tbody>`;
}

async function loadProjects() {
  // Keep open requester lists open across refreshes.
  const open = new Set([...document.querySelectorAll('#projects details[open]')].map((d) => d.closest('tr').firstElementChild.textContent));
  const before = JSON.stringify(state.projects.map((t) => [t.name, t.code, t.color, t.slot]));
  state.projects = await api('/api/project-teams/summary');
  renderProjectFilter(); renderProjects();
  // Codes and colours arrive with the summary: restyle the plan once they're known or change.
  if (before !== JSON.stringify(state.projects.map((t) => [t.name, t.code, t.color, t.slot]))) { renderLegend(); patchAllSeats(); }
  document.querySelectorAll('#projects details').forEach((d) => { if (open.has(d.closest('tr').firstElementChild.textContent)) d.open = true; });
}

// ---------- Activity ----------
const who = (a) => `${esc(a.detail)}${a.team ? ` <span class="muted">(${esc(a.team)})</span>` : ''}`;
const ACT = {
  checkin: (a) => `${who(a)} checked in at <b>${esc(a.seatId)}</b>`,
  checkout: (a) => `${who(a)} checked out of <b>${esc(a.seatId)}</b>`,
  moved: (a) => `${who(a)} moved away from <b>${esc(a.seatId)}</b>`,
  renew: (a) => `${who(a)} extended their check-in at <b>${esc(a.seatId)}</b>`,
  expired: (a) => `${who(a)}: check-in at <b>${esc(a.seatId)}</b> expired`,
  'auto-release': (a) => `<b>${esc(a.seatId)}</b> auto-released${a.detail ? ` (was ${esc(a.detail)})` : ''}`,
  status: (a) => `<b>${esc(a.seatId)}</b> ${esc(a.detail)}`,
};
async function renderFeed() {
  const items = await api('/api/activity');
  $('feed').innerHTML = items.slice(0, 60).map((a) =>
    `<li><time>${fmtTime(a.at)}</time><span>${(ACT[a.type] ?? ACT.status)(a)}</span></li>`).join('')
    || '<li class="empty">No activity yet. Check-ins and sensor changes appear here.</li>';
}

// ---------- Occupancy chart (single series: % of seats in use) ----------
const tip = $('tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 14, innerWidth - r.width - 8) + 'px';
  tip.style.top = Math.min(y + 14, innerHeight - r.height - 8) + 'px';
}
function hideTip() { tip.style.display = 'none'; }

let history = [];
function renderChart() {
  const el = $('chart');
  if (history.length < 2) { el.innerHTML = '<div class="empty">Collecting data. A sample is taken every minute.</div>'; return; }
  const W = el.clientWidth || 600, H = 200, m = { l: 40, r: 12, t: 10, b: 24 };
  const t0 = history[0].t, t1 = history.at(-1).t;
  const x = (t) => m.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - v) * (H - m.t - m.b);
  const rate = (h) => (h.total ? (h.occupied + h.away) / h.total : 0);
  const d = history.map((h, i) => `${i ? 'L' : 'M'}${x(h.t).toFixed(1)},${y(rate(h)).toFixed(1)}`).join('');
  const area = `${d}L${x(t1)},${y(0)}L${x(t0)},${y(0)}Z`;
  const yt = [0, 0.25, 0.5, 0.75, 1];
  const nx = Math.min(6, Math.max(2, Math.floor(W / 110)), Math.max(2, Math.floor((t1 - t0) / 60_000) + 1));
  const xt = Array.from({ length: nx }, (_, i) => t0 + ((t1 - t0) * i) / (nx - 1));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Seat occupancy rate over the last 24 hours">
    ${yt.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>
      <text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">${pct(v)}</text>`).join('')}
    ${xt.map((t, i) => `<text x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle'}" font-size="11" fill="var(--text-muted)">${fmtTime(t)}</text>`).join('')}
    <path d="${area}" fill="var(--line)" opacity="0.12"/>
    <path d="${d}" fill="none" stroke="var(--line)" stroke-width="2" stroke-linejoin="round"/>
    <line id="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--text-muted)" stroke-dasharray="3 3" visibility="hidden"/>
    <circle id="xd" r="4" fill="var(--line)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="hit"/>
  </svg>`;
  const chart = el.querySelector('svg');
  chart.querySelector('#hit').addEventListener('pointermove', (e) => {
    const r = chart.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - m.l) / (W - m.l - m.r)) * (t1 - t0);
    let h = history[0];
    for (const s of history) if (Math.abs(s.t - t) < Math.abs(h.t - t)) h = s;
    const xh = chart.querySelector('#xh'), xd = chart.querySelector('#xd');
    xh.setAttribute('x1', x(h.t)); xh.setAttribute('x2', x(h.t)); xh.setAttribute('visibility', 'visible');
    xd.setAttribute('cx', x(h.t)); xd.setAttribute('cy', y(rate(h))); xd.setAttribute('visibility', 'visible');
    showTip(`<b>${fmtTime(h.t)} · ${pct(rate(h))} in use</b>Occupied ${h.occupied} · Away ${h.away}<br>Available ${h.available} · Offline ${h.offline}`, e.clientX, e.clientY);
  });
  chart.querySelector('#hit').addEventListener('pointerleave', () => {
    chart.querySelector('#xh').setAttribute('visibility', 'hidden');
    chart.querySelector('#xd').setAttribute('visibility', 'hidden');
    hideTip();
  });
}
addEventListener('resize', () => renderChart());

// ---------- Section navigation ----------
const navLinks = [...document.querySelectorAll('#nav a[data-section]')];
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) {
    for (const a of navLinks) a.setAttribute('aria-current', String(a.dataset.section === e.target.id));
  }
}, { rootMargin: '-30% 0px -60% 0px' });
for (const a of navLinks) { const s = $(a.dataset.section); if (s) spy.observe(s); }

// ---------- Live updates ----------
let summaryTimer = null;
function refreshSummarySoon() {
  if (summaryTimer) return;
  summaryTimer = setTimeout(async () => {
    summaryTimer = null;
    try {
      state.summary = await api('/api/summary');
      renderUpdated(); renderKpis(); renderZones(); renderTeams(); renderFeed(); loadProjects();
    } catch (e) { console.error(e); }
  }, 400);
}

function connect() {
  const es = new EventSource(withToken('/api/stream'));
  es.addEventListener('snapshot', (e) => {
    const { seats, summary } = JSON.parse(e.data);
    state.seats = new Map(seats.map((s) => [s.id, s]));
    state.summary = summary;
    if (state.selected && !state.seats.has(state.selected)) state.selected = null;
    liveOn = true; renderLive('Live'); renderUpdated();
    renderFloorFilter(); renderStatusFilter(); renderTeamFilter(); syncFilterControls();
    renderKpis(); renderLegend(); renderPlan(); renderPanel(); renderZones(); renderTeams();
  });
  es.addEventListener('seat', (e) => {
    const s = JSON.parse(e.data);
    state.seats.set(s.id, s);
    const el = $('plan').querySelector(`[data-seat="${CSS.escape(s.id)}"]`);
    if (el) { patchSeat(el, s); updateRoving(el.closest('.zone-grid')); }
    updateCounts(); renderKpis();
    if (state.selected === s.id || !state.selected) renderPanel();
    $('noMatch').hidden = [...state.seats.values()].some((x) => inFloor(x) && matches(x));
    refreshSummarySoon();
  });
  es.onerror = () => { liveOn = false; renderLive('Reconnecting…'); };
}

function renderLoading() {
  $('kpis').innerHTML = Array.from({ length: 5 }, () =>
    '<div class="card kpi loading" aria-hidden="true"><div class="icon"></div><div class="label">Loading</div><div class="value">00</div><div class="sub">loading seats</div></div>').join('');
  renderPanel();
}

async function start() {
  renderLoading();
  try {
    await api('/api/summary'); // triggers the token prompt before opening the stream
    $('labelsLink').href = withToken('/labels');
    $('sensorsLink').href = withToken('/sensors');
    $('requestersCsv').href = withToken('/api/requesters.csv');
    fetch('/api/checkin-options').then((r) => r.json()).then((o) => { state.options = o; panelKey = ''; renderPanel(); }).catch(() => {});
    loadProjects();
    connect();
    renderFeed();
    const loadHistory = async () => { history = await api('/api/history'); renderChart(); };
    loadHistory();
    setInterval(loadHistory, 60_000);
    setInterval(refreshSummarySoon, 30_000); // hold timers expire without a sensor event
  } catch (e) {
    renderLive('Not authorised');
    $('plan').innerHTML = '<div class="empty">An administrator token is needed to view the floor plan. Reload the page to enter it.</div>';
    $('kpis').innerHTML = '';
  }
}
start();
