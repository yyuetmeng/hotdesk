'use strict';
/*
 * Floor display (/display): a projected screen at the office with the live floor plan and a
 * colleague finder (who is checked in or has booked desks, and where). Needs the display key
 * (?key=…, DISPLAY_KEY) or the admin token (?token=…), because it shows names.
 * Interactive (search, filters, tap a name to find their desk); after a minute without input it
 * resets, rotates the views and scrolls the list by itself until someone touches it again.
 * A floor with several zones is shown one zone at a time (only here; the other pages show whole floors).
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const params = new URLSearchParams(location.search);
const key = params.get('key'), token = params.get('token');
const auth = key ? { 'x-display-key': key } : token ? { authorization: `Bearer ${token}` } : {};

// Idle reset and floor rotation, in seconds: ?idle=60&rotate=20 (the defaults).
const secs = (name, def) => Math.max(3, Number(params.get(name)) || def) * 1000;
const IDLE_MS = secs('idle', 60), ROTATE_MS = secs('rotate', 20), REFRESH_MS = 5_000;
const STATUS = { onsite: 'On-site', away: 'Away', booked: 'Booked', team: 'Booked for team' };
const state = {
  floors: [], seats: new Map(), people: [], projects: [], floor: '',
  // What the plan shows: a whole floor, or one zone of a floor with several (too wide for a screen).
  views: [], view: '',
  selected: null, // the selected person's key
  q: '', fProject: '', fFloor: '',
  lastInput: Date.now(), auto: false, lastRotate: 0,
};

async function call(path, headers = {}) {
  const res = await fetch(path, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; throw e; }
  return data;
}

// ---------- People ----------
const personKey = (p) => `${p.name}|${p.team ?? ''}|${p.teamBooking ? 'team' : ''}`;
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
function projectColor(name) {
  const t = state.projects.find((p) => p.name === name);
  if (!t) return 'var(--anon)';
  if (t.color) return t.color;
  return t.slot === null || t.slot === undefined ? 'var(--anon)' : `var(--team-${(t.slot % 8) + 1})`;
}
function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.people.filter((p) => {
    if (state.fProject && p.team !== state.fProject) return false;
    if (state.fFloor && !p.seats.some((s) => s.floor === state.fFloor)) return false;
    if (!q) return true;
    return [p.name, p.team, ...p.seats.flatMap((s) => [s.id, s.floorName, s.zoneName])].some((t) => String(t ?? '').toLowerCase().includes(q));
  });
}
function renderList() {
  const rows = filtered();
  const floorsOf = (p) => [...new Set(p.seats.map((s) => s.floorName))].join(', ');
  $('list').innerHTML = rows.length ? `<table><thead><tr><th>Name</th><th class="c-proj">Project</th><th>Desk</th></tr></thead><tbody>${rows.map((p) => {
    const k = personKey(p);
    // The desk, with its floor and area underneath (a team booking lists its desks).
    const desk = p.seats.length === 1 ? `${esc(p.seats[0].id)}<small>${esc(p.seats[0].floorName)} · ${esc(p.seats[0].zoneName)}</small>`
      : `${p.seats.length} desks · ${esc(floorsOf(p))}<small>${p.seats.map((s) => esc(s.id)).join(', ')}</small>`;
    return `<tr data-key="${esc(k)}" class="${state.selected === k ? 'on' : ''}">
      <td><div class="dp-who"><span class="dp-av" style="--c:${projectColor(p.team)}">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b>${p.status === 'onsite' ? '' : ` <span class="dp-tag s-${p.status}">${STATUS[p.status]}</span>`}<small class="dp-team">${esc(p.team ?? '')}</small></span></div></td>
      <td class="c-proj">${esc(p.team ?? '—')}</td>
      <td class="dp-desk">${desk}</td></tr>`;
  }).join('')}</tbody></table>`
    : `<div class="dp-empty">${state.people.length ? 'No colleagues match your search.' : 'Nobody has checked in yet today.'}</div>`;
  const n = state.people.length;
  $('count').textContent = rows.length === n ? `${n} colleague${n === 1 ? '' : 's'} in today` : `${rows.length} of ${n} colleagues`;
}
$('list').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-key]'); if (tr) selectPerson(tr.dataset.key); });

function selectPerson(k) {
  state.selected = state.selected === k ? null : k;
  const p = state.people.find((x) => personKey(x) === state.selected);
  if (p && !p.seats.some((s) => inView(s))) { showView(viewOf(p.seats[0])); }
  patchSeats(); renderList(); renderSelection();
}
function renderSelection() {
  const p = state.people.find((x) => personKey(x) === state.selected);
  if (!p) { $('sel').innerHTML = ''; return; }
  const where = p.seats.length === 1 ? `${esc(p.seats[0].id)} · ${esc(p.seats[0].floorName)}, ${esc(p.seats[0].zoneName)}`
    : `${p.seats.length} desks: ${p.seats.map((s) => esc(s.id)).join(', ')}`;
  $('sel').innerHTML = `<span class="dp-av" style="--c:${projectColor(p.team)}">${esc(initials(p.name))}</span>
    <span><b>${esc(p.name)}</b>${p.team ? ` · ${esc(p.team)}` : ''} · ${where} · <span class="dp-st s-${p.status}">${STATUS[p.status]}</span>${p.status === 'team' || p.status === 'booked' ? ` until ${fmtTime(p.until)}` : ` since ${fmtTime(p.since)}`}</span>
    <button type="button" class="btn" id="clearSel">Clear</button>`;
  $('clearSel').onclick = () => selectPerson(state.selected);
}

// ---------- Floor plan ----------
// A floor with several zones (Level 1) is shown one zone at a time, so it fills the screen; a floor
// with one zone is shown whole. This split is only for the display.
function buildViews() {
  state.views = state.floors.flatMap((f) => (f.zones.length > 1
    ? f.zones.map((z) => ({ id: `${f.id}|${z.id}`, floor: f.id, zone: z.id, tab: `${f.id} · ${z.name}`, title: `${f.name} · ${z.name}` }))
    : [{ id: f.id, floor: f.id, zone: null, tab: f.name, title: f.name }]));
}
const currentView = () => state.views.find((v) => v.id === state.view);
const inView = (s) => { const v = currentView(); return v && s.floor === v.floor && (!v.zone || s.zone === v.zone); };
const viewOf = (s) => (state.views.find((v) => v.floor === s.floor && v.zone === s.zone) ?? state.views.find((v) => v.floor === s.floor))?.id;
function showView(id) { if (!id) return; state.view = id; state.floor = currentView().floor; renderFloors(); renderPlan(); }
function renderFloors() {
  if (!currentView()) state.view = state.views[0]?.id ?? '';
  state.floor = currentView()?.floor ?? '';
  $('floors').innerHTML = state.views.map((v) => `<button type="button" data-view="${esc(v.id)}" aria-pressed="${v.id === state.view}">${esc(v.tab)}</button>`).join('');
}
$('floors').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]'); if (b) showView(b.dataset.view);
});

let layout = null;
function renderPlan() {
  const v = currentView(), f = v && state.floors.find((x) => x.id === v.floor);
  if (!f) { $('plan').innerHTML = ''; return; }
  layout = FloorPlan.layoutFloor(f, [...state.seats.values()], f.plan);
  $('plan').innerHTML = `<div class="fp-scroll">${FloorPlan.floorSVG(layout)}</div>`;
  const z = v.zone && layout.zones.find((x) => x.id === v.zone);
  if (z) {
    // Crop the floor drawing to the zone (with a little of the floor around it).
    const pad = 3, svg = $('plan').querySelector('svg.fp');
    const x = Math.max(-1, z.box.x - pad), y = Math.max(-1, z.box.y - pad);
    const w = Math.min(layout.w + 1, z.box.x + z.box.w + pad) - x, h = Math.min(layout.h + 1, z.box.y + z.box.h + pad) - y;
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    svg.dataset.w = w; svg.dataset.h = h;
  }
  $('floorName').textContent = v.title;
  scalePlan(); patchSeats(); updateCounts();
}
/** Fit the whole floor in the space (width and height): a projector can't scroll. */
function scalePlan() {
  const svg = $('plan').querySelector('svg.fp'), box = $('plan').querySelector('.fp-scroll');
  if (!svg || !box) return;
  const w = Number(svg.dataset.w), h = Number(svg.dataset.h);
  const s = Math.max(2, Math.min(($('plan').clientWidth - 24) / w, ($('plan').clientHeight - 24) / h));
  svg.setAttribute('width', Math.round(w * s));
  svg.setAttribute('height', Math.round(h * s));
}
new ResizeObserver(scalePlan).observe($('plan'));

