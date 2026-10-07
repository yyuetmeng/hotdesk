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
  // "Several desks for my team": the picked desks (booked together as a team booking).
  multi: false, picked: new Set(),
  // The person's own booking on this device: { seats: [...], user, team, until, teamBooking }.
  mine: (() => {
    try {
      const m = JSON.parse(store.get('hotdesk.mine') || 'null');
      return m && m.seat && !m.seats ? { ...m, seats: [m.seat] } : m; // older single-desk format
    } catch { return null; }
  })(),
};
const maxPicks = () => state.options.teamBookingMaxSeats || 10;
const allocatedTo = (team) => [...state.seats.values()].filter((x) => x.allocatedTo === team);

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
// One desk, or several desks for the team.
function setMulti(on) {
  state.multi = on; state.picked.clear(); state.selected = null; state.ack = ''; state.flash = null;
  for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.dataset.mode === 'multi') === on));
  patchSeats(); renderPanel(); renderMultiBar();
}
$('mode').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMulti(b.dataset.mode === 'multi'); });

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
    const sel = state.multi ? state.picked.has(s.id) : state.selected === s.id;
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
$('plan').addEventListener('click', (e) => { const el = e.target.closest('.seat'); if (el) choose(el.dataset.seat); });
$('plan').addEventListener('keydown', (e) => {
  const el = e.target.closest('.seat');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(el.dataset.seat); }
});
const choose = (id) => (state.multi ? togglePick(id) : select(id));

function togglePick(id) {
  const s = state.seats.get(id); if (!s) return;
  state.flash = null;
  if (state.picked.has(id)) state.picked.delete(id);
  else if (!BOOKABLE.has(s.status)) state.flash = { multi: true, err: true, html: `${esc(id)} is taken. Choose a free desk.` };
  else if (state.picked.size >= maxPicks()) state.flash = { multi: true, err: true, html: `You can book up to ${maxPicks()} desks at once.` };
  else state.picked.add(id);
  patchSeats(); renderPanel(); renderMultiBar();
}

// On narrow screens the panel sits below the plan in team mode; a bar shows the count and jumps to it.
function renderMultiBar() {
  const n = state.picked.size;
  $('multiBar').hidden = !state.multi || !n;
  $('multiBarText').textContent = `${n} desk${n === 1 ? '' : 's'} picked`;
}
$('multiBarGo').addEventListener('click', () => $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' }));

function select(id) {
  state.selected = id; state.ack = ''; state.flash = null;
  patchSeats(); renderPanel();
  if (id && matchMedia('(max-width: 1180px)').matches) $('panel').scrollTop = 0;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.selected && !state.multi) select(null); });

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
  if (state.multi) { panel.classList.remove('open'); panel.innerHTML = multiPanel(); fillName(); return; }
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
  if (state.mine && state.mine.seats.includes(s.id) && state.mine.until > Date.now()) {
    body = `<div class="pform"><p class="lead" style="margin:0">${state.mine.teamBooking ? `You booked this desk for ${esc(state.mine.team)}` : 'You are checked in here'} until <b>${fmtTime(state.mine.until)}</b>.</p>
      <button type="button" class="btn btn-block" data-act="leave">I'm leaving</button><div class="form-msg" id="formMsg"></div></div>`;
  } else if (!BOOKABLE.has(s.status)) {
    body = `<div class="pform"><p class="lead" style="margin:0">${ICON.clock} This desk is taken${s.checkedInUntil ? ` until about ${fmtTime(s.checkedInUntil)}` : ''}. Choose a free chair on the plan.</p></div>`;
  } else if (!state.project) {
    body = `<div class="pform need-project"><h3><span class="step">2</span>Book this desk</h3><p class="lead">Choose your project in step 1 above first.</p></div>`;
  } else {
    body = `${allocationWarning(s)}${bookingForm(s)}`;
  }
  panel.innerHTML = `<div class="panel-inner">${head}${flash}${body}</div>`;
  fillName();
}
function fillName() {
  const name = $('panel').querySelector('input[name=user]');
  if (name) name.value = demoMode ? (demoName ||= randomName()) : store.get('hotdesk.user') || '';
}

