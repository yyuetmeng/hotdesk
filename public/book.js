'use strict';
/*
 * Self-service reservations (/book): an employee picks their project, a day (today or
 * tomorrow) and a slot (morning, afternoon or full day), taps a free chair and reserves it
 * (or several desks for their team). A reservation only holds the desk: they check in when they
 * arrive (QR code, or Check in under My reservations) from 15 minutes before the slot until
 * 30 minutes after it starts, or it is released as a no-show. Public endpoints only (no admin
 * token): /api/floors, /api/availability?date&slot, /api/checkin-options, /api/reservations and
 * the seat check-in call. The plan is drawn by floorplan.js.
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} },
};

// Demo mode (npm run demo, or /book?demo): the name field is filled with a random sample name (demo-names.js).
let demoMode = demoFromUrl === true;
let demoName = '';
const randomName = () => randomDemoName(demoName);

const ICON = {
  seat: '<svg class="i" viewBox="0 0 24 24"><path d="M6 19v-3M18 19v-3M5 12h14v4H5zM7 12V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v6"/></svg>',
  pin: '<svg class="i" viewBox="0 0 24 24"><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  close: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  ok: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  warn: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  clock: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

const state = {
  floors: [], seats: new Map(), options: { projects: [], projectTeams: [], reservations: { dates: [], slots: [] } },
  project: store.get('hotdesk.team') || '', floor: store.get('hotdesk.bookFloor') || '',
  date: '', slot: '',
  selected: null, ack: '', flash: null,
  // "Desks for my team": the picked desks, reserved together for the project.
  multi: false, picked: new Set(),
  // Names this device has reserved under, so "My reservations" can list them.
  names: (() => { try { return JSON.parse(store.get('hotdesk.myNames') || '[]'); } catch { return []; } })(),
  mine: [],
};
const maxPicks = () => state.options.teamBookingMaxSeats || 10;
const allocatedTo = (team) => [...state.seats.values()].filter((x) => x.allocatedTo === team);
const R = () => state.options.reservations;
const slotDef = (id = state.slot) => R().slots.find((s) => s.id === id);
const free = (s) => s?.slotState?.state === 'free';
function rememberName(name) {
  state.names = [name, ...state.names.filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 12);
  store.set('hotdesk.myNames', JSON.stringify(state.names));
}

async function call(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- When: day and slot ----------
const slotTimes = (date, id) => { const s = slotDef(id), [y, m, d] = date.split('-').map(Number); return { start: new Date(y, m - 1, d, s.from).getTime(), end: new Date(y, m - 1, d, s.to).getTime() }; };
const slotOver = (date, id) => Date.now() > slotTimes(date, id).end - 3_600_000;
const dayLabel = (date) => (date === R().dates[0] ? 'Today' : date === R().dates[1] ? 'Tomorrow' : date);
const longDate = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); };
const whenText = (date = state.date, id = state.slot) => `${dayLabel(date).toLowerCase()} (${longDate(date)}), ${slotDef(id).label.toLowerCase()} ${hh(slotDef(id).from)}–${hh(slotDef(id).to)}`;

function pickDefaultWhen() {
  const [today, tomorrow] = R().dates;
  const order = new Date().getHours() < 12 ? ['am', 'day', 'pm'] : ['pm', 'day', 'am'];
  const todaySlot = order.find((id) => !slotOver(today, id));
  [state.date, state.slot] = todaySlot ? [today, todaySlot] : [tomorrow, 'am'];
}
function renderWhen() {
  $('day').innerHTML = R().dates.map((d) => `<button type="button" data-day="${d}" aria-pressed="${d === state.date}">${esc(dayLabel(d))}<small>${esc(longDate(d))}</small></button>`).join('');
  $('slot').innerHTML = R().slots.map((s) => {
    const over = slotOver(state.date, s.id);
    return `<button type="button" data-slot="${s.id}" aria-pressed="${s.id === state.slot}"${over ? ' disabled title="This slot is over or nearly over"' : ''}>${esc(s.label)}<small>${hh(s.from)}–${hh(s.to)}</small></button>`;
  }).join('');
}
function setWhen(date, slot) {
  state.date = date; state.slot = slot;
  if (slotOver(state.date, state.slot)) state.slot = R().slots.find((s) => !slotOver(state.date, s.id))?.id ?? state.slot;
  state.picked.clear(); state.selected = null; state.flash = null; state.ack = '';
  renderWhen(); renderMultiBar();
  refresh().then(() => renderPanel()).catch(() => {});
}
$('day').addEventListener('click', (e) => { const b = e.target.closest('button[data-day]'); if (b) setWhen(b.dataset.day, state.slot); });
$('slot').addEventListener('click', (e) => { const b = e.target.closest('button[data-slot]'); if (b && !b.disabled) setWhen(state.date, b.dataset.slot); });

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
    const count = allocatedTo(n).length;
    return `<option${n === state.project ? ' selected' : ''} value="${esc(n)}">${esc(n)}${count ? ` (${count} pre-allocated)` : ''}</option>`;
  }).join('');
  $('project').classList.toggle('active', Boolean(state.project));
  renderProjectSummary();
}
function renderProjectSummary() {
  const mine = allocatedTo(state.project);
  const n = mine.filter(free).length;
  $('projSum').innerHTML = !state.project ? ''
    : mine.length ? `<span class="book-sw" style="background:${projectColor(state.project)}"></span><span>${mine.length} desk${mine.length === 1 ? ' is' : 's are'} pre-allocated to ${esc(state.project)} and highlighted · <b>${n} free ${esc(dayLabel(state.date).toLowerCase())} ${esc(slotDef().label.toLowerCase())}</b></span>`
    : `<span>${esc(state.project)} has no pre-allocated desks: any free desk is fine.</span>`;
}
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
  renderProjectSummary(); patchSeats(); renderPanel(); renderLegend();
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
  const min = matchMedia('(pointer: coarse)').matches ? 5.5 : 2.5;
  const s = Math.min(8, Math.max(min, ($('plan').clientWidth - inset - 1) / Number(svg.dataset.w)));
  svg.setAttribute('width', Math.round(Number(svg.dataset.w) * s));
  svg.setAttribute('height', Math.round(Number(svg.dataset.h) * s));
}
addEventListener('resize', scalePlan);

/** A desk's look for the chosen slot: free, reserved, or in use (when the slot is under way). */
function lookOf(s) {
  const st = s.slotState?.state;
  if (st === 'reserved') return 'st-reserved';
  if (st === 'taken') return `st-${s.status === 'away' ? 'away' : 'occupied'}`;
  return 'st-available';
}
const STATE_TEXT = { free: 'free', reserved: 'reserved', taken: 'in use' };
function patchSeats() {
  for (const el of $('plan').querySelectorAll('.seat')) {
    const s = state.seats.get(el.dataset.seat); if (!s) continue;
    const pre = state.project && s.allocatedTo === state.project;
    const sel = state.multi ? state.picked.has(s.id) : state.selected === s.id;
    el.setAttribute('class', `seat ${lookOf(s)}${pre ? ' prealloc' : ''}${sel ? ' is-selected' : ''}${free(s) ? '' : ' is-taken'}`);
    if (pre) el.style.setProperty('--pa', projectColor(state.project)); else el.style.removeProperty('--pa');
    el.setAttribute('aria-pressed', String(sel));
    el.setAttribute('aria-label', `Desk ${s.id}, ${s.zoneName}: ${STATE_TEXT[s.slotState?.state] ?? ''} ${whenText()}${s.allocatedTo ? `, pre-allocated to ${s.allocatedTo}` : ''}`);
  }
}
function updateCounts() {
  if (!layout) return;
  for (const z of layout.zones) {
    const seats = [...state.seats.values()].filter((s) => s.floor === layout.id && s.zone === z.id);
    const el = $('plan').querySelector(`[data-zone-count="${CSS.escape(`${layout.id}|${z.id}`)}"]`);
    if (el) el.textContent = `${seats.filter(free).length} of ${seats.length} free`;
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
  else if (!free(s)) state.flash = { multi: true, err: true, html: `${esc(id)} is ${STATE_TEXT[s.slotState?.state] ?? 'taken'} for ${esc(whenText())}. Choose a free desk.` };
  else if (state.picked.size >= maxPicks()) state.flash = { multi: true, err: true, html: `You can reserve up to ${maxPicks()} desks at once.` };
  else state.picked.add(id);
  patchSeats(); renderPanel(); renderMultiBar();
}
function renderMultiBar() {
  const n = state.picked.size;
  $('multiBar').hidden = !state.multi || !n;
  $('multiBarText').textContent = `${n} desk${n === 1 ? '' : 's'} picked`;
}
$('multiBarGo').addEventListener('click', () => $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' }));

function select(id) {
  state.selected = state.selected === id ? null : id; state.ack = ''; state.flash = null;
  patchSeats(); renderPanel();
  if (id && matchMedia('(max-width: 1180px)').matches) $('panel').scrollTop = 0;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.selected && !state.multi) select(null); });

