'use strict';
/*
 * Self-service booking (/book): an employee picks their project, taps a free chair on the
 * floor plan and checks in from now for a chosen time. Uses only the public endpoints
 * (no admin token): /api/floors, /api/availability, /api/checkin-options and the seat
 * check-in/check-out calls the QR page uses. The plan is drawn by floorplan.js.
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (m) => (m % 60 ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)} h ` : ''}${m % 60} min` : `${m / 60} hour${m === 60 ? '' : 's'}`);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} },
};

// Demo mode (npm run demo, or /book?demo): the name field is filled with a random sample name (demo-names.js).
let demoMode = demoFromUrl === true;
let demoName = '';
const randomName = () => randomDemoName(demoName);

const STATUS = { available: 'Available', occupied: 'Taken', away: 'Taken (person away)', offline: 'Available (sensor offline)' };
const BOOKABLE = new Set(['available', 'offline']);
const ICON = {
  seat: '<svg class="i" viewBox="0 0 24 24"><path d="M6 19v-3M18 19v-3M5 12h14v4H5zM7 12V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v6"/></svg>',
  pin: '<svg class="i" viewBox="0 0 24 24"><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  close: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  ok: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  warn: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  clock: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

const state = {
  floors: [], seats: new Map(), options: { projects: [], projectTeams: [] },
  project: store.get('hotdesk.team') || '', floor: store.get('hotdesk.bookFloor') || '',
  selected: null, ack: '', flash: null, updatedAt: 0,
  mine: (() => { try { return JSON.parse(store.get('hotdesk.mine') || 'null'); } catch { return null; } })(),
};

async function call(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- Projects ----------
const projectInfo = (name) => state.options.projects.find((p) => p.name === name);
function projectColor(name) {
  const t = projectInfo(name);
  if (!t) return 'var(--accent)';
  if (t.color) return t.color;
  return t.slot === null || t.slot === undefined ? 'var(--anon)' : `var(--team-${(t.slot % 8) + 1})`;
}
function renderProjects() {
  const names = state.options.projectTeams;
  if (state.project && !names.includes(state.project)) state.project = '';
  $('project').innerHTML = '<option value="">Choose your project…</option>' + names.map((n) => {
    const count = [...state.seats.values()].filter((s) => s.allocatedTo === n).length;
    return `<option${n === state.project ? ' selected' : ''} value="${esc(n)}">${esc(n)}${count ? ` (${count} pre-allocated)` : ''}</option>`;
  }).join('');
  $('project').classList.toggle('active', Boolean(state.project));
  renderProjectSummary();
}
function renderProjectSummary() {
  const mine = [...state.seats.values()].filter((s) => state.project && s.allocatedTo === state.project);
  const free = mine.filter((s) => BOOKABLE.has(s.status)).length;
  $('projSum').innerHTML = !state.project ? ''
    : mine.length ? `<span class="book-sw" style="background:${projectColor(state.project)}"></span><span>${mine.length} seat${mine.length === 1 ? ' is' : 's are'} pre-allocated to ${esc(state.project)} and highlighted · <b>${free} free now</b></span>`
    : `<span>${esc(state.project)} has no pre-allocated seats: any free seat is fine.</span>`;
}
$('project').addEventListener('change', () => {
  state.project = $('project').value; state.ack = '';
  store.set('hotdesk.team', state.project || null);
  $('project').classList.toggle('active', Boolean(state.project));
  renderProjectSummary(); patchSeats(); renderPanel();
});

// ---------- Floor plan ----------
function renderFloors() {
  if (!state.floors.some((f) => f.id === state.floor)) state.floor = state.floors[0]?.id ?? '';
  $('floorWrap').hidden = state.floors.length < 2;
  $('floors').innerHTML = state.floors.map((f) => `<button type="button" data-floor="${esc(f.id)}" aria-pressed="${f.id === state.floor}">${esc(f.name)}</button>`).join('');
}
$('floors').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-floor]'); if (!b) return;
  state.floor = b.dataset.floor; store.set('hotdesk.bookFloor', state.floor);
  if (state.selected && state.seats.get(state.selected)?.floor !== state.floor) state.selected = null;
  renderFloors(); renderPlan(); renderPanel();
});

let layout = null;
function renderPlan() {
  const f = state.floors.find((x) => x.id === state.floor);
  if (!f) { $('plan').innerHTML = '<div class="empty">No desks configured.</div>'; return; }
  layout = FloorPlan.layoutFloor(f, [...state.seats.values()], f.plan);
  $('plan').innerHTML = `<div class="fp-scroll">${FloorPlan.floorSVG(layout)}</div>`;
  for (const el of $('plan').querySelectorAll('.seat')) el.tabIndex = 0;
  scalePlan(); patchSeats(); updateCounts();
}
function scalePlan() {
  const svg = $('plan').querySelector('svg.fp'), box = $('plan').querySelector('.fp-scroll');
  if (!svg || !box) return;
  const cs = getComputedStyle(box);
  const inset = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  // Fit the width; on touch screens keep chairs big enough to tap and let the plan scroll instead.
  const min = matchMedia('(pointer: coarse)').matches ? 5.5 : 2.5;
  const s = Math.min(8, Math.max(min, ($('plan').clientWidth - inset - 1) / Number(svg.dataset.w)));
  svg.setAttribute('width', Math.round(Number(svg.dataset.w) * s));
  svg.setAttribute('height', Math.round(Number(svg.dataset.h) * s));
}
addEventListener('resize', scalePlan);

function patchSeats() {
  for (const el of $('plan').querySelectorAll('.seat')) {
    const s = state.seats.get(el.dataset.seat); if (!s) continue;
    const pre = state.project && s.allocatedTo === state.project;
    const sel = state.selected === s.id;
    el.setAttribute('class', `seat st-${s.status}${pre ? ' prealloc' : ''}${sel ? ' is-selected' : ''}${BOOKABLE.has(s.status) ? '' : ' is-taken'}`);
    if (pre) el.style.setProperty('--pa', projectColor(state.project)); else el.style.removeProperty('--pa');
    el.setAttribute('aria-pressed', String(sel));
    el.setAttribute('aria-label', `Desk ${s.id}, ${s.zoneName}: ${STATUS[s.status]}${s.allocatedTo ? `, pre-allocated to ${s.allocatedTo}` : ''}`);
  }
}
function updateCounts() {
  if (!layout) return;
  for (const z of layout.zones) {
    const seats = [...state.seats.values()].filter((s) => s.floor === layout.id && s.zone === z.id);
    const free = seats.filter((s) => BOOKABLE.has(s.status)).length;
    const el = $('plan').querySelector(`[data-zone-count="${CSS.escape(`${layout.id}|${z.id}`)}"]`);
    if (el) el.textContent = `${free} of ${seats.length} free`;
  }
}
$('plan').addEventListener('click', (e) => { const el = e.target.closest('.seat'); if (el) select(el.dataset.seat); });
$('plan').addEventListener('keydown', (e) => {
  const el = e.target.closest('.seat');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(el.dataset.seat); }
});

function select(id) {
  state.selected = id; state.ack = ''; state.flash = null;
  patchSeats(); renderPanel();
  if (id && matchMedia('(max-width: 1180px)').matches) $('panel').scrollTop = 0;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.selected) select(null); });

// ---------- Legend ----------
function renderLegend() {
  const ws = (cls, style = '') => FloorPlan.sampleSVG(cls, style);
  $('legend').innerHTML = `
    <span class="litem">${ws('st-available')}Free</span>
    <span class="litem">${ws('st-available is-selected')}Your choice</span>
    <span class="litem">${ws('st-occupied')}Taken</span>
    <span class="litem">${ws('st-available prealloc', `--pa:${state.project ? projectColor(state.project) : 'var(--accent)'}`)}Pre-allocated to your project</span>`;
}

// ---------- Panel ----------
function renderPanel() {
  const panel = $('panel');
  const s = state.selected && state.seats.get(state.selected);
  panel.classList.toggle('open', Boolean(s));
  if (!s) { panel.innerHTML = emptyPanel(); return; }
  const head = `<div class="phead">
      <div><h2>Desk ${esc(s.id)}</h2><span class="pill k-${s.status === 'offline' ? 'available' : s.status}">${STATUS[s.status]}</span></div>
      <button type="button" class="btn btn-ghost close" aria-label="Close" data-act="close">${ICON.close}</button>
    </div>
    <ul class="meta"><li>${ICON.pin}<span><b>${esc(s.floorName)}</b> · ${esc(s.zoneName)}${s.allocatedTo ? `<br><span class="muted">Pre-allocated to ${esc(s.allocatedTo)}</span>` : ''}</span></li></ul>`;
  const flash = state.flash && state.flash.seat === s.id
    ? `<div class="flash ok" role="status">${ICON.ok}<span>${state.flash.html}</span></div>` : '';
  let body = '';
  if (state.mine && state.mine.seat === s.id && state.mine.until > Date.now()) {
    body = `<div class="pform"><p class="lead" style="margin:0">You are checked in here until <b>${fmtTime(state.mine.until)}</b>.</p>
      <button type="button" class="btn btn-block" data-act="leave">I'm leaving</button><div class="form-msg" id="formMsg"></div></div>`;
  } else if (!BOOKABLE.has(s.status)) {
    body = `<div class="pform"><p class="lead" style="margin:0">${ICON.clock} This desk is taken${s.checkedInUntil ? ` until about ${fmtTime(s.checkedInUntil)}` : ''}. Choose a free chair on the plan.</p></div>`;
  } else if (!state.project) {
    body = `<div class="pform need-project"><h3><span class="step">2</span>Book this desk</h3><p class="lead">Choose your project in step 1 above first.</p></div>`;
  } else {
    body = `${allocationWarning(s)}${bookingForm(s)}`;
  }
  panel.innerHTML = `<div class="panel-inner">${head}${flash}${body}</div>`;
  const name = panel.querySelector('input[name=user]');
  if (name) name.value = demoMode ? (demoName ||= randomName()) : store.get('hotdesk.user') || '';
}

function emptyPanel() {
  const seats = [...state.seats.values()].filter((s) => s.floor === state.floor);
  const free = seats.filter((s) => BOOKABLE.has(s.status)).length;
  const f = state.floors.find((x) => x.id === state.floor);
  return `<div class="panel-empty">
    <div class="big">${ICON.seat.replace('class="i"', 'class="i" style="width:24px;height:24px"')}</div>
    <h3><span class="step">2</span>Choose a desk</h3>
    <p>${state.project ? 'Tap a free chair on the plan.' : 'Choose your project first, then tap a free chair on the plan.'}</p>
    <div class="stat"><b>${free}</b>of ${seats.length} desks free${f ? ` on ${esc(f.name)}` : ''}</div>
  </div>`;
}

function allocationWarning(s) {
  const mine = [...state.seats.values()].filter((x) => x.allocatedTo === state.project);
  if (!mine.length || s.allocatedTo === state.project) {
    return mine.length ? `<div class="alloc-warn ack">${ICON.ok}<span>Pre-allocated to ${esc(state.project)}.</span></div>` : '';
  }
  if (state.ack === s.id) return `<div class="alloc-warn ack">${ICON.warn}<span>Not pre-allocated to ${esc(state.project)}. Continuing with this desk.</span></div>`;
  const free = mine.filter((x) => BOOKABLE.has(x.status));
  return `<div class="alloc-warn" role="alert">
    <div class="aw-head">${ICON.warn}<span><b>${esc(s.id)} is not pre-allocated to ${esc(state.project)}.</b> ${s.allocatedTo ? `It is pre-allocated to ${esc(s.allocatedTo)}.` : ''}</span></div>
    ${free.length ? `<div class="aw-list"><span>${esc(state.project)}'s free pre-allocated desks:</span>${free.slice(0, 12).map((x) => `<button type="button" class="aw-seat" data-go="${esc(x.id)}">${esc(x.id)}</button>`).join('')}</div>`
      : `<div class="aw-list"><span>All of ${esc(state.project)}'s pre-allocated desks are taken right now.</span></div>`}
    <div class="aw-actions"><button type="button" class="btn" data-act="ack">Continue with this desk</button></div>
  </div>`;
}

function bookingForm(s) {
  const { checkinDurationMinutes: def = 240, checkinMaxMinutes: max = 600 } = state.options;
  const opts = new Set([def]);
  for (let m = 60; m <= max; m += 60) opts.add(m);
  const blocked = state.project && [...state.seats.values()].some((x) => x.allocatedTo === state.project) && s.allocatedTo !== state.project && state.ack !== s.id;
  return `<form class="pform" id="bookForm">
    <h3><span class="step">3</span>Your details</h3>
    <p class="lead">Starts now and lasts for the time you choose.</p>
    <label>Your name or employee ID<input name="user" autocomplete="username" required></label>
    ${demoMode ? '<button type="button" class="btn btn-ghost demo-name" data-act="rename">↻ Another sample name</button>' : ''}
    <label>How long?<select name="minutes">${[...opts].sort((a, b) => a - b).map((m) => `<option value="${m}"${m === def ? ' selected' : ''}>${fmtDuration(m)}${m === def ? ' (default)' : ''}</option>`).join('')}</select></label>
    <button class="btn btn-primary btn-block" type="submit"${blocked ? ' disabled' : ''}>Book desk ${esc(s.id)}</button>
    <div class="form-msg" id="formMsg"></div>
  </form>`;
}

$('panel').addEventListener('click', async (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { const s = state.seats.get(go.dataset.go); if (s && s.floor !== state.floor) { state.floor = s.floor; renderFloors(); renderPlan(); } select(go.dataset.go); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') select(null);
  if (act === 'ack') { state.ack = state.selected; renderPanel(); }
  if (act === 'rename') { demoName = randomName(); const i = $('panel').querySelector('input[name=user]'); if (i) i.value = demoName; }
  if (act === 'leave') await leave();
});
$('panel').addEventListener('submit', async (e) => {
  if (e.target.id !== 'bookForm') return;
  e.preventDefault();
  const f = e.target, user = f.elements.user.value.trim(), id = state.selected;
  if (!user) { $('formMsg').textContent = 'Enter your name first.'; f.elements.user.focus(); return; }
  if (!demoMode) store.set('hotdesk.user', user);
  f.querySelector('button[type=submit]').disabled = true;
  try {
    const seat = await call(`/api/seats/${encodeURIComponent(id)}/checkin`, { user, projectTeam: state.project, minutes: Number(f.elements.minutes.value) });
    state.seats.set(seat.id, { ...state.seats.get(seat.id), ...seat });
    state.mine = { seat: seat.id, user, team: state.project, until: seat.checkedInUntil };
    store.set('hotdesk.mine', JSON.stringify(state.mine));
    demoName = ''; // the next booking gets a new sample name
    state.flash = { seat: seat.id, html: `Booked. You are checked in at <b>${esc(seat.id)}</b> until <b>${fmtTime(seat.checkedInUntil)}</b>.` };
    patchSeats(); updateCounts(); renderMine(); renderPanel(); renderProjectSummary();
  } catch (err) {
    $('formMsg').textContent = err.message;
    f.querySelector('button[type=submit]').disabled = false;
    refresh();
  }
});

async function leave() {
  const m = state.mine; if (!m) return;
  try {
    const seat = await call(`/api/seats/${encodeURIComponent(m.seat)}/checkout`, { user: m.user, projectTeam: m.team });
    state.seats.set(seat.id, { ...state.seats.get(seat.id), ...seat });
    state.mine = null; store.set('hotdesk.mine', null);
    state.flash = { seat: seat.id, html: 'Checked out. The desk is free for others.' };
    patchSeats(); updateCounts(); renderMine(); renderPanel(); renderProjectSummary();
  } catch (err) { const el = $('formMsg'); if (el) el.textContent = err.message; else alert(err.message); }
}

// ---------- "You're checked in" bar ----------
function renderMine() {
  const m = state.mine;
  const s = m && state.seats.get(m.seat);
  // Forget it once it ended or the desk was released (checked out elsewhere, or auto-released).
  if (m && (m.until <= Date.now() || (s && !s.checkedInUntil))) { state.mine = null; store.set('hotdesk.mine', null); }
  $('mine').hidden = !state.mine;
  if (!state.mine) return;
  $('mine').innerHTML = `${ICON.ok}<span>You are checked in at <b>${esc(state.mine.seat)}</b> (${esc(state.mine.team)}) until <b>${fmtTime(state.mine.until)}</b>.</span>
    <span class="spacer"></span><button type="button" class="btn" id="showMine">Show on plan</button><button type="button" class="btn" id="leaveMine">I'm leaving</button>`;
  $('showMine').onclick = () => {
    const s = state.seats.get(state.mine.seat);
    if (s && s.floor !== state.floor) { state.floor = s.floor; renderFloors(); renderPlan(); }
    select(state.mine.seat);
  };
  $('leaveMine').onclick = leave;
}

// ---------- Data ----------
async function refresh() {
  const list = await call('/api/availability');
  const before = state.selected && state.seats.get(state.selected)?.status;
  state.seats = new Map(list.map((s) => [s.id, s]));
  state.updatedAt = Date.now();
  $('live').className = 'live on';
  $('live').innerHTML = `Live <span class="sep">·</span> Updated ${fmtTime(state.updatedAt)}`;
  patchSeats(); updateCounts(); renderProjectSummary(); renderMine();
  // Redraw the panel only when the chosen desk's status changed (keeps what was typed).
  const now = state.selected && state.seats.get(state.selected)?.status;
  if (!state.selected || before !== now) renderPanel();
}

async function init() {
  try {
    const [floors, list, options] = await Promise.all([call('/api/floors'), call('/api/availability'), call('/api/checkin-options')]);
    state.floors = floors; state.options = options;
    if (options.demo && demoFromUrl !== false) demoMode = true;
    state.seats = new Map(list.map((s) => [s.id, s]));
    renderProjects(); renderFloors(); renderPlan(); renderLegend(); renderMine(); renderPanel();
    $('live').className = 'live on';
    $('live').innerHTML = `Live <span class="sep">·</span> Updated ${fmtTime(Date.now())}`;
    $('project').addEventListener('change', renderLegend);
    setInterval(() => refresh().catch(() => { $('live').className = 'live'; $('live').textContent = 'Reconnecting…'; }), 10_000);
  } catch (e) {
    $('plan').innerHTML = `<div class="empty">Could not load the floor plan: ${esc(e.message)}</div>`;
  }
}
init();