function durationSelect() {
  const { checkinDurationMinutes: def = 240, checkinMaxMinutes: max = 600 } = state.options;
  const opts = new Set([def]);
  for (let m = 60; m <= max; m += 60) opts.add(m);
  return `<select name="minutes">${[...opts].sort((a, b) => a - b).map((m) => `<option value="${m}"${m === def ? ' selected' : ''}>${fmtDuration(m)}${m === def ? ' (default)' : ''}</option>`).join('')}</select>`;
}

// ---------- Several desks for the team ----------
function multiPanel() {
  const flash = state.flash && state.flash.multi
    ? `<div class="flash ${state.flash.err ? 'warn-flash' : 'ok'}" role="status">${state.flash.err ? ICON.warn : ICON.ok}<span>${state.flash.html}</span></div>` : '';
  const head = `<div class="ptitle"><h2 style="font-size:18px;margin:0">Desks for ${state.project ? esc(state.project) : 'your team'}</h2></div>
    <p class="lead" style="margin:4px 0 0;color:var(--text-muted);font-size:13px">Tap free chairs on the plan to add them, tap again to remove. Up to ${maxPicks()} desks.</p>`;
  if (!state.project) {
    return `<div class="panel-inner">${head}${flash}<div class="pform need-project"><h3><span class="step">2</span>Choose desks</h3><p class="lead">Choose your project in step 1 above first.</p></div></div>`;
  }
  const ids = [...state.picked];
  const chips = ids.length
    ? `<div class="chips" style="margin-top:12px">${ids.map((id) => `<button type="button" class="chipbtn" data-unpick="${esc(id)}" title="Remove ${esc(id)}">${esc(id)} ✕</button>`).join('')}</div>`
    : `<p class="lead" style="margin:12px 0 0">No desks picked yet.</p>`;
  const warn = ids.length ? multiWarning(ids) : '';
  const blocked = !ids.length || Boolean(warn.blocked);
  return `<div class="panel-inner">${head}${flash}${chips}${warn.html ?? ''}
    <form class="pform" id="multiForm">
      <h3><span class="step">3</span>Your details</h3>
      <p class="lead">All the desks are booked under your name for ${esc(state.project)}, from now for the time you choose. They stay held for the whole time, even before people arrive.</p>
      <label>Your name or employee ID<input name="user" autocomplete="username" required></label>
      ${demoMode ? '<button type="button" class="btn btn-ghost demo-name" data-act="rename">↻ Another sample name</button>' : ''}
      <label>How long?${durationSelect()}</label>
      <button class="btn btn-primary btn-block" type="submit"${blocked ? ' disabled' : ''}>Book ${ids.length || ''} desk${ids.length === 1 ? '' : 's'} for ${esc(state.project)}</button>
      <div class="form-msg" id="formMsg"></div>
    </form></div>`;
}