function renderLegend() {
  const ws = (cls, style = '') => FloorPlan.sampleSVG(cls, style);
  $('legend').innerHTML = `
    <span class="litem">${ws('st-available')}Free</span>
    <span class="litem">${ws('st-available is-selected')}Your choice</span>
    <span class="litem">${ws('st-reserved')}Reserved</span>
    <span class="litem">${ws('st-occupied')}In use</span>
    <span class="litem">${ws('st-available prealloc', `--pa:${state.project ? projectColor(state.project) : 'var(--accent)'}`)}Pre-allocated to your project</span>`;
}

// ---------- Panel ----------
function windowText(date = state.date, id = state.slot) {
  const { start } = slotTimes(date, id);
  const early = R().earlyMinutes * 60_000, grace = R().graceMinutes * 60_000;
  const from = Math.max(Date.now(), start - early), to = Math.max(start, Date.now()) + grace;
  return `Check in between ${fmtTime(from)} and ${fmtTime(to)} (scan the desk's QR code, or tap Check in under My reservations), or the desk is released.`;
}
function nameField() {
  return `<label>Your name or employee ID<input name="user" autocomplete="username" required></label>
    ${demoMode ? '<button type="button" class="btn btn-ghost demo-name" data-act="rename">↻ Another sample name</button>' : ''}`;
}
function fillName() {
  const name = $('panel').querySelector('input[name=user]');
  if (name) name.value = demoMode ? (demoName ||= randomName()) : store.get('hotdesk.user') || '';
}