/** Each occupied desk takes its person's project colour; the selected person's desks pulse. */
function patchSeats() {
  const owner = new Map();
  for (const p of state.people) for (const s of p.seats) owner.set(s.id, p);
  for (const el of $('plan').querySelectorAll('.seat')) {
    const s = state.seats.get(el.dataset.seat); if (!s) continue;
    const p = owner.get(s.id);
    const team = p && s.status === 'occupied' && p.team;
    const found = p && personKey(p) === state.selected;
    el.setAttribute('class', `seat st-${s.status}${team ? ' team' : ''}${p ? ' dp-person' : ''}${found ? ' dp-found' : ''}`);
    if (team) el.style.setProperty('--c', projectColor(p.team)); else el.style.removeProperty('--c');
    el.setAttribute('aria-label', `Desk ${s.id}: ${p ? `${p.name}${p.team ? `, ${p.team}` : ''}` : s.status}`);
    el.removeAttribute('tabindex');
  }
}
$('plan').addEventListener('click', (e) => {
  const el = e.target.closest('.seat.dp-person'); if (!el) return;
  const p = state.people.find((x) => x.seats.some((s) => s.id === el.dataset.seat));
  if (p) selectPerson(personKey(p));
});
function updateCounts() {
  if (!layout) return;
  const onFloor = [...state.seats.values()].filter((s) => s.floor === layout.id);
  const shown = onFloor.filter(inView);
  $('floorCount').textContent = `${shown.filter((s) => s.status === 'available').length} of ${shown.length} desks free`;
  for (const z of layout.zones) {
    const seats = onFloor.filter((s) => s.zone === z.id);
    const el = $('plan').querySelector(`[data-zone-count="${CSS.escape(`${layout.id}|${z.id}`)}"]`);
    if (el) el.textContent = `${seats.filter((s) => s.status === 'available').length} of ${seats.length} free`;
  }
}
function renderLegend() {
  const ws = (cls, style = '') => FloorPlan.sampleSVG(cls, style);
  const teams = [...new Set(state.people.map((p) => p.team).filter(Boolean))].sort();
  $('legend').innerHTML = `<span class="litem">${ws('st-available')}Free</span>
    <span class="litem">${ws('st-occupied')}Taken</span>
    <span class="litem">${ws('st-away')}Away</span>
    ${teams.map((t) => `<span class="litem">${ws('st-occupied team', `--c:${projectColor(t)}`)}${esc(t)}</span>`).join('')}`;
}

