'use strict';
/*
 * Floor display (/display): a projected screen at the office with the live floor plan and a
 * colleague finder (who is checked in or has booked desks, and where). Needs the display key
 * (?key=…, DISPLAY_KEY) or the admin token (?token=…), because it shows names.
 * Interactive (search, filters, tap a name to find their desk); after a minute without input it
 * resets, rotates the floors and scrolls the list by itself until someone touches it again.
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
  selected: null, // the selected person's key
  q: '', fProject: '', fFloor: '', fStatus: '',
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
    if (state.fStatus && p.status !== state.fStatus) return false;
    if (!q) return true;
    return [p.name, p.team, ...p.seats.flatMap((s) => [s.id, s.floorName, s.zoneName])].some((t) => String(t ?? '').toLowerCase().includes(q));
  });
}
function renderList() {
  const rows = filtered();
  const floorsOf = (p) => [...new Set(p.seats.map((s) => s.floorName))].join(', ');
  $('list').innerHTML = rows.length ? `<table><thead><tr><th>Name</th><th class="c-proj">Project</th><th>Desk</th><th>Status</th></tr></thead><tbody>${rows.map((p) => {
    const k = personKey(p);
    // The desk, with its floor and area underneath (a team booking lists its desks).
    const desk = p.seats.length === 1 ? `${esc(p.seats[0].id)}<small>${esc(p.seats[0].floorName)} · ${esc(p.seats[0].zoneName)}</small>`
      : `${p.seats.length} desks · ${esc(floorsOf(p))}<small>${p.seats.map((s) => esc(s.id)).join(', ')}</small>`;
    return `<tr data-key="${esc(k)}" class="${state.selected === k ? 'on' : ''}">
      <td><div class="dp-who"><span class="dp-av" style="--c:${projectColor(p.team)}">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b><small class="dp-team">${esc(p.team ?? '')}</small></span></div></td>
      <td class="c-proj">${esc(p.team ?? '—')}</td>
      <td class="dp-desk">${desk}</td>
      <td><span class="dp-st s-${p.status}">${STATUS[p.status]}</span></td></tr>`;
  }).join('')}</tbody></table>`
    : `<div class="dp-empty">${state.people.length ? 'No colleagues match your search.' : 'Nobody has checked in yet today.'}</div>`;
  const n = state.people.length;
  $('count').textContent = rows.length === n ? `${n} colleague${n === 1 ? '' : 's'} in today` : `${rows.length} of ${n} colleagues`;
}
$('list').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-key]'); if (tr) selectPerson(tr.dataset.key); });

function selectPerson(k) {
  state.selected = state.selected === k ? null : k;
  const p = state.people.find((x) => personKey(x) === state.selected);
  if (p && !p.seats.some((s) => s.floor === state.floor)) { state.floor = p.seats[0].floor; renderFloors(); renderPlan(); }
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
function renderFloors() {
  if (!state.floors.some((f) => f.id === state.floor)) state.floor = state.floors[0]?.id ?? '';
  $('floors').innerHTML = state.floors.map((f) => `<button type="button" data-floor="${esc(f.id)}" aria-pressed="${f.id === state.floor}">${esc(f.name)}</button>`).join('');
}
$('floors').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-floor]'); if (!b) return;
  state.floor = b.dataset.floor; renderFloors(); renderPlan();
});

let layout = null;
function renderPlan() {
  const f = state.floors.find((x) => x.id === state.floor);
  if (!f) { $('plan').innerHTML = ''; return; }
  layout = FloorPlan.layoutFloor(f, [...state.seats.values()], f.plan);
  $('plan').innerHTML = `<div class="fp-scroll">${FloorPlan.floorSVG(layout)}</div>`;
  $('floorName').textContent = f.name;
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
  const free = onFloor.filter((s) => s.status === 'available').length;
  $('floorCount').textContent = `${free} of ${onFloor.length} desks free`;
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
for (const [id, k] of [['fProject', 'fProject'], ['fFloor', 'fFloor'], ['fStatus', 'fStatus']]) {
  $(id).addEventListener('change', () => {
    state[k] = $(id).value;
    if (k === 'fFloor' && state.fFloor && state.fFloor !== state.floor) { state.floor = state.fFloor; renderFloors(); renderPlan(); }
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
    state.q = state.fProject = state.fFloor = state.fStatus = ''; state.selected = null;
    for (const id of ['q', 'fProject', 'fFloor', 'fStatus']) $(id).value = '';
    $('list').scrollTop = 0;
    $('mode').innerHTML = '<span class="auto">Touch to search</span>';
    patchSeats(); renderList(); renderSelection();
  }
  if (state.auto && now - state.lastRotate > ROTATE_MS && state.floors.length > 1) {
    state.lastRotate = now;
    const i = state.floors.findIndex((f) => f.id === state.floor);
    state.floor = state.floors[(i + 1) % state.floors.length].id;
    renderFloors(); renderPlan();
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
  $('bname').textContent = people.building ? `· ${people.building}` : '';
  if (state.selected && !state.people.some((p) => personKey(p) === state.selected)) { state.selected = null; renderSelection(); }
  $('live').className = 'live on';
  $('live').innerHTML = `Live <span class="sep">·</span> ${fmtTime(Date.now())}`;
  patchSeats(); updateCounts(); renderList(); renderLegend();
  if (state.selected) renderSelection();
}

async function init() {
  try {
    const [floors, options] = await Promise.all([call('/api/floors'), call('/api/checkin-options')]);
    state.floors = floors; state.projects = options.projects ?? [];
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