function renderPanel() {
  const panel = $('panel');
  if (state.multi) { panel.classList.remove('open'); panel.innerHTML = multiPanel(); fillName(); return; }
  const s = state.selected && state.seats.get(state.selected);
  panel.classList.toggle('open', Boolean(s));
  if (!s) { panel.innerHTML = emptyPanel(); return; }
  const st = s.slotState?.state ?? 'free';
  const pill = st === 'free' ? '<span class="pill k-available">Free</span>' : st === 'reserved' ? '<span class="pill k-reserved">Reserved</span>' : '<span class="pill k-occupied">In use</span>';
  const head = `<div class="phead">
      <div><h2>Desk ${esc(s.id)}</h2>${pill}</div>
      <button type="button" class="btn btn-ghost close" aria-label="Close" data-act="close">${ICON.close}</button>
    </div>
    <ul class="meta"><li>${ICON.pin}<span><b>${esc(s.floorName)}</b> · ${esc(s.zoneName)}${s.allocatedTo ? `<br><span class="muted">Pre-allocated to ${esc(s.allocatedTo)}</span>` : ''}</span></li>
      <li>${ICON.clock}<span>${esc(whenText().replace(/^./, (c) => c.toUpperCase()))}</span></li></ul>`;
  const flash = state.flash && state.flash.seat === s.id
    ? `<div class="flash ${state.flash.err ? 'warn-flash' : 'ok'}" role="status">${state.flash.err ? ICON.warn : ICON.ok}<span>${state.flash.html}</span></div>` : '';
  let body = '';
  if (flash && !state.flash.err) body = '';
  else if (st === 'reserved') body = `<div class="pform"><p class="lead" style="margin:0">Someone${s.slotState.team ? ` from ${esc(s.slotState.team)}` : ''} has reserved this desk for this slot. Choose a free one.</p></div>`;
  else if (st === 'taken') body = `<div class="pform"><p class="lead" style="margin:0">This desk is in use during this slot. Choose a free one.</p></div>`;
  else if (!state.project) body = `<div class="pform need-project"><h3><span class="step">3</span>Reserve this desk</h3><p class="lead">Choose your project in step 1 above first.</p></div>`;
  else body = `${allocationWarning(s)}${reserveForm(s)}`;
  panel.innerHTML = `<div class="panel-inner">${head}${flash}${body}</div>`;
  fillName();
}

