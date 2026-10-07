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
  trash: svg('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>', 'i'),
  okCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>', 'i'),
};
const STATUS_ICON = { available: ICON.seat, occupied: ICON.person.replace('<svg class=""', '<svg class="i"'), away: ICON.clock.replace('<svg class=""', '<svg class="i"'), offline: ICON.alert };

const params = new URLSearchParams(location.search);
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
let token = params.get('token') || safeGet('hotdesk.token') || '';

const state = {
  seats: new Map(), summary: null, projects: [], options: null, plans: new Map(),
  floor: safeGet('hotdesk.floor') || '', status: '', team: '', project: '', mode: safeGet('hotdesk.mode') || 'project',
  // 'live' shows seat status; 'alloc' pre-allocates seats to projects.
  view: safeGet('hotdesk.view') === 'alloc' ? 'alloc' : 'live', allocProjects: [], activeProject: null,
  // The project someone is booking for: its pre-allocated seats are highlighted on the plan.
  bookingFor: safeGet('hotdesk.bookingFor') || '', allocAck: '',
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

/** Admin write call (POST/PATCH/PUT/DELETE) with the token; throws the server's message. */
async function apiSend(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
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
    tile('occupied', 'var(--seat-occupied)', STATUS_ICON.occupied, 'Occupied', c.occupied, STATUS.occupied.sub) +
    tile('away', 'var(--seat-away-ink)', STATUS_ICON.away, 'Away (held)', c.away, `held ≤ ${s.rules.awayGraceMinutes} min, then released`) +
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
  const dot = { available: 'var(--seat-available)', occupied: 'var(--seat-occupied)', away: 'var(--seat-away)', offline: 'var(--seat-offline)' };
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
  if (!state.selected) renderPanel();
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
const redrawColours = () => { renderLegend(); patchAllSeats(); renderProjects(); renderChart(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', redrawColours);

// ---------- Theme toggle: match system (default), light or dark; remembered per browser ----------
function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  for (const b of $('themeToggle').children) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === (choice || 'system')));
}
applyTheme(safeGet('hotdesk.theme'));
$('themeToggle').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const choice = b.dataset.themeChoice;
  if (choice === 'system') { try { localStorage.removeItem('hotdesk.theme'); } catch {} } else safeSet('hotdesk.theme', choice);
  applyTheme(choice);
  redrawColours();
});

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
// Each floor is one SVG (public/floorplan.js). Seats are its only interactive parts; the
// office around them is context. Scale: fit the card width, but never below TAP_SCALE
// (MOUSE_SCALE with a mouse) px per plan unit so chairs stay easy to hit; past that the plan scrolls.
const MIN_SCALE = 3.5, MOUSE_SCALE = 4.2, TAP_SCALE = 6, FIT_CAP = 8, MAX_SCALE = 18;
let layouts = [];
let zoom = 1;

function renderPlan() {
  hidePop();
  const floors = (state.summary?.floors ?? []).filter((f) => !state.floor || f.id === state.floor);
  const seats = [...state.seats.values()];
  layouts = floors.map((f) => FloorPlan.layoutFloor(f, seats, state.plans.get(f.id)));
  $('plan').innerHTML = layouts.map((fl) => `
    <div class="floor">
      <div class="floor-head"><h3>${esc(fl.name)}</h3><span class="count" data-floor-count="${esc(fl.id)}"></span>
        ${state.planError ? '<span class="fp-note warn">The server did not send the floor-plan drawing. Restart it to load the latest version.</span>'
          : fl.plan.generic ? '<span class="fp-note">Generic outline: walls and facilities are not mapped for this floor yet.</span>' : ''}</div>
      <div class="fp-scroll">${FloorPlan.floorSVG(fl)}</div>
    </div>`).join('') || '<div class="empty">No seats configured.</div>';
  // Restart the fade so a floor switch reads as a transition.
  $('plan').style.animation = 'none'; void $('plan').offsetWidth; $('plan').style.animation = '';
  applyScale();
  patchAllSeats();
  updateCounts();
}

