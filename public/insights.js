'use strict';
/*
 * Insights (/insights): capacity and demand planning on SIMULATED data (GET /api/insights, admin).
 * Nothing here reads the live seats; the page says so in its banner, title and charts.
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const token = new URLSearchParams(location.search).get('token');
const withToken = (p) => (token ? `${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : p);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (d) => { const t = new Date(`${d}T00:00:00Z`); return `${DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${t.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`; };
const shortDate = (d) => { const t = new Date(`${d}T00:00:00Z`); return `${t.getUTCDate()} ${t.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`; };
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const pct = (x) => `${Math.round(x * 100)}%`;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

let data = null;
let scopeId = store.get('hotdesk.insightsScope') || 'office';
let capMode = 'week';

// ---------- Tooltip ----------
function showTip(html, x, y) {
  const t = $('tip'); t.innerHTML = html; t.style.display = 'block';
  const r = t.getBoundingClientRect();
  t.style.left = `${Math.min(x + 14, innerWidth - r.width - 8)}px`;
  t.style.top = `${Math.min(y + 14, innerHeight - r.height - 8)}px`;
}
const hideTip = () => { $('tip').style.display = 'none'; };

// ---------- Normal distribution (what-if) ----------
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152073) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
const cdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const pdf = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

// ---------- Data shaping ----------
const series = () => data.series[scopeId] ?? data.series.office;
const isWork = (d) => { const w = weekday(d); return w >= 1 && w <= 5; };
/** Capacity chart points: last 8 weeks of history and the 12-week forecast, by working day or by week. */
function capPoints() {
  const s = series();
  const hist = s.history.slice(-56).filter((h) => isWork(h.date)).map((h) => ({ date: h.date, actual: h.peak, holiday: h.holiday }));
  const fc = s.forecast.filter((f) => isWork(f.date)).map((f) => ({ date: f.date, mean: f.mean, p10: f.p10, p90: f.p90, sd: f.sd, holiday: f.holiday }));
  if (capMode === 'day') return { points: [...hist, ...fc], split: hist.length };
  // Weekly: the busiest day of each week (Monday-based).
  const weekKey = (d) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
  const group = (list, val) => {
    const m = new Map();
    for (const p of list) { const k = weekKey(p.date); if (!m.has(k) || val(p) > val(m.get(k))) m.set(k, { ...p, week: k }); }
    return [...m.values()];
  };
  const hw = group(hist, (p) => p.actual), fw = group(fc, (p) => p.mean);
  // A week split by "today" counts as forecast if its forecast part is busier.
  const histWeeks = hw.filter((h) => !fw.some((f) => f.week === h.week && f.mean > h.actual));
  return { points: [...histWeeks.map((p) => ({ ...p, label: `Week of ${shortDate(p.week)}` })), ...fw.filter((f) => !histWeeks.some((h) => h.week === f.week)).map((p) => ({ ...p, label: `Week of ${shortDate(p.week)}` }))], split: histWeeks.length };
}