/** Picked desks that aren't pre-allocated to the project: one warning (with the project's free desks) to confirm. */
function multiWarning(ids) {
  const mine = allocatedTo(state.project);
  if (!mine.length) return {};
  const off = ids.filter((id) => state.seats.get(id)?.allocatedTo !== state.project);
  if (!off.length) return { html: `<div class="alloc-warn ack" style="margin-top:12px">${ICON.ok}<span>All ${ids.length} desks are pre-allocated to ${esc(state.project)}.</span></div>` };
  const key = [...ids].sort().join(',');
  if (state.ack === key) return { html: `<div class="alloc-warn ack" style="margin-top:12px">${ICON.warn}<span>Continuing with ${off.length} desk${off.length === 1 ? '' : 's'} not pre-allocated to ${esc(state.project)}.</span></div>` };
  const free = mine.filter((x) => BOOKABLE.has(x.status) && !state.picked.has(x.id));
  return { blocked: true, html: `<div class="alloc-warn" role="alert" style="margin-top:12px">
    <div class="aw-head">${ICON.warn}<span><b>${off.length} of ${ids.length} desks ${off.length === 1 ? 'is' : 'are'} not pre-allocated to ${esc(state.project)}:</b> ${off.map(esc).join(', ')}</span></div>
    ${free.length ? `<div class="aw-list"><span>${esc(state.project)}'s free pre-allocated desks (tap to add):</span>${free.slice(0, 12).map((x) => `<button type="button" class="aw-seat" data-add="${esc(x.id)}">${esc(x.id)}</button>`).join('')}</div>`
      : `<div class="aw-list"><span>All of ${esc(state.project)}'s pre-allocated desks are taken or picked.</span></div>`}
    <div class="aw-actions"><button type="button" class="btn" data-act="ackmulti" data-key="${esc(key)}">Continue with these desks</button></div>
  </div>` };
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
  const blocked = state.project && [...state.seats.values()].some((x) => x.allocatedTo === state.project) && s.allocatedTo !== state.project && state.ack !== s.id;
  return `<form class="pform" id="bookForm">
    <h3><span class="step">3</span>Your details</h3>
    <p class="lead">Starts now and lasts for the time you choose.</p>
    <label>Your name or employee ID<input name="user" autocomplete="username" required></label>
    ${demoMode ? '<button type="button" class="btn btn-ghost demo-name" data-act="rename">↻ Another sample name</button>' : ''}
    <label>How long?${durationSelect()}</label>
    <button class="btn btn-primary btn-block" type="submit"${blocked ? ' disabled' : ''}>Book desk ${esc(s.id)}</button>
    <div class="form-msg" id="formMsg"></div>
  </form>`;
}

$('panel').addEventListener('click', async (e) => {
  const un = e.target.closest('[data-unpick]');
  if (un) { togglePick(un.dataset.unpick); return; }
  const add = e.target.closest('[data-add]');
  if (add) { const s = state.seats.get(add.dataset.add); if (s && s.floor !== state.floor) { state.floor = s.floor; renderFloors(); renderPlan(); } togglePick(add.dataset.add); return; }
  const go = e.target.closest('[data-go]');
  if (go) { const s = state.seats.get(go.dataset.go); if (s && s.floor !== state.floor) { state.floor = s.floor; renderFloors(); renderPlan(); } select(go.dataset.go); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') select(null);
  if (act === 'ack') { state.ack = state.selected; renderPanel(); }
  if (act === 'ackmulti') { state.ack = e.target.closest('[data-key]').dataset.key; renderPanel(); }
  if (act === 'rename') { demoName = randomName(); const i = $('panel').querySelector('input[name=user]'); if (i) i.value = demoName; }
  if (act === 'leave') await leave();
});
$('panel').addEventListener('submit', async (e) => {
  if (e.target.id === 'multiForm') { e.preventDefault(); await bookMulti(e.target); return; }
  if (e.target.id !== 'bookForm') return;
  e.preventDefault();
  const f = e.target, user = f.elements.user.value.trim(), id = state.selected;
  if (!user) { $('formMsg').textContent = 'Enter your name first.'; f.elements.user.focus(); return; }
  if (!demoMode) store.set('hotdesk.user', user);
  f.querySelector('button[type=submit]').disabled = true;
  try {
    const seat = await call(`/api/seats/${encodeURIComponent(id)}/checkin`, { user, projectTeam: state.project, minutes: Number(f.elements.minutes.value) });
    state.seats.set(seat.id, { ...state.seats.get(seat.id), ...seat });
    state.mine = { seats: [seat.id], user, team: state.project, until: seat.checkedInUntil, teamBooking: false };
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

async function bookMulti(f) {
  const user = f.elements.user.value.trim(), ids = [...state.picked];
  if (!user) { $('formMsg').textContent = 'Enter your name first.'; f.elements.user.focus(); return; }
  if (!demoMode) store.set('hotdesk.user', user);
  f.querySelector('button[type=submit]').disabled = true;
  try {
    const seats = await call('/api/team-bookings', { user, projectTeam: state.project, minutes: Number(f.elements.minutes.value), seats: ids });
    for (const seat of seats) state.seats.set(seat.id, { ...state.seats.get(seat.id), ...seat });
    const until = seats[0]?.checkedInUntil;
    state.mine = { seats: seats.map((x) => x.id), user, team: state.project, until, teamBooking: true };
    store.set('hotdesk.mine', JSON.stringify(state.mine));
    demoName = '';
    state.picked.clear(); state.ack = '';
    state.flash = { multi: true, html: `Booked ${seats.length} desk${seats.length === 1 ? '' : 's'} for <b>${esc(state.project)}</b> under ${esc(user)} until <b>${fmtTime(until)}</b>: ${seats.map((x) => esc(x.id)).join(', ')}.` };
    patchSeats(); updateCounts(); renderMine(); renderPanel(); renderProjectSummary(); renderMultiBar();
  } catch (err) {
    $('formMsg').textContent = err.message;
    f.querySelector('button[type=submit]').disabled = false;
    refresh();
  }
}

/** Check out of the person's own booking: every desk in it (a team booking releases them all). */
async function leave() {
  const m = state.mine; if (!m) return;
  let released = 0, failed = '';
  for (const id of m.seats) {
    try {
      const seat = await call(`/api/seats/${encodeURIComponent(id)}/checkout`, { user: m.user, projectTeam: m.team });
      state.seats.set(seat.id, { ...state.seats.get(seat.id), ...seat });
      released++;
    } catch (err) { failed = err.message; }
  }
  state.mine = null; store.set('hotdesk.mine', null);
  const html = m.seats.length > 1 ? `Released ${released} desk${released === 1 ? '' : 's'}. They are free for others.` : 'Checked out. The desk is free for others.';
  state.flash = state.multi ? { multi: true, html } : { seat: m.seats[0], html };
  if (failed && !released) state.flash = { ...state.flash, err: true, html: esc(failed) };
  patchSeats(); updateCounts(); renderMine(); renderPanel(); renderProjectSummary();
}

// ---------- "You're checked in" bar ----------
function renderMine() {
  const m = state.mine;
  if (m) {
    // Drop desks that were released elsewhere (checked out, or auto-released); forget it once none are left.
    m.seats = m.seats.filter((id) => { const s = state.seats.get(id); return !s || s.checkedInUntil; });
    if (m.until <= Date.now() || !m.seats.length) { state.mine = null; store.set('hotdesk.mine', null); }
    else store.set('hotdesk.mine', JSON.stringify(m));
  }
  $('mine').hidden = !state.mine;
  if (!state.mine) return;
  const n = state.mine.seats.length;
  $('mine').innerHTML = `${ICON.ok}<span>${state.mine.teamBooking
    ? `You booked <b>${n} desk${n === 1 ? '' : 's'}</b> for ${esc(state.mine.team)} until <b>${fmtTime(state.mine.until)}</b>: ${state.mine.seats.map(esc).join(', ')}.`
    : `You are checked in at <b>${esc(state.mine.seats[0])}</b> (${esc(state.mine.team)}) until <b>${fmtTime(state.mine.until)}</b>.`}</span>
    <span class="spacer"></span><button type="button" class="btn" id="showMine">Show on plan</button><button type="button" class="btn" id="leaveMine">${n > 1 ? 'Release these desks' : "I'm leaving"}</button>`;
  $('showMine').onclick = () => {
    const s = state.seats.get(state.mine.seats[0]);
    if (state.multi) setMulti(false);
    if (s && s.floor !== state.floor) { state.floor = s.floor; renderFloors(); renderPlan(); }
    select(state.mine.seats[0]);
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
  // A picked desk someone else took in the meantime is dropped from the picks.
  const lost = [...state.picked].filter((id) => !BOOKABLE.has(state.seats.get(id)?.status));
  for (const id of lost) state.picked.delete(id);
  if (lost.length) state.flash = { multi: true, err: true, html: `${lost.map(esc).join(', ')} ${lost.length === 1 ? 'was' : 'were'} just taken and removed from your picks.` };
  patchSeats(); updateCounts(); renderProjectSummary(); renderMine(); renderMultiBar();
  // Redraw the panel only when something it shows changed (keeps what was typed).
  const now = state.selected && state.seats.get(state.selected)?.status;
  if (state.multi ? lost.length : (!state.selected || before !== now)) renderPanel();
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