function baseScale(fl) {
  const avail = $('plan').clientWidth - 24;
  // Touch needs bigger targets than a mouse; below this size the plan scrolls instead.
  const min = matchMedia('(pointer: coarse)').matches ? TAP_SCALE : MOUSE_SCALE;
  return Math.min(FIT_CAP, Math.max(min, avail / (fl.w + 2)));
}
function applyScale() {
  $('plan').querySelectorAll('svg.fp').forEach((svg, i) => {
    const fl = layouts[i]; if (!fl) return;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, baseScale(fl) * zoom));
    svg.setAttribute('width', Math.round(Number(svg.dataset.w) * s));
    svg.setAttribute('height', Math.round(Number(svg.dataset.h) * s));
    // Small seat numbers only where they are big enough to read.
    svg.classList.toggle('show-nums', s >= 9);
  });
  $('zoomLevel').textContent = `${Math.round(zoom * 100)}%`;
}
addEventListener('resize', () => applyScale());
$('zoom').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  zoom = b.dataset.zoom === 'in' ? Math.min(2.5, zoom * 1.25) : b.dataset.zoom === 'out' ? Math.max(0.5, zoom / 1.25) : 1;
  applyScale();
  if (state.selected) revealSeat(state.selected, 'auto');
});

const seatEl = (id) => $('plan').querySelector(`.seat[data-seat="${CSS.escape(id)}"]`);
const isOn = (el) => !el.classList.contains('is-dim');

/** Scroll the plan (not the page) so a seat is in view, e.g. after the panel narrows the plan. */
function revealSeat(id, behavior = 'smooth') {
  const el = seatEl(id); if (!el) return;
  const box = el.closest('.fp-scroll'), r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  const m = 48;
  let dx = 0, dy = 0;
  if (r.left < b.left + m) dx = r.left - b.left - m; else if (r.right > b.right - m) dx = r.right - b.right + m;
  if (r.top < b.top + m) dy = r.top - b.top - m; else if (r.bottom > b.bottom - m) dy = r.bottom - b.bottom + m;
  if (dx || dy) box.scrollBy({ left: dx, top: dy, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior });
}

/** How a seat looks in the current colour mode: classes on the workstation, plus a colour. */
function seatLook(s) {
  if (state.view === 'alloc') {
    const t = allocProject(s.allocatedTo);
    if (!t) return { cls: 'alloc-free', color: '' };
    return { cls: `alloc ${t.name === state.activeProject ? 'alloc-mine' : 'alloc-other'}`, color: projectColor(t) };
  }
  const look = liveLook(s);
  if (state.bookingFor && s.allocatedTo === state.bookingFor) {
    const t = projectInfo(state.bookingFor);
    return { ...look, cls: `${look.cls} prealloc`, pa: t ? projectColor(t) : 'var(--accent)' };
  }
  return look;
}

function liveLook(s) {
  const base = { cls: `st-${s.status}`, color: '' };
  if (state.mode === 'team') {
    const color = teamInfo(s.team)?.color;
    return color ? { cls: `layout st-${s.status}`, color } : base;
  }
  if (state.mode === 'project' && s.status === 'occupied') {
    const t = projectInfo(s.projectTeam);
    if (t) return { cls: 'st-occupied team', color: projectColor(t) };
  }
  return base;
}

function seatLabel(s) {
  const parts = [`Seat ${s.id}`, STATUS[s.status].label, s.zoneName];
  if (s.allocatedTo) parts.push(`allocated to ${s.allocatedTo}`);
  if (s.projectTeam) parts.push(s.projectTeam);
  if (hasTeams()) parts.push(s.teamName ? `assigned to ${s.teamName}` : 'unassigned');
  if (state.selected === s.id) parts.push('selected');
  return parts.join(', ');
}

function patchSeat(el, s = state.seats.get(el.dataset.seat)) {
  if (!s) return;
  const look = seatLook(s);
  const sel = state.view === 'live' && state.selected === s.id;
  const dim = state.view === 'live' ? !matches(s) : !inFloor(s);
  const sig = [look.cls, look.color, look.pa, sel, dim].join('|');
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    el.setAttribute('class', `seat ${look.cls}${sel ? ' is-selected' : ''}${dim ? ' is-dim' : ''}`);
    if (look.color) el.style.setProperty('--c', look.color); else el.style.removeProperty('--c');
    if (look.pa) el.style.setProperty('--pa', look.pa); else el.style.removeProperty('--pa');
    el.setAttribute('aria-pressed', String(sel));
    if (dim) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
  }
  el.setAttribute('aria-label', seatLabel(s));
  if (popFor === el) fillPop(el);
}

function patchAllSeats() {
  for (const el of $('plan').querySelectorAll('.seat')) patchSeat(el);
  for (const z of $('plan').querySelectorAll('.fp-zone')) updateRoving(z);
  const any = [...state.seats.values()].some((s) => inFloor(s) && matches(s));
  $('noMatch').hidden = any || !state.seats.size || state.view === 'alloc';
}