// ---------- Charts ----------
function renderCapChart() {
  const el = $('capChart'), s = series(), { points, split } = capPoints();
  const W = Math.max(320, el.clientWidth), H = 300, m = { l: 44, r: 16, t: 14, b: 30 };
  const seats = s.seats, thr = data.threshold;
  const yMax = Math.max(seats * 1.12, ...points.map((p) => p.p90 ?? p.actual ?? 0)) * 1.04;
  // Weekly peaks sit close together: start the axis lower down so the change is visible (daily keeps 0 for holidays).
  const yMin = capMode === 'week' ? Math.max(0, Math.floor(Math.min(...points.map((p) => p.p10 ?? p.actual ?? 0)) * 0.8 / 10) * 10) : 0;
  const x = (i) => m.l + (i / Math.max(1, points.length - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const path = (list, key) => list.map((p, i) => `${i ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const idx = points.map((p, i) => ({ ...p, i }));
  const hist = idx.filter((p) => p.actual !== undefined), fc = idx.filter((p) => p.mean !== undefined);
  // Join the forecast to the last actual point so the line is continuous.
  const fcLine = hist.length ? [{ ...hist.at(-1), mean: hist.at(-1).actual }, ...fc] : fc;
  const band = fc.length ? `M${fc.map((p) => `${x(p.i).toFixed(1)},${y(p.p90).toFixed(1)}`).join('L')}L${[...fc].reverse().map((p) => `${x(p.i).toFixed(1)},${y(p.p10).toFixed(1)}`).join('L')}Z` : '';
  const step = Math.max(5, Math.ceil((yMax - yMin) / 5 / 5) * 5);
  const ticks = yMin ? Array.from({ length: 8 }, (_, i) => yMin + step * i).filter((v) => v <= yMax) : [0, 0.25, 0.5, 0.75, 1, 1.25].map((f) => Math.round(seats * f)).filter((v) => v <= yMax);
  const step = Math.max(1, Math.ceil(points.length / Math.floor((W - 60) / 70)));
  const xl = idx.filter((p, i) => i % step === 0).map((p) => `<text x="${x(p.i)}" y="${H - 8}" text-anchor="middle">${esc(shortDate(p.week ?? p.date))}</text>`).join('');
  const hols = idx.filter((p) => p.holiday && capMode === 'day').map((p) => `<text class="hol" x="${x(p.i)}" y="${y((p.actual ?? p.mean) || 0) - 6}" text-anchor="middle">${esc(p.holiday.split(' ')[0])}</text>`).join('');
  const todayX = split > 0 && split < points.length ? (x(split - 1) + x(split)) / 2 : null;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Peak seat demand, simulated history and forecast">
    ${ticks.map((v) => `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${band ? `<path class="fc-band" d="${band}"/>` : ''}
    <line class="cap-line" x1="${m.l}" x2="${W - m.r}" y1="${y(seats)}" y2="${y(seats)}"/>
    <text class="lbl" x="${W - m.r}" y="${y(seats) - 5}" text-anchor="end">${seats} seats</text>
    <line class="thr-line" x1="${m.l}" x2="${W - m.r}" y1="${y(seats * thr)}" y2="${y(seats * thr)}"/>
    ${todayX ? `<line class="today-line" x1="${todayX}" x2="${todayX}" y1="${m.t}" y2="${H - m.b}"/><text class="lbl" x="${todayX + 5}" y="${m.t + 10}">Today → forecast</text>` : ''}
    <path class="act-line" d="${path(hist, 'actual')}"/>
    <path class="fc-line" d="${path(fcLine, 'mean')}"/>
    ${hols}${xl}
    <line id="capX" class="today-line" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
    <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="capHit"/>
  </svg>`;
  const svg = el.querySelector('svg');
  svg.querySelector('#capHit').addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (points.length - 1))));
    const p = points[i];
    svg.querySelector('#capX').setAttribute('x1', x(i)); svg.querySelector('#capX').setAttribute('x2', x(i)); svg.querySelector('#capX').setAttribute('visibility', 'visible');
    const head = capMode === 'week' ? `${esc(p.label)} · busiest ${esc(fmtDate(p.date))}` : esc(fmtDate(p.date));
    showTip(p.actual !== undefined
      ? `<b>${head}</b>Peak demand ${p.actual} seats (${pct(p.actual / seats)})${p.holiday ? `<br>${esc(p.holiday)}` : ''}<br><i>Simulated history</i>`
      : `<b>${head}</b>Forecast ${Math.round(p.mean)} seats (${pct(p.mean / seats)})<br>Likely ${Math.round(p.p10)}–${Math.round(p.p90)} · chance over ${pct(thr)}: ${pct(1 - cdf((thr * seats - p.mean) / (p.sd || 1)))}${p.holiday ? `<br>${esc(p.holiday)}` : ''}`, e.clientX, e.clientY);
  });
  svg.querySelector('#capHit').addEventListener('pointerleave', () => { svg.querySelector('#capX').setAttribute('visibility', 'hidden'); hideTip(); });
  $('capSub').textContent = `Peak seat demand per ${capMode === 'week' ? 'week (busiest day)' : 'working day'}: last 8 weeks and the next 12, against ${seats} seats.`;
  $('thrLbl').textContent = `${pct(thr)} of seats (${Math.round(seats * thr)})`;
}

function renderHourChart() {
  const el = $('hourChart'), s = series(), days = s.hourly7, hours = data.hours;
  const W = Math.max(320, el.clientWidth), H = 240, m = { l: 40, r: 12, t: 12, b: 34 };
  const n = days.length * hours.length;
  const yMax = Math.max(s.seats * 1.1, ...days.flatMap((d) => d.hours.map((h) => h.p90))) * 1.04;
  const x = (i) => m.l + ((i + 0.5) / n) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - v / yMax) * (H - m.t - m.b);
  const parts = days.map((d, di) => {
    const pts = d.hours.map((h, hi) => ({ ...h, i: di * hours.length + hi }));
    const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.mean).toFixed(1)}`).join('');
    const band = `M${pts.map((p) => `${x(p.i).toFixed(1)},${y(p.p90).toFixed(1)}`).join('L')}L${[...pts].reverse().map((p) => `${x(p.i).toFixed(1)},${y(p.p10).toFixed(1)}`).join('L')}Z`;
    const x0 = m.l + (di / days.length) * (W - m.l - m.r);
    return `${di ? `<line class="grid-line" x1="${x0}" x2="${x0}" y1="${m.t}" y2="${H - m.b}"/>` : ''}
      <path class="fc-band" d="${band}"/><path class="fc-line" d="${line}"/>
      <text class="lbl" x="${x0 + (W - m.l - m.r) / days.length / 2}" y="${H - 20}" text-anchor="middle">${esc(fmtDate(d.date))}${d.holiday ? ' (holiday)' : ''}</text>
      <text x="${x0 + 4}" y="${H - 6}">8:00</text>`;
  }).join('');
  const ticks = [0, 0.5, 1].map((f) => Math.round(s.seats * f));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly seat demand forecast, next working days">
    ${ticks.map((v) => `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <line class="cap-line" x1="${m.l}" x2="${W - m.r}" y1="${y(s.seats)}" y2="${y(s.seats)}"/>
    <line class="thr-line" x1="${m.l}" x2="${W - m.r}" y1="${y(s.seats * data.threshold)}" y2="${y(s.seats * data.threshold)}"/>
    ${parts}
    <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="hourHit"/>
  </svg>`;
  const svg = el.querySelector('svg');
  svg.querySelector('#hourHit').addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.floor(((px - m.l) / (W - m.l - m.r)) * n)));
    const d = days[Math.floor(i / hours.length)], h = d.hours[i % hours.length], hr = hours[i % hours.length];
    showTip(`<b>${esc(fmtDate(d.date))}, ${hr}:00</b>About ${Math.round(h.mean)} seats (${pct(h.mean / s.seats)})<br>Likely ${Math.round(h.p10)}–${Math.round(h.p90)}`, e.clientX, e.clientY);
  });
  svg.querySelector('#hourHit').addEventListener('pointerleave', hideTip);
}