// ---------- Whole-office summary cards ----------
const svgIcon = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const KPI_ICON = {
  rate: svgIcon('<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4-4"/>'),
  available: svgIcon('<path d="M7 11V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5"/><path d="M5 11h14v4H5zM8 15v5M16 15v5"/>'),
  occupied: svgIcon('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
  away: svgIcon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
};
function renderKpis() {
  const c = { total: 0, available: 0, occupied: 0, away: 0, offline: 0 };
  for (const s of state.seats.values()) { c.total++; c[s.status] = (c[s.status] ?? 0) + 1; }
  const rate = c.total ? (c.occupied + c.away) / c.total : 0, pct = `${Math.round(rate * 100)}%`;
  const tile = (color, icon, label, value, sub, extra = '') => `<div class="card kpi" style="--k:${color}">
      <div class="icon">${icon}</div><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div>${extra}</div>`;
  $('kpis').innerHTML =
    tile('var(--accent)', KPI_ICON.rate, 'Occupancy', pct, `${c.occupied + c.away} of ${c.total} seats in use`,
      `<div class="meter" role="presentation"><i style="width:${pct}"></i></div>`) +
    tile('var(--available)', KPI_ICON.available, 'Available', c.available, 'free to take now') +
    tile('var(--seat-occupied)', KPI_ICON.occupied, 'Occupied', c.occupied, 'at a desk or checked in') +
    tile('var(--seat-away-ink)', KPI_ICON.away, 'Away (held)', c.away, state.awayGrace ? `held ≤ ${state.awayGrace} min, then released` : 'desk held for a while');
}

// ---------- Filters ----------
function renderFilters() {
  const keep = (id, opts, all) => {
    const v = $(id).value;
    $(id).innerHTML = `<option value="">${all}</option>${opts.map(([value, label]) => `<option value="${esc(value)}"${value === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}`;
  };
  keep('fProject', state.projects.map((p) => [p.name, p.name]), 'All projects');
  keep('fFloor', state.floors.map((f) => [f.id, f.name]), 'All floors');
}
$('q').addEventListener('input', () => { state.q = $('q').value; renderList(); });
for (const [id, k] of [['fProject', 'fProject'], ['fFloor', 'fFloor']]) {
  $(id).addEventListener('change', () => {
    state[k] = $(id).value;
    if (k === 'fFloor' && state.fFloor && state.fFloor !== state.floor) showView(state.views.find((v) => v.floor === state.fFloor)?.id);
    renderList();
  });
}

// ---------- Idle: reset, then rotate floors and scroll the list ----------
function input() {
  state.lastInput = Date.now();
  if (state.auto) { state.auto = false; $('mode').textContent = ''; }
}
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, input, { passive: true });
setInterval(() => {
  const now = Date.now();
  if (!state.auto && now - state.lastInput > IDLE_MS) {
    // Back to the overview for the next person.
    state.auto = true; state.lastRotate = now;
    state.q = state.fProject = state.fFloor = ''; state.selected = null;
    for (const id of ['q', 'fProject', 'fFloor']) $(id).value = '';
    $('list').scrollTop = 0;
    $('mode').innerHTML = '<span class="auto">Touch to search</span>';
    patchSeats(); renderList(); renderSelection();
  }
  if (state.auto && now - state.lastRotate > ROTATE_MS && state.views.length > 1) {
    state.lastRotate = now;
    const i = state.views.findIndex((v) => v.id === state.view);
    showView(state.views[(i + 1) % state.views.length].id);
  }
}, 1000);
// Slow scroll of a long list while idle: down to the end, a pause, then back to the top.
let pauseUntil = 0;
(function scroll() {
  const list = $('list');
  if (state.auto && list.scrollHeight > list.clientHeight + 4 && Date.now() > pauseUntil) {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 1) { pauseUntil = Date.now() + 4000; setTimeout(() => { list.scrollTop = 0; pauseUntil = Date.now() + 3000; }, 3500); }
    else list.scrollTop += 0.6;
  }
  requestAnimationFrame(scroll);
})();

// ---------- Clock, theme, data ----------
function tick() {
  const d = new Date();
  $('time').textContent = fmtTime(d);
  $('date').textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
tick(); setInterval(tick, 15_000);
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('hotdesk.displayTheme', document.documentElement.dataset.theme); } catch {}
});

async function refresh() {
  const [list, people] = await Promise.all([call('/api/availability'), call('/api/display/people', auth)]);
  state.seats = new Map(list.map((s) => [s.id, s]));
  state.people = people.people;
  state.awayGrace = people.awayGraceMinutes;
  $('bname').textContent = people.building ? `· ${people.building}` : '';
  if (state.selected && !state.people.some((p) => personKey(p) === state.selected)) { state.selected = null; renderSelection(); }
  $('live').className = 'live on';
  $('live').innerHTML = `Live <span class="sep">·</span> ${fmtTime(Date.now())}`;
  patchSeats(); updateCounts(); renderList(); renderLegend(); renderKpis();
  if (state.selected) renderSelection();
}

async function init() {
  try {
    const [floors, options] = await Promise.all([call('/api/floors'), call('/api/checkin-options')]);
    state.floors = floors; state.projects = options.projects ?? [];
    buildViews();
    renderFilters(); renderFloors();
    await refresh();
    renderPlan();
    setInterval(() => refresh().catch(() => { $('live').className = 'live'; $('live').textContent = 'Reconnecting…'; }), REFRESH_MS);
  } catch (e) {
    if (e.status === 401) {
      $('main').innerHTML = `<div class="card dp-auth" style="grid-column:1/-1"><h2>This display needs its key</h2>
        <p class="muted">Open it as <code>/display?key=…</code> with the server's <code>DISPLAY_KEY</code>, or from the dashboard's <b>Floor display</b> link.</p></div>`;
    } else {
      $('plan').innerHTML = `<div class="dp-empty">Could not load the floor display: ${esc(e.message)}</div>`;
    }
  }
}
init();