/** One tab stop per zone: the selected seat, else the last focused, else the first enabled seat. */
function updateRoving(zone) {
  if (!zone) return;
  const seats = [...zone.querySelectorAll('.seat')];
  const enabled = seats.filter(isOn);
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
    el.textContent = `${c.available} of ${c.total} free`;
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
    const el = seatEl(sid);
    if (el) { patchSeat(el); updateRoving(el.closest('.fp-zone')); }
  }
  renderPanel();
  // If the plan is scrolled or zoomed, bring the chosen seat into sight.
  if (id) revealSeat(id);
}

/** A seat was clicked or Enter was pressed on it. */
function activate(id) {
  hidePop();
  if (state.view === 'alloc') toggleAllocation(id);
  else select(state.selected === id ? null : id);
}
$('plan').addEventListener('click', (e) => {
  const b = e.target.closest('.seat'); if (!b || !isOn(b)) return;
  activate(b.dataset.seat);
});

const KEYS = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
$('plan').addEventListener('keydown', (e) => {
  const b = e.target.closest('.seat'); if (!b) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    activate(b.dataset.seat);
    return;
  }
  const dir = KEYS[e.key]; if (!dir) return;
  e.preventDefault();
  // Move by where seats are drawn, not by map row/column: counters and benches don't line up.
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const [x0, y0] = centre(b);
  let best = null, bestScore = Infinity;
  for (const el of b.closest('.fp-zone').querySelectorAll('.seat')) {
    if (el === b || !isOn(el)) continue;
    const [x, y] = centre(el);
    const along = dir[1] ? (x - x0) * dir[1] : (y - y0) * dir[0];
    const across = dir[1] ? Math.abs(y - y0) : Math.abs(x - x0);
    if (along < 2) continue;
    const score = along + across * 3;
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
function seatDetails(s, el) {
  const rows = [`${s.zoneName} · ${s.floorName}`];
  if (s.allocatedTo) rows.push(`Allocated to ${s.allocatedTo}`);
  if (s.checkedInBy) rows.push(`Name: ${s.checkedInBy}`);
  if (s.projectTeam) rows.push(`Project team: ${s.projectTeam}`);
  if (hasTeams()) rows.push(s.teamName ? `Assigned to ${s.teamName}` : 'Open hot desk');
  const n = Number(el?.dataset.tableSeats);
  if (el?.dataset.kind) rows.push(n > 1 ? `${el.dataset.kind} · ${n} seats` : el.dataset.kind);
  if (s.holdExpiresAt) rows.push(`Auto-release ${fmtTime(s.holdExpiresAt)}`);
  if (!s.hasSensor) rows.push('QR check-in only');
  return rows;
}
function fillPop(el) {
  const s = state.seats.get(el.dataset.seat); if (!s) return;
  pop.innerHTML = `<div class="ptitle"><b>Seat ${esc(s.id)}</b><span class="pill k-${s.status}">${STATUS[s.status].label}</span></div>
    ${seatDetails(s, el).map((r) => `<div>${esc(r)}</div>`).join('')}`;
}
/** Beside the workstation, on its chair (aisle) side, so the table's other seats stay visible. */
function showPop(el) {
  popFor = el; fillPop(el);
  const r = el.getBoundingClientRect(), p = pop.getBoundingClientRect(), gap = 10;
  const fitsLeft = r.left - p.width - gap > 8, fitsRight = r.right + p.width + gap < innerWidth - 8;
  let left, top = r.top + r.height / 2 - p.height / 2;
  const side = el.dataset.side;
  if (side === 'bottom' || (!fitsLeft && !fitsRight)) {
    left = r.left + r.width / 2 - p.width / 2;
    top = r.bottom + p.height + gap < innerHeight ? r.bottom + gap : r.top - p.height - gap;
  } else if ((side === 'left' && fitsLeft) || !fitsRight) left = r.left - p.width - gap;
  else left = r.right + gap;
  pop.style.left = `${Math.max(8, Math.min(left, innerWidth - p.width - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(top, innerHeight - p.height - 8))}px`;
  pop.classList.add('show');
}
function hidePop() { clearTimeout(popTimer); popFor = null; pop.classList.remove('show'); }
$('plan').addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const b = e.target.closest('.seat');
  if (!b || !isOn(b) || b === popFor) return;
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
  if (state.view === 'alloc') { panel.classList.remove('open'); renderAllocPanel(); return; }
  if (panelKey.startsWith('alloc')) { panel.innerHTML = ''; panelKey = ''; }
  const s = state.selected && state.seats.get(state.selected);
  panel.classList.toggle('open', Boolean(s));
  if (!s) {
    const html = idlePanel();
    if (panelKey === 'idle') {
      panel.querySelector('.panel-empty').outerHTML = html;
      if (document.activeElement?.id !== 'bookFor') panel.querySelector('#bookFor').innerHTML = bookingOptions();
    } else {
      panel.innerHTML = `<div class="book-bar"><label for="bookFor">Booking for project</label>
        <select id="bookFor">${bookingOptions()}</select><div class="book-sum" id="bookSum"></div></div>${html}`;
    }
    panelKey = 'idle';
    renderBookingSummary();
    return;
  }
  // The form only re-renders when what it does changes, so live updates never wipe typed input.
  const mode = s.checkedInBy ? `manage:${s.checkedInBy}` : 'checkin';
  const key = `${s.id}|${mode}`;
  const details = panelDetails(s);
  if (key === panelKey && panel.querySelector('[data-details]')) {
    panel.querySelector('[data-details]').innerHTML = details;
    updateAllocWarning();
    return;
  }
  panelKey = key;
  panel.innerHTML = `<div class="panel-inner"><div data-details>${details}</div>${s.checkedInBy ? manageForm(s) : checkinForm(s)}</div>`;
  const form = panel.querySelector('form');
  form?.addEventListener('submit', onPanelSubmit);
  updateAllocWarning();
}

// ---------- Booking for a project: pre-allocated seats ----------
const allocatedTo = (team) => [...state.seats.values()].filter((x) => x.allocatedTo === team);
const freeOf = (list) => list.filter((x) => x.status === 'available' || x.status === 'offline');

function bookingOptions() {
  const teams = state.options?.projectTeams ?? [];
  return `<option value="">Any project</option>` + teams.map((t) => {
    const n = allocatedTo(t).length;
    return `<option value="${esc(t)}"${t === state.bookingFor ? ' selected' : ''}>${esc(t)}${n ? ` (${n} pre-allocated)` : ''}</option>`;
  }).join('');
}

function renderBookingSummary() {
  const el = $('bookSum'); if (!el) return;
  const team = state.bookingFor;
  if (!team) { el.innerHTML = ''; return; }
  const mine = allocatedTo(team), free = freeOf(mine);
  const t = projectInfo(team);
  el.innerHTML = mine.length
    ? `<span class="book-sw" style="background:${t ? projectColor(t) : 'var(--accent)'}"></span><span><b>${mine.length}</b> seat${mine.length === 1 ? '' : 's'} pre-allocated to ${esc(team)} are highlighted · <b>${free.length}</b> free now</span>`
    : `<span>${esc(team)} has no pre-allocated seats. Any free seat can be chosen.</span>`;
}

function setBookingFor(team) {
  state.bookingFor = team; state.allocAck = '';
  if (team) safeSet('hotdesk.bookingFor', team); else { try { localStorage.removeItem('hotdesk.bookingFor'); } catch {} }
  patchAllSeats(); renderBookingSummary(); updateAllocWarning();
}

/**
 * When the chosen seat is not one of the project's pre-allocated seats, say so and offer
 * the project's free pre-allocated seats instead, or continuing with this seat anyway.
 */
function updateAllocWarning() {
  const box = $('allocWarn'), form = box?.closest('form');
  if (!box || !form) return;
  const s = state.seats.get(state.selected), team = form.elements.team.value;
  const submit = form.querySelector('button[type=submit]');
  const mine = team ? allocatedTo(team) : [];
  if (!s || !mine.length || s.allocatedTo === team) { box.hidden = true; box.innerHTML = ''; submit.disabled = false; return; }
  box.hidden = false;
  if (state.allocAck === `${s.id}|${team}`) {
    box.className = 'alloc-warn ack';
    box.innerHTML = `${ICON.info}<span>Continuing with ${esc(s.id)}, which is not pre-allocated to ${esc(team)}.</span>`;
    submit.disabled = false;
    return;
  }
  const free = freeOf(mine).filter((x) => x.id !== s.id);
  box.className = 'alloc-warn';
  box.innerHTML = `<div class="aw-head">${ICON.alert}<span><b>${esc(s.id)} is not pre-allocated to ${esc(team)}.</b>
      ${s.allocatedTo ? `It is pre-allocated to ${esc(s.allocatedTo)}.` : 'It is not pre-allocated to any project.'}</span></div>
    ${free.length
      ? `<div class="aw-list"><span>${esc(team)}'s free pre-allocated seats:</span>${free.slice(0, 8).map((x) => `<button type="button" class="aw-seat" data-goto="${esc(x.id)}">${esc(x.id)}</button>`).join('')}${free.length > 8 ? `<span class="muted">+${free.length - 8} more</span>` : ''}</div>`
      : `<div class="aw-list muted">All of ${esc(team)}'s pre-allocated seats are taken right now.</div>`}
    <div class="aw-actions">
      <button type="button" class="btn" data-aw="another">Choose another seat</button>
      <button type="button" class="btn btn-primary" data-aw="continue">Continue with this seat</button>
    </div>`;
  submit.disabled = true;
}

$('panel').addEventListener('change', (e) => {
  if (state.view !== 'live') return;
  if (e.target.id === 'bookFor') setBookingFor(e.target.value);
  else if (e.target.name === 'team' && e.target.closest('form[data-kind="checkin"]')) setBookingFor(e.target.value);
});
$('panel').addEventListener('click', (e) => {
  if (state.view !== 'live') return;
  if (e.target.closest('[data-change-team]')) {
    $('projectField').outerHTML = `<label>Project team<select name="team" required>${teamOptions(state.bookingFor)}</select></label>`;
    $('panel').querySelector('form select[name=team]').focus();
    return;
  }
  const go = e.target.closest('[data-goto]'), aw = e.target.closest('[data-aw]');
  if (go) { select(go.dataset.goto); return; }
  if (!aw) return;
  if (aw.dataset.aw === 'continue') { state.allocAck = `${state.selected}|${state.bookingFor}`; updateAllocWarning(); }
  else { select(null); $('floorplan').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
});

/** Shown while no seat is selected: what to do, and where seats are free right now. */
function idlePanel() {
  const c = countsFor(inScope);
  const floors = (state.summary?.floors ?? []).filter((f) => !state.floor || f.id === state.floor);
  const zones = floors.flatMap((f) => f.zones.map((z) => {
    const zc = countsFor((s) => s.floor === f.id && s.zone === z.id && inScope(s));
    return { label: floors.length > 1 ? `${f.name} · ${z.name}` : z.name, ...zc };
  })).filter((z) => z.total);
  return `<div class="panel-empty">
    <div class="big">${ICON.pointer}</div>
    <h3>Select a seat</h3>
    <p>Click a chair on the plan to see its details and check someone in.</p>
    <div class="stat"><b>${c.available}</b>of ${c.total} seats available${state.floor ? ' on this floor' : ''}</div>
    ${zones.length ? `<ul class="zone-avail">${zones.map((z) => `<li><span>${esc(z.label)}</span><span><b>${z.available}</b> / ${z.total}</span>
      <div class="bar"><i style="width:${pct(z.total ? z.available / z.total : 0)}"></i></div></li>`).join('')}</ul>` : ''}
  </div>`;
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
    <div class="alloc-warn" id="allocWarn" role="alert" hidden></div>
    <label>Name or employee ID<input name="user" autocomplete="off" maxlength="100" required></label>
    ${projectField()}
    <label>Duration<select name="minutes">${durationOptions()}</select></label>
    <div class="form-msg" role="alert"></div>
    <button type="submit" class="btn btn-primary btn-block" value="checkin">Check in to this seat</button>
    <p class="note">${ICON.info}<span>One seat per person: checking in releases any other seat held under the same name.</span></p>
  </form>`;
}