function renderHeat() {
  const s = series(), hours = data.hours;
  const cell = (v) => `<td style="background:color-mix(in srgb, var(--line) ${Math.round(6 + Math.min(100, v) * 0.94)}%, var(--surface));${v > 55 ? 'color:#fff' : ''}" title="${Math.round(v)}% of seats">${Math.round(v)}</td>`;
  $('heat').innerHTML = `<table class="heat"><thead><tr><th></th>${hours.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${[1, 2, 3, 4, 5].map((w) => `<tr><th>${DAYS[w]}</th>${s.heat[w].map(cell).join('')}</tr>`).join('')}</tbody></table>
    <div class="heat-scale"><span>0%</span><i></i><span>100% of seats</span></div>`;
}

function renderUtil() {
  const el = $('utilChart'), zones = data.zones.map((z) => data.series[z.id]);
  const W = Math.max(320, el.clientWidth), row = 46, H = zones.length * row + 10, lw = Math.min(190, W * 0.34);
  const x = (v) => lw + (v / 100) * (W - lw - 50);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Utilisation by zone">
    ${[0, 25, 50, 75, 100].map((v) => `<line class="grid-line" x1="${x(v)}" x2="${x(v)}" y1="0" y2="${H - 10}"/>`).join('')}
    ${zones.map((z, i) => {
      const y0 = i * row + 6;
      const sel = z.id === scopeId;
      return `<text class="lbl" x="0" y="${y0 + 14}" style="${sel ? 'fill:var(--accent-strong)' : ''}">${esc(z.label.replace('Level ', 'L'))}</text>
        <text x="0" y="${y0 + 30}">${z.seats} seats</text>
        <rect x="${lw}" y="${y0 + 3}" width="${Math.max(2, x(z.utilisation.past) - lw)}" height="14" rx="3" fill="color-mix(in srgb, var(--line) 40%, var(--surface))"><title>Last 4 weeks: ${z.utilisation.past}%</title></rect>
        <rect x="${lw}" y="${y0 + 19}" width="${Math.max(2, x(z.utilisation.next) - lw)}" height="14" rx="3" fill="var(--line)"><title>Forecast next 4 weeks: ${z.utilisation.next}%</title></rect>
        <text x="${x(z.utilisation.past) + 6}" y="${y0 + 14}">${Math.round(z.utilisation.past)}%</text>
        <text class="lbl" x="${x(z.utilisation.next) + 6}" y="${y0 + 30}">${Math.round(z.utilisation.next)}%</text>`;
    }).join('')}
  </svg>`;
}

// ---------- Demand and what-if ----------
function renderDemand() {
  const rows = [...data.demand].sort((a, b) => b.gap - a.gap);
  const max = Math.max(...rows.map((d) => Math.max(d.needed, d.allocated))) * 1.08;
  $('demand').innerHTML = rows.map((d) => `<div class="dem-row" title="${esc(d.name)}: team of ${d.teamSize}, growing ${d.growthPerMonth}% a month; busiest on ${DAYS[d.busiestDay]}">
      <span class="dem-name">${esc(d.name)}</span>
      <span class="dem-track"><span class="dem-bar" style="width:${(100 * d.needed) / max}%"></span><span class="dem-alloc" style="left:${(100 * d.allocated) / max}%"></span></span>
      <span class="dem-txt">needs <b>${d.needed}</b> · has <b>${d.allocated}</b> · ${d.gap > 0 ? `<span class="gap-add">+${d.gap} seat${d.gap === 1 ? '' : 's'}</span>` : d.gap < 0 ? `<span class="gap-free">${-d.gap} spare</span>` : 'balanced'}</span>
    </div>`).join('');
}

function renderWhatIf() {
  const s = series();
  const lo = Math.max(4, Math.round(s.seats * 0.6)), hi = Math.round(s.seats * 1.6);
  $('whatif').innerHTML = `
    <label><span>Seats <b id="wiSeatsV"></b></span><input type="range" id="wiSeats" min="${lo}" max="${hi}" value="${s.seats}"></label>
    <label><span>Extra headcount by the end of 12 weeks <b id="wiGrowV"></b></span><input type="range" id="wiGrow" min="-20" max="30" value="0"></label>
    <label><span>Comfort threshold <b id="wiThrV"></b></span><input type="range" id="wiThr" min="75" max="100" step="5" value="${Math.round(data.threshold * 100)}"></label>
    <div class="wi-out">
      <div><b id="wiDays"></b>busy days over the threshold</div>
      <div><b id="wiShort"></b>people without a seat (person-days)</div>
      <div><b id="wiPeak"></b>busiest forecast day, % of seats</div>
      <div><b id="wiNeed"></b>seats to stay under the threshold on all but ~2 days</div>
    </div>
    <p class="wi-note">Next 12 weeks for ${esc(s.label)}, using the forecast and its likely range. Simulated.</p>`;
  const calc = () => {
    const seats = Number($('wiSeats').value), grow = Number($('wiGrow').value) / 100, thr = Number($('wiThr').value) / 100;
    const days = s.forecast.filter((f) => isWork(f.date) && !f.holiday);
    const adj = days.map((f, i) => { const k = 1 + grow * ((i + 1) / days.length); return { mean: f.mean * k, sd: (f.sd || 1) * k }; });
    const over = (cap) => adj.reduce((n, f) => n + (1 - cdf((thr * cap - f.mean) / f.sd)), 0);
    const short = adj.reduce((n, f) => { const z = (f.mean - seats) / f.sd; return n + (f.mean - seats) * cdf(z) + f.sd * pdf(z); }, 0);
    let need = Math.round(s.seats * 0.5); while (over(need) > 2 && need < s.seats * 4) need++;
    const peak = Math.max(...adj.map((f) => f.mean));
    $('wiSeatsV').textContent = `${seats}${seats !== s.seats ? ` (${seats > s.seats ? '+' : ''}${seats - s.seats})` : ''}`;
    $('wiGrowV').textContent = `${grow > 0 ? '+' : ''}${Math.round(grow * 100)}%`;
    $('wiThrV').textContent = `${Math.round(thr * 100)}%`;
    $('wiDays').textContent = Math.round(over(seats));
    $('wiShort').textContent = Math.round(short);
    $('wiPeak').textContent = pct(peak / seats);
    $('wiNeed').textContent = need;
  };
  for (const id of ['wiSeats', 'wiGrow', 'wiThr']) $(id).addEventListener('input', calc);
  calc();
}

// ---------- KPIs, recommendations, method ----------
function renderKpis() {
  const s = series(), c = s.capacity, thr = pct(data.threshold);
  const weeksTo = c.firstOver ? Math.max(0, Math.round((new Date(`${c.firstOver}T00:00:00Z`) - new Date(`${data.generatedFor}T00:00:00Z`)) / (7 * 86_400_000))) : null;
  const tile = (cls, color, label, value, sub, icon) => `<div class="card kpi${cls}" style="--k:${color}"><div class="icon">${icon}</div><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const I = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
  $('kpis').innerHTML =
    tile(' hl', '#c2410c', 'Capacity reached', c.firstOver ? esc(fmtDate(c.firstOver)) : 'Not in 12 wks',
      c.firstOver ? `busiest days pass ${thr} of ${s.seats} seats${weeksTo !== null ? ` · in ${weeksTo} week${weeksTo === 1 ? '' : 's'}` : ''}` : `peak stays under ${thr} of seats`, I('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>')) +
    tile(' hl', 'var(--accent)', 'Seats needed', c.recommendedSeats,
      c.recommendedSeats > s.seats ? `+${c.recommendedSeats - s.seats} vs ${s.seats} today, to stay under ${thr}` : `${s.seats} today is enough for 12 weeks`, I('<path d="M7 11V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5"/><path d="M5 11h14v4H5zM8 15v5M16 15v5"/>')) +
    tile('', 'var(--line)', 'Peak forecast', c.peak ? pct(c.peak.mean / s.seats) : '—',
      c.peak ? `${Math.round(c.peak.mean)} seats on ${esc(fmtDate(c.peak.date))} · up to ${pct(c.peak.p90 / s.seats)}` : '', I('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>')) +
    tile('', 'var(--available)', 'Utilisation', `${Math.round(s.utilisation.past)}%`,
      `last 4 weeks · forecast ${Math.round(s.utilisation.next)}% next 4`, I('<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4-4"/>')) +
    tile('', 'var(--text-muted)', 'Forecast accuracy', `±${s.model.mape}%`,
      `average error forecasting the last 4 weeks (backtest)`, I('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>'));
}