function emptyPanel() {
  const seats = [...state.seats.values()].filter((s) => s.floor === state.floor);
  const f = state.floors.find((x) => x.id === state.floor);
  return `<div class="panel-empty">
    <div class="big">${ICON.seat.replace('class="i"', 'class="i" style="width:24px;height:24px"')}</div>
    <h3><span class="step">3</span>Choose a desk</h3>
    <p>${state.project ? `Tap a free chair to reserve it for ${esc(whenText())}.` : 'Choose your project first, then tap a free chair on the plan.'}</p>
    <div class="stat"><b>${seats.filter(free).length}</b>of ${seats.length} desks free${f ? ` on ${esc(f.name)}` : ''}, ${esc(dayLabel(state.date).toLowerCase())} ${esc(slotDef().label.toLowerCase())}</div>
  </div>`;
}

function allocationWarning(s) {
  const mine = allocatedTo(state.project);
  if (!mine.length || s.allocatedTo === state.project) {
    return mine.length ? `<div class="alloc-warn ack">${ICON.ok}<span>Pre-allocated to ${esc(state.project)}.</span></div>` : '';
  }
  if (state.ack === s.id) return `<div class="alloc-warn ack">${ICON.warn}<span>Not pre-allocated to ${esc(state.project)}. Continuing with this desk.</span></div>`;
  const others = mine.filter(free);
  return `<div class="alloc-warn" role="alert">
    <div class="aw-head">${ICON.warn}<span><b>${esc(s.id)} is not pre-allocated to ${esc(state.project)}.</b> ${s.allocatedTo ? `It is pre-allocated to ${esc(s.allocatedTo)}.` : ''}</span></div>
    ${others.length ? `<div class="aw-list"><span>${esc(state.project)}'s free pre-allocated desks for this slot:</span>${others.slice(0, 12).map((x) => `<button type="button" class="aw-seat" data-go="${esc(x.id)}">${esc(x.id)}</button>`).join('')}</div>`
      : `<div class="aw-list"><span>All of ${esc(state.project)}'s pre-allocated desks are taken for this slot.</span></div>`}
    <div class="aw-actions"><button type="button" class="btn" data-act="ack">Continue with this desk</button></div>
  </div>`;
}

function reserveForm(s) {
  const blocked = allocatedTo(state.project).length && s.allocatedTo !== state.project && state.ack !== s.id;
  return `<form class="pform" id="bookForm">
    <h3><span class="step">4</span>Your details</h3>
    ${nameField()}
    <button class="btn btn-primary btn-block" type="submit"${blocked ? ' disabled' : ''}>Reserve ${esc(s.id)} · ${esc(dayLabel(state.date))} ${esc(slotDef().label.toLowerCase())}</button>
    <p class="lead" style="margin:0">${esc(windowText())}</p>
    <div class="form-msg" id="formMsg"></div>
  </form>`;
}

function multiPanel() {
  const flash = state.flash && state.flash.multi
    ? `<div class="flash ${state.flash.err ? 'warn-flash' : 'ok'}" role="status">${state.flash.err ? ICON.warn : ICON.ok}<span>${state.flash.html}</span></div>` : '';
  const head = `<div class="ptitle"><h2 style="font-size:18px;margin:0">Desks for ${state.project ? esc(state.project) : 'your team'}</h2></div>
    <p class="lead" style="margin:4px 0 0;color:var(--text-muted);font-size:13px">${esc(whenText().replace(/^./, (c) => c.toUpperCase()))}. Tap free chairs to add them, tap again to remove. Up to ${maxPicks()} desks.</p>`;
  if (!state.project) return `<div class="panel-inner">${head}${flash}<div class="pform need-project"><h3><span class="step">3</span>Choose desks</h3><p class="lead">Choose your project in step 1 above first.</p></div></div>`;
  const ids = [...state.picked];
  const chips = ids.length
    ? `<div class="chips" style="margin-top:12px">${ids.map((id) => `<button type="button" class="chipbtn" data-unpick="${esc(id)}" title="Remove ${esc(id)}">${esc(id)} ✕</button>`).join('')}</div>`
    : '<p class="lead" style="margin:12px 0 0">No desks picked yet.</p>';
  const warn = ids.length ? multiWarning(ids) : {};
  return `<div class="panel-inner">${head}${flash}${chips}${warn.html ?? ''}
    <form class="pform" id="multiForm">
      <h3><span class="step">4</span>Your details</h3>
      <p class="lead">The desks are reserved under your name for ${esc(state.project)}. Anyone in ${esc(state.project)} confirms one by checking in at it; desks nobody checks in to are released.</p>
      ${nameField()}
      <button class="btn btn-primary btn-block" type="submit"${!ids.length || warn.blocked ? ' disabled' : ''}>Reserve ${ids.length || ''} desk${ids.length === 1 ? '' : 's'} for ${esc(state.project)}</button>
      <p class="lead" style="margin:0">${esc(windowText())}</p>
      <div class="form-msg" id="formMsg"></div>
    </form></div>`;
}
function multiWarning(ids) {
  const mine = allocatedTo(state.project);
  if (!mine.length) return {};
  const off = ids.filter((id) => state.seats.get(id)?.allocatedTo !== state.project);
  if (!off.length) return { html: `<div class="alloc-warn ack" style="margin-top:12px">${ICON.ok}<span>All ${ids.length} desks are pre-allocated to ${esc(state.project)}.</span></div>` };
  const key = [...ids].sort().join(',');
  if (state.ack === key) return { html: `<div class="alloc-warn ack" style="margin-top:12px">${ICON.warn}<span>Continuing with ${off.length} desk${off.length === 1 ? '' : 's'} not pre-allocated to ${esc(state.project)}.</span></div>` };
  const others = mine.filter((x) => free(x) && !state.picked.has(x.id));
  return { blocked: true, html: `<div class="alloc-warn" role="alert" style="margin-top:12px">
    <div class="aw-head">${ICON.warn}<span><b>${off.length} of ${ids.length} desks ${off.length === 1 ? 'is' : 'are'} not pre-allocated to ${esc(state.project)}:</b> ${off.map(esc).join(', ')}</span></div>
    ${others.length ? `<div class="aw-list"><span>${esc(state.project)}'s free pre-allocated desks (tap to add):</span>${others.slice(0, 12).map((x) => `<button type="button" class="aw-seat" data-add="${esc(x.id)}">${esc(x.id)}</button>`).join('')}</div>`
      : `<div class="aw-list"><span>All of ${esc(state.project)}'s pre-allocated desks are taken or picked.</span></div>`}
    <div class="aw-actions"><button type="button" class="btn" data-act="ackmulti" data-key="${esc(key)}">Continue with these desks</button></div>
  </div>` };
}

$('panel').addEventListener('click', (e) => {
  const un = e.target.closest('[data-unpick]');
  if (un) { togglePick(un.dataset.unpick); return; }
  const add = e.target.closest('[data-add]');
  if (add) { const s = state.seats.get(add.dataset.add); if (s && s.floor !== state.floor) { state.floor = s.floor; renderFloors(); renderPlan(); } togglePick(add.dataset.add); return; }
  const go = e.target.closest('[data-go]');
  if (go) { const s = state.seats.get(go.dataset.go); if (s && s.floor !== state.floor) { state.floor = s.floor; renderFloors(); renderPlan(); } state.selected = null; select(go.dataset.go); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') select(null);
  if (act === 'ack') { state.ack = state.selected; renderPanel(); }
  if (act === 'ackmulti') { state.ack = e.target.closest('[data-key]').dataset.key; renderPanel(); }
  if (act === 'rename') { demoName = randomName(); const i = $('panel').querySelector('input[name=user]'); if (i) i.value = demoName; }
});
$('panel').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, user = f.elements.user.value.trim();
  if (!user) { $('formMsg').textContent = 'Enter your name first.'; f.elements.user.focus(); return; }
  const team = f.id === 'multiForm';
  const seats = team ? [...state.picked] : [state.selected];
  if (!demoMode) store.set('hotdesk.user', user);
  f.querySelector('button[type=submit]').disabled = true;
  try {
    const made = await call('/api/reservations', { seats, user, projectTeam: state.project, date: state.date, slot: state.slot, forTeam: team });
    rememberName(user);
    demoName = '';
    const html = `Reserved ${made.length > 1 ? `${made.length} desks (${made.map((r) => esc(r.seatId)).join(', ')})` : `<b>${esc(made[0].seatId)}</b>`} for ${esc(whenText())}. ${esc(windowText())}`;
    state.flash = team ? { multi: true, html } : { seat: made[0].seatId, html };
    state.picked.clear(); state.ack = '';
    await refresh();
    renderPanel(); renderMultiBar();
  } catch (err) {
    $('formMsg').textContent = err.message;
    f.querySelector('button[type=submit]').disabled = false;
  }
});

// ---------- My reservations ----------
const RSTATUS = { booked: ['Reserved', 'var(--seat-reserved)'], 'checked-in': ['Checked in', 'var(--available)'], 'no-show': ['No-show', 'var(--text-muted)'], cancelled: ['Cancelled', 'var(--text-muted)'] };
async function loadMine() {
  const lists = await Promise.all(state.names.map((n) => call(`/api/reservations?user=${encodeURIComponent(n)}`).then((l) => l.map((r) => ({ ...r, user: n }))).catch(() => [])));
  const now = Date.now();
  state.mine = lists.flat().filter((r) => (r.status === 'booked' || r.status === 'checked-in') && r.end > now);
}
function renderMine() {
  const box = $('mine');
  box.hidden = !state.mine.length;
  if (!state.mine.length) { box.innerHTML = ''; return; }
  // A team reservation (several desks) is one row.
  const groups = new Map();
  for (const r of state.mine) { const k = r.group ? `g:${r.group}` : r.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const now = Date.now();
  box.innerHTML = `<h2>My reservations</h2><ul class="mine-list">${[...groups.values()].map((rs) => {
    const r = rs[0], booked = rs.filter((x) => x.status === 'booked');
    const [label, color] = RSTATUS[booked.length ? 'booked' : r.status];
    const open = now >= r.checkInFrom && now < r.deadline;
    const desks = rs.length > 1 ? `${rs.length} desks for ${esc(r.team)}: ${rs.map((x) => esc(x.seatId)).join(', ')}` : `Desk ${esc(r.seatId)}`;
    const when = `${dayLabel(r.date)} (${longDate(r.date)}) · ${r.slotLabel} ${fmtTime(r.start)}–${fmtTime(r.end)}`;
    const hint = booked.length ? (rs.length > 1 ? `Teammates check in at the desks ${open ? `by ${fmtTime(r.deadline)}` : `from ${fmtTime(r.checkInFrom)} to ${fmtTime(r.deadline)}`}` : open ? `Check in by ${fmtTime(r.deadline)}` : `Check in from ${fmtTime(r.checkInFrom)} to ${fmtTime(r.deadline)}`) : '';
    return `<li>
      <span class="what"><b>${desks}</b> <span class="badge" style="--k:${color}">${label}</span><small>${esc(when)} · ${esc(r.team)} · ${esc(r.user)}${hint ? ` · ${esc(hint)}` : ''}</small></span>
      <button type="button" class="btn" data-show="${esc(r.seatId)}" data-date="${r.date}" data-slot="${r.slot}">Show on plan</button>
      ${rs.length === 1 && r.status === 'booked' ? `<button type="button" class="btn btn-primary" data-checkin="${esc(r.id)}"${open ? '' : ` disabled title="Check-in opens at ${fmtTime(r.checkInFrom)}"`}>Check in</button>` : ''}
      ${booked.length ? `<button type="button" class="btn" data-cancel="${esc(booked.map((x) => x.id).join(','))}">Cancel${rs.length > 1 ? ' all' : ''}</button>` : ''}
    </li>`;
  }).join('')}</ul>`;
}
$('mine').addEventListener('click', async (e) => {
  const show = e.target.closest('[data-show]');
  if (show) {
    if (show.dataset.date !== state.date || show.dataset.slot !== state.slot) { state.date = show.dataset.date; state.slot = show.dataset.slot; renderWhen(); await refresh(); }
    const s = state.seats.get(show.dataset.show);
    if (state.multi) setMulti(false);
    if (s && s.floor !== state.floor) { state.floor = s.floor; renderFloors(); renderPlan(); }
    state.selected = null; select(show.dataset.show);
    $('plan').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const ci = e.target.closest('[data-checkin]');
  if (ci) {
    const r = state.mine.find((x) => x.id === ci.dataset.checkin);
    ci.disabled = true;
    try { await call(`/api/seats/${encodeURIComponent(r.seatId)}/checkin`, { user: r.user, projectTeam: r.team }); }
    catch (err) { alert(err.message); }
    await refresh();
    return;
  }
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) {
    const ids = cancel.dataset.cancel.split(',');
    if (!confirm(ids.length > 1 ? `Cancel the reservation for ${ids.length} desks?` : 'Cancel this reservation?')) return;
    for (const id of ids) {
      const r = state.mine.find((x) => x.id === id);
      try { await call(`/api/reservations/${encodeURIComponent(id)}/cancel`, { user: r.user }); } catch (err) { alert(err.message); }
    }
    await refresh();
  }
});

// ---------- Data ----------
async function refresh() {
  const [list] = await Promise.all([call(`/api/availability?date=${state.date}&slot=${state.slot}`), loadMine()]);
  const selectedFree = state.selected && free(state.seats.get(state.selected));
  state.seats = new Map(list.map((s) => [s.id, s]));
  // A picked desk someone else reserved in the meantime is dropped from the picks.
  const lost = [...state.picked].filter((id) => !free(state.seats.get(id)));
  for (const id of lost) state.picked.delete(id);
  if (lost.length) state.flash = { multi: true, err: true, html: `${lost.map(esc).join(', ')} ${lost.length === 1 ? 'was' : 'were'} just reserved by someone else and removed from your picks.` };
  $('live').className = 'live on';
  $('live').innerHTML = `Live <span class="sep">·</span> Updated ${fmtTime(Date.now())}`;
  renderWhen(); patchSeats(); updateCounts(); renderProjectSummary(); renderMine(); renderMultiBar();
  // Redraw the panel only when something it shows changed (keeps what was typed).
  const nowFree = state.selected && free(state.seats.get(state.selected));
  if (state.multi ? lost.length : (!state.selected || selectedFree !== nowFree)) renderPanel();
}

async function init() {
  try {
    const [floors, options] = await Promise.all([call('/api/floors'), call('/api/checkin-options')]);
    state.floors = floors; state.options = options;
    if (options.demo && demoFromUrl !== false) demoMode = true;
    pickDefaultWhen();
    const list = await call(`/api/availability?date=${state.date}&slot=${state.slot}`);
    state.seats = new Map(list.map((s) => [s.id, s]));
    await loadMine();
    renderWhen(); renderProjects(); renderFloors(); renderPlan(); renderLegend(); renderMine(); renderPanel();
    $('live').className = 'live on';
    $('live').innerHTML = `Live <span class="sep">·</span> Updated ${fmtTime(Date.now())}`;
    setInterval(() => refresh().catch(() => { $('live').className = 'live'; $('live').textContent = 'Reconnecting…'; }), 10_000);
  } catch (e) {
    $('plan').innerHTML = `<div class="empty">Could not load the floor plan: ${esc(e.message)}</div>`;
  }
}
init();