/**
 * The check-in form's project: already chosen under "Booking for project", so shown as
 * a line with a Change link; a dropdown only when no project was chosen there.
 */
function projectField() {
  const team = state.bookingFor;
  if (!team || !(state.options?.projectTeams ?? []).includes(team)) {
    return `<label>Project team<select name="team" required>${teamOptions('')}</select></label>`;
  }
  const t = projectInfo(team);
  return `<div class="book-line" id="projectField"><input type="hidden" name="team" value="${esc(team)}">
    <span class="muted">Project</span>
    <span class="book-line-name"><span class="book-sw" style="background:${t ? projectColor(t) : 'var(--accent)'}"></span>${esc(team)}</span>
    <button type="button" class="link-btn" data-change-team>Change</button></div>`;
}

/**
 * The project of an existing check-in, shown as a fixed line: extending or checking out
 * keeps it. Only if that project has since been deleted is a dropdown shown, because the
 * server needs a current project to record.
 */
function checkedInProject(s) {
  const team = s.projectTeam;
  if (!team || !(state.options?.projectTeams ?? []).includes(team)) {
    return `<label>Project team${team ? ` <span class="muted">(${esc(team)} is no longer offered)</span>` : ''}<select name="team" required>${teamOptions('')}</select></label>`;
  }
  const t = projectInfo(team);
  return `<div class="book-line"><input type="hidden" name="team" value="${esc(team)}">
    <span class="muted">Project</span>
    <span class="book-line-name"><span class="book-sw" style="background:${t ? projectColor(t) : 'var(--accent)'}"></span>${esc(team)}</span></div>`;
}