function renderRecs() {
  $('recs').innerHTML = data.recommendations.slice(0, 8).map((r) => `<li><span class="lv lv-${r.level}">${r.level === 'high' ? 'Act' : r.level === 'medium' ? 'Plan' : 'Note'}</span><span>${esc(r.text)}</span></li>`).join('')
    || '<li>No recommendations.</li>';
}

function renderMethod() {
  const o = data.series.office;
  $('methodList').innerHTML = [
    `Simulated history: ${data.totals.teamSize} people in ${data.demand.length} project teams over 16 weeks (${esc(fmtDate(data.historyFrom))} to ${esc(fmtDate(data.generatedFor))}), on this building's ${data.totals.seats} seats. Each team has its own size, growth and weekday pattern; Singapore public and school holidays, day-to-day noise and occasional all-hands days are included. People sit in their home zone first and overflow to others; when every seat is taken the rest is unmet demand.`,
    'Seat demand counts everyone who wanted a seat in that area, so it can exceed the seats; the actual peak is capped by the seats.',
    `Forecast: a weekday pattern times a linear trend (office trend ${o.model.trendPerMonth > 0 ? '+' : ''}${o.model.trendPerMonth}% a month), with learned school- and public-holiday effects. The likely range (P10–P90) comes from the past error (±${o.model.relSd}%) and widens further ahead.`,
    `Accuracy: the model was refitted without the last 4 weeks and forecast them; the average error was ${o.model.mape}% for the whole office.`,
    'Seats needed: the fewest seats for which the expected number of working days above the threshold in the next 12 weeks is at most 2.',
    `Project demand: each team's attendance is forecast the same way; seats needed is the 80th percentile on its busiest weekday at peak presence. Pre-allocations here are simulated too.`,
    `The data is regenerated each day from a fixed seed (${data.seed}), so it is stable within a day.`,
  ].map((t) => `<li>${t}</li>`).join('');
}