function manageForm(s) {
  return `<form class="pform" data-kind="manage" novalidate>
    <h3>Manage this check-in</h3>
    <p class="lead">Extend restarts the check-in from now. Check out frees the desk straight away.</p>
    ${checkedInProject(s)}
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

// ---------- Seat allocation (pre-booking) ----------
// Projects are the project teams people check in under. Here an admin adds, recolours
// and deletes them, and pre-allocates seats to them by clicking the plan or typing ids.
let allocSaving = 0;           // PUTs in flight: live project events wait until they finish
let allocMsg = { text: '', kind: '' };
let allocLoaded = false;
const allocProject = (name) => (name ? state.allocProjects.find((t) => t.name === name) : undefined);
const PALETTE_SLOTS = 8;

function setAllocProjects(list) {
  state.allocProjects = list;
  if (!allocProject(state.activeProject)) state.activeProject = list[0]?.name ?? null;
  if (state.view !== 'alloc') return;
  patchAllSeats(); renderLegend(); renderPanel();
}

async function loadAllocProjects() {
  try { const list = await api('/api/projects'); allocLoaded = true; setAllocProjects(list); } catch (e) { setAllocMsg(e.message, 'err'); }
}

function setAllocMsg(text, kind = 'ok') {
  allocMsg = { text, kind };
  const el = $('allocMsg');
  if (el) { el.textContent = text; el.className = `alloc-msg ${kind}`; }
}

function switchView(view) {
  state.view = view; safeSet('hotdesk.view', view);
  $('floorplan').classList.toggle('alloc-view', view === 'alloc');
  for (const b of $('planView').children) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  $('planHint').textContent = view === 'alloc'
    ? 'Click a seat to allocate it to the chosen project; click again to remove it.'
    : 'Hover a seat to preview it, click to select it.';
  hidePop();
  if (view === 'alloc') { state.selected = null; loadAllocProjects(); }
  patchAllSeats(); renderLegend(); renderPanel();
}
$('planView').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) switchView(b.dataset.view); });
$('allocLink').addEventListener('click', () => switchView('alloc'));

/** A colour for a new project: the first palette colour no project uses yet. */
function suggestColor() {
  const used = new Set(state.allocProjects.map((t) => projectColor(t).toLowerCase()));
  for (let i = 0; i < PALETTE_SLOTS; i++) {
    const c = projectColor({ slot: i }).toLowerCase();
    if (!used.has(c)) return c;
  }
  return '#64748b';
}

function projectItem(t) {
  const c = projectColor(t), active = t.name === state.activeProject;
  return `<li class="proj${active ? ' active' : ''}">
    <button type="button" class="proj-pick" data-pick="${esc(t.name)}" aria-pressed="${active}">
      <span class="proj-sw" style="background:${c}"></span>
      <span class="proj-text"><span class="proj-name">${esc(t.name)}</span><span class="proj-meta">${esc(t.code)} · ${t.seats.length} seat${t.seats.length === 1 ? '' : 's'}</span></span>
    </button>
    <input type="color" class="proj-color" data-color="${esc(t.name)}" value="${c}" aria-label="Colour for ${esc(t.name)}" title="Change colour">
    <button type="button" class="btn btn-ghost proj-del" data-del="${esc(t.name)}" aria-label="Delete ${esc(t.name)}" title="Delete project">${ICON.trash}</button>
  </li>`;
}

function seatsEditor(t) {
  if (!t) return '<p class="muted">Add a project to start allocating seats.</p>';
  return `<label class="alloc-label" for="allocSeats">Seats allocated to <b>${esc(t.name)}</b> (${t.seats.length})</label>
    <textarea id="allocSeats" rows="4" spellcheck="false" placeholder="e.g. L1-DF-01, L1-DF-02">${esc(t.seats.join(', '))}</textarea>
    <div class="btnrow">
      <button type="button" class="btn btn-primary" id="allocSave">Save seats</button>
      <button type="button" class="btn" id="allocClear"${t.seats.length ? '' : ' disabled'}>Clear all</button>
    </div>
    <p class="note">${ICON.info}<span>Click seats on the plan to add or remove them, or type seat IDs separated by commas or spaces.</span></p>`;
}

function renderAllocPanel() {
  const panel = $('panel');
  const t = allocProject(state.activeProject);
  if (!panelKey.startsWith('alloc')) {
    panel.innerHTML = `<div class="panel-inner alloc-panel">
      <h2 class="alloc-title">Seat allocation</h2>
      <p class="lead muted">Pre-allocate seats to projects for pre-booking. Choose a project, then click seats on the plan.</p>
      <ul class="proj-list" id="projList"></ul>
      <details class="add-proj" id="addProjBox">
        <summary>Add a project</summary>
        <form class="pform" id="addProj" novalidate>
          <label>Project name<input name="name" maxlength="40" required autocomplete="off"></label>
          <div class="pair">
            <label>Short code<input name="code" maxlength="4" placeholder="auto" autocomplete="off"></label>
            <label>Colour<input type="color" name="color"></label>
          </div>
          <button type="submit" class="btn btn-primary btn-block">Add project</button>
        </form>
      </details>
      <div class="alloc-seats" id="allocSeatsBox"></div>
      <div class="alloc-msg" id="allocMsg" role="status"></div>
    </div>`;
    panel.querySelector('#addProj [name=color]').value = suggestColor();
    panelKey = 'alloc';
  }
  $('projList').innerHTML = state.allocProjects.map(projectItem).join('') || '<li class="muted">No projects yet.</li>';
  if (allocLoaded && !state.allocProjects.length) $('addProjBox').open = true;
  // Don't overwrite seat ids the admin is typing; refresh once they leave the box.
  const editing = document.activeElement?.id === 'allocSeats' && $('allocSeatsBox').dataset.project === (t?.name ?? '');
  if (!editing) { $('allocSeatsBox').innerHTML = seatsEditor(t); $('allocSeatsBox').dataset.project = t?.name ?? ''; }
  setAllocMsg(allocMsg.text, allocMsg.kind);
}

/** Save a project's full seat list. Saves run one after another, newest list wins. */
let allocQueue = Promise.resolve();
function saveAllocation(name, seats) {
  allocSaving++;
  allocQueue = allocQueue.then(() => apiSend('PUT', `/api/projects/${encodeURIComponent(name)}/seats`, { seats }))
    .then((p) => { setAllocMsg(`Saved: ${p.name} has ${p.seats.length} seat${p.seats.length === 1 ? '' : 's'}.`); })
    .catch((e) => { setAllocMsg(e.message, 'err'); })
    .finally(() => { if (--allocSaving === 0) loadAllocProjects(); });
  return allocQueue;
}

function toggleAllocation(id) {
  const s = state.seats.get(id), t = allocProject(state.activeProject);
  if (!s) return;
  if (!t) { setAllocMsg('Choose or add a project first, then click seats.', 'err'); return; }
  if (s.allocatedTo && s.allocatedTo !== t.name) {
    setAllocMsg(`${id} is allocated to ${s.allocatedTo}. Remove it from that project first.`, 'err');
    return;
  }
  // Show the change straight away; the server confirms it (or the reload puts it back).
  const seats = new Set(t.seats);
  if (seats.has(id)) seats.delete(id); else seats.add(id);
  t.seats = [...seats].sort();
  s.allocatedTo = seats.has(id) ? t.name : null;
  const el = seatEl(id); if (el) patchSeat(el, s);
  renderAllocPanel(); renderLegend();
  saveAllocation(t.name, t.seats);
}

$('panel').addEventListener('click', async (e) => {
  if (state.view !== 'alloc') return;
  const pick = e.target.closest('[data-pick]'), del = e.target.closest('[data-del]');
  if (pick) {
    state.activeProject = pick.dataset.pick; setAllocMsg('');
    patchAllSeats(); renderAllocPanel();
  } else if (del) {
    const t = allocProject(del.dataset.del); if (!t) return;
    const n = t.seats.length;
    if (!confirm(`Delete project "${t.name}"?${n ? ` Its ${n} allocated seat${n === 1 ? '' : 's'} will be released.` : ''} People can no longer choose it at check-in; its history stays in the reports.`)) return;
    try {
      await apiSend('DELETE', `/api/projects/${encodeURIComponent(t.name)}`);
      setAllocMsg(`Deleted ${t.name}.`);
      await loadAllocProjects(); loadProjects();
    } catch (err) { setAllocMsg(err.message, 'err'); }
  } else if (e.target.id === 'allocSave') {
    const t = allocProject(state.activeProject); if (!t) return;
    const ids = $('allocSeats').value.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    $('allocSeats').blur();
    saveAllocation(t.name, ids);
  } else if (e.target.id === 'allocClear') {
    const t = allocProject(state.activeProject); if (!t) return;
    if (confirm(`Remove all ${t.seats.length} seats from ${t.name}?`)) saveAllocation(t.name, []);
  }
});

$('panel').addEventListener('change', async (e) => {
  const input = e.target.closest('[data-color]'); if (!input || state.view !== 'alloc') return;
  try {
    await apiSend('PATCH', `/api/projects/${encodeURIComponent(input.dataset.color)}`, { color: input.value });
    setAllocMsg(`Colour updated for ${input.dataset.color}.`);
    await loadAllocProjects(); loadProjects();
  } catch (err) { setAllocMsg(err.message, 'err'); }
});

$('panel').addEventListener('submit', async (e) => {
  if (e.target.id !== 'addProj') return;
  e.preventDefault();
  const f = e.target;
  const name = f.elements.name.value.trim();
  if (!name) { setAllocMsg('Enter a project name.', 'err'); f.elements.name.focus(); return; }
  try {
    const p = await apiSend('POST', '/api/projects', { name, code: f.elements.code.value.trim(), color: f.elements.color.value });
    state.activeProject = p.name;
    f.reset();
    setAllocMsg(`Added ${p.name}. Click seats on the plan to allocate them.`);
    await loadAllocProjects();
    f.elements.color.value = suggestColor();
    loadProjects();
  } catch (err) { setAllocMsg(err.message, 'err'); }
});

// ---------- Legend ----------
function renderLegend() {
  const ws = (cls, style = '') => FloorPlan.sampleSVG(cls, style);
  if (state.view === 'alloc') {
    $('legend').innerHTML = `<div class="lgroup"><b>Allocated to</b>${state.allocProjects.map((t) =>
      `<span class="litem">${ws('alloc alloc-mine', `--c:${projectColor(t)}`)}${esc(t.name)} <span class="muted">${t.seats.length}</span></span>`).join('')}
      <span class="litem">${ws('alloc-free')}Not allocated</span></div>`;
    return;
  }
  const project = state.mode === 'project';
  const status = `<div class="lgroup"><b>Workstations</b>
    <span class="litem">${ws('st-available')}Available</span>
    <span class="litem">${ws('st-available is-selected')}Selected</span>
    <span class="litem">${ws('st-occupied')}Occupied${project ? ', not checked in' : ''}</span>
    <span class="litem">${ws('st-away')}Away (held), chair pushed back</span>
    <span class="litem">${ws('st-offline')}Sensor offline</span></div>`;
  let extra = '';
  if (project) {
    const teams = state.projects.filter((t) => t.configured);
    extra = `<div class="lgroup"><b>Occupied by project team</b>${teams.map((t) =>
      `<span class="litem">${ws('st-occupied team', `--c:${projectColor(t)}`)}${esc(t.name)}</span>`).join('')}</div>`;
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
    if (state.view === 'alloc' && !state.allocProjects.length) switchView('alloc');
  });
  es.addEventListener('seat', (e) => {
    const s = JSON.parse(e.data);
    state.seats.set(s.id, s);
    const el = $('plan').querySelector(`[data-seat="${CSS.escape(s.id)}"]`);
    if (el) { patchSeat(el, s); updateRoving(el.closest('.fp-zone')); }
    updateCounts(); renderKpis();
    if (state.selected === s.id || !state.selected) renderPanel();
    $('noMatch').hidden = [...state.seats.values()].some((x) => inFloor(x) && matches(x));
    refreshSummarySoon();
  });
  es.addEventListener('projects', (e) => {
    if (!allocSaving) setAllocProjects(JSON.parse(e.data));
    loadProjects();
    loadOptions();
  });
  es.onerror = () => { liveOn = false; renderLive('Reconnecting…'); };
}

function renderLoading() {
  $('kpis').innerHTML = Array.from({ length: 5 }, () =>
    '<div class="card kpi loading" aria-hidden="true"><div class="icon"></div><div class="label">Loading</div><div class="value">00</div><div class="sub">loading seats</div></div>').join('');
  renderPanel();
}

/** Check-in choices (durations, project list); refreshed when projects change. */
function loadOptions() {
  return fetch('/api/checkin-options').then((r) => r.json()).then((o) => {
    state.options = o;
    if (state.bookingFor && !o.projectTeams.includes(state.bookingFor)) setBookingFor('');
    if (!state.selected) panelKey = '';
    renderPanel();
  }).catch(() => {});
}

async function start() {
  renderLoading();
  try {
    await api('/api/summary'); // triggers the token prompt before opening the stream
    $('labelsLink').href = withToken('/labels');
    $('sensorsLink').href = withToken('/sensors');
    $('requestersCsv').href = withToken('/api/requesters.csv');
    // An older server has no /api/floorplan: say so rather than quietly drawing bare floors.
    state.plans = new Map((await api('/api/floorplan').catch(() => { state.planError = true; return []; })).map((f) => [f.id, f.plan]));
    loadOptions();
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