// ---------- Page ----------
function renderAll() {
  if (!data) return;
  if (!data.series[scopeId]) scopeId = 'office';
  $('scope').value = scopeId;
  renderKpis(); renderCapChart(); renderDemand(); renderWhatIf(); renderHourChart(); renderHeat(); renderUtil(); renderRecs(); renderMethod();
}
$('scope').addEventListener('change', () => { scopeId = $('scope').value; store.set('hotdesk.insightsScope', scopeId); renderAll(); });
$('capMode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]'); if (!b) return;
  capMode = b.dataset.mode;
  for (const x of $('capMode').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  renderCapChart();
});
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (data) { renderCapChart(); renderHourChart(); renderUtil(); } }, 150); });

async function init() {
  $('back').href = withToken('/');
  try {
    const res = await fetch('/api/insights', { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (res.status === 401) throw Object.assign(new Error('An administrator token is needed. Open Insights from the dashboard.'), { auth: true });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    data = await res.json();
    $('scope').innerHTML = data.scopes.map((s) => `<option value="${esc(s.id)}">${esc(s.label)} (${s.seats} seats)</option>`).join('');
    $('period').textContent = `Simulated history ${fmtDate(data.historyFrom)} – ${fmtDate(data.generatedFor)} · forecast for the next 12 weeks.`;
    renderAll();
  } catch (e) {
    $('main').insertAdjacentHTML('beforeend', `<div class="card in-err">${esc(e.message)}</div>`);
  }
}
init();
