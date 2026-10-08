/*
 * Insights: a SIMULATED occupancy history and the forecasts built on it, for capacity and demand
 * planning (the /insights page). Deliberately separate from the live system: it reads only the
 * building layout (zones, seat counts, project names) and generates its own history, so nothing
 * here reflects, or touches, real check-ins.
 *
 * Simulation: 16 weeks of working days for the project teams (each with a size that grows over
 * time, a weekday attendance pattern, a home zone), with Singapore public and school holidays,
 * day-to-day noise and the occasional all-hands day. People fill their home zone first and
 * overflow to the zone with the most free seats; when every seat is taken, the rest is unmet demand.
 *
 * Model: per series (daily peak demand of a scope, or a project's attendance), a weekday index
 * times a linear trend, with school-holiday and public-holiday factors learned from the history.
 * Ranges come from the in-sample relative error, widening with the horizon; accuracy is measured
 * by refitting without the last four weeks and forecasting them (backtest MAPE).
 */
import { expandLayout } from './occupancy.js';

export const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const DAY = 86_400_000;
const WEEKS = 16, HORIZON_DAYS = 84, THRESHOLD = 0.9;

// Simulated calendar (approximate Singapore dates).
const PUBLIC_HOLIDAYS = {
  '2025-12-25': 'Christmas Day', '2026-01-01': "New Year's Day", '2026-02-17': 'Chinese New Year', '2026-02-18': 'Chinese New Year',
  '2026-03-21': 'Hari Raya Puasa', '2026-04-03': 'Good Friday', '2026-05-01': 'Labour Day', '2026-05-27': 'Hari Raya Haji',
  '2026-06-01': 'Vesak Day', '2026-08-10': 'National Day (observed)', '2026-11-09': 'Deepavali (observed)', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-02-08': 'Chinese New Year', '2027-02-09': 'Chinese New Year',
};
const SCHOOL_HOLIDAYS = [['2026-03-14', '2026-03-22'], ['2026-05-30', '2026-06-28'], ['2026-09-05', '2026-09-13'], ['2026-11-21', '2026-12-31'], ['2027-03-13', '2027-03-21']];

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const weekdayOf = (t) => new Date(t).getUTCDay(); // 0 Sun … 6 Sat
const isWeekday = (t) => { const w = weekdayOf(t); return w >= 1 && w <= 5; };
const holidayOf = (t) => PUBLIC_HOLIDAYS[iso(t)] ?? null;
const inSchoolHoliday = (t) => SCHOOL_HOLIDAYS.some(([a, b]) => iso(t) >= a && iso(t) <= b);
const round1 = (x) => Math.round(x * 10) / 10;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

/** A small seeded random generator, so the simulated history is the same every time. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const binomial = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (next() < p) k++; return k; };
  return { next, normal, binomial };
}

// Share of the day's attendees at their desk in each hour (8:00 … 19:00).
const PRESENCE = [0.3, 0.68, 0.88, 0.93, 0.78, 0.86, 0.92, 0.88, 0.72, 0.45, 0.2, 0.07];
const BASE_ATTENDANCE = [0, 0.56, 0.74, 0.8, 0.71, 0.43, 0]; // Sun … Sat
// Simulated teams: size at the start, monthly growth, extra attendance on anchor days.
// `alloc` is the share of the team's seats pre-allocated (simulated, not the live allocations).
const TEAM_PROFILE = {
  External: { size: 13, growth: 0, flat: 0.5, alloc: 0.45 },
  'Bolt On': { size: 19, growth: 0.015, alloc: 0.95 },
  eWorkplace: { size: 17, growth: 0.012, alloc: 0.6 },
  'G&C': { size: 16, growth: 0.015, alloc: 1.15 },
  STREAM: { size: 17, growth: 0.02, alloc: 0.55 },
  SAP: { size: 22, growth: 0.06, anchor: { 2: 0.12, 3: 0.12 }, alloc: 0.5 },
  ITGC: { size: 16, growth: 0.025, anchor: { 4: 0.1 }, alloc: 1.2 },
  DDAP: { size: 15, growth: 0.02, alloc: 0.65 },
};

/** Generate the simulated history. Uses only the layout: zones, seat counts and project names. */
export function simulate(building, { today = new Date(), seed = 20261008 } = {}) {
  const r = rng(seed);
  const seats = expandLayout(building);
  const zones = building.floors.flatMap((f) => f.zones.map((z) => ({
    id: `${f.id}-${z.id}`, floor: f.id, floorName: f.name, name: z.name,
    seats: seats.filter((s) => s.floor === f.id && s.zone === z.id).length,
  }))).filter((z) => z.seats);
  const names = (building.projectTeams ?? []).map((t) => (typeof t === 'string' ? t : t.name));
  const fallback = Object.values(TEAM_PROFILE);
  const projects = names.map((name, i) => ({ name, ...(TEAM_PROFILE[name] ?? fallback[i % fallback.length]) }));
  // Home zones: biggest teams first, each to the zone with the most room left for its usual peak.
  const room = new Map(zones.map((z) => [z.id, z.seats]));
  for (const p of [...projects].sort((a, b) => b.size - a.size)) {
    const z = [...room].sort((a, b) => b[1] - a[1])[0][0];
    p.home = z; room.set(z, room.get(z) - p.size * 0.7);
    p.allocated = Math.max(2, Math.round(p.size * (p.alloc ?? 0.6))); // simulated pre-allocation
  }

  const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()); // today, 00:00 UTC
  const start = end - WEEKS * 7 * DAY;
  const days = [];
  for (let t = start; t < end; t += DAY) {
    const wd = weekdayOf(t), months = (t - start) / (30.4 * DAY);
    const holiday = holidayOf(t), school = inSchoolHoliday(t);
    const allHands = isWeekday(t) && !holiday && r.next() < 0.03;
    const dayEffect = Math.max(0.7, 1 + 0.05 * r.normal()) * (allHands ? 1.18 : 1) * (school ? 0.92 : 1) * (holiday ? 0.07 : 1);
    const attendance = {};
    for (const p of projects) {
      const size = Math.round(p.size * (1 + p.growth) ** months);
      const prob = wd === 0 || wd === 6 ? 0.015 : (p.flat ?? BASE_ATTENDANCE[wd]) + (p.anchor?.[wd] ?? 0);
      attendance[p.name] = r.binomial(size, Math.min(0.97, prob * dayEffect));
    }
    // Hour by hour: home zone first, overflow to the zone with most free seats, the rest unmet.
    const occ = Object.fromEntries(zones.map((z) => [z.id, []]));
    const demand = Object.fromEntries(zones.map((z) => [z.id, []]));
    const unmet = [];
    HOURS.forEach((h, i) => {
      const free = new Map(zones.map((z) => [z.id, z.seats]));
      const want = new Map(zones.map((z) => [z.id, 0]));
      let lost = 0;
      for (const p of projects) {
        let n = Math.round(attendance[p.name] * Math.min(1, PRESENCE[i] * (1 + 0.04 * r.normal())));
        want.set(p.home, want.get(p.home) + n);
        const take = Math.min(n, free.get(p.home)); free.set(p.home, free.get(p.home) - take); n -= take;
        while (n > 0) {
          const [z, f] = [...free].sort((a, b) => b[1] - a[1])[0];
          if (f <= 0) { lost += n; break; }
          const t2 = Math.min(n, f); free.set(z, f - t2); n -= t2;
        }
      }
      for (const z of zones) { occ[z.id][i] = z.seats - free.get(z.id); demand[z.id][i] = want.get(z.id); }
      unmet[i] = lost;
    });
    days.push({ date: iso(t), t, weekday: wd, holiday, school, allHands, attendance, occ, demand, unmet });
  }
  return { zones, projects, days, start, end, seed };
}

// ---------- Forecasting ----------

/**
 * Fit weekday index × linear trend to a daily series (working days that are not public holidays),
 * with a learned school-holiday factor and public-holiday ratio.
 */
export function fit(points) {
  const work = points.filter((p) => isWeekday(p.t) && !p.holiday);
  const overall = mean(work.map((p) => p.y)) || 1;
  const recent = work.slice(-40);
  const index = {};
  for (let w = 1; w <= 5; w++) index[w] = (mean(recent.filter((p) => weekdayOf(p.t) === w).map((p) => p.y)) || overall) / (mean(recent.map((p) => p.y)) || 1);
  const deseason = (p) => p.y / (index[weekdayOf(p.t)] || 1);
  const normal = work.filter((p) => !p.school), school = work.filter((p) => p.school);
  const schoolFactor = school.length >= 3 && normal.length ? Math.min(1.1, Math.max(0.75, mean(school.map(deseason)) / mean(normal.slice(-school.length * 2).map(deseason)))) : 1;
  // Least squares on deseasonalised values (school days scaled back up).
  const xs = work.map((p) => p.t / DAY), ys = work.map((p) => deseason(p) / (p.school ? schoolFactor : 1));
  const mx = mean(xs), my = mean(ys);
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / (xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1);
  const a = my - b * mx;
  const holidays = points.filter((p) => p.holiday && isWeekday(p.t));
  const holidayRatio = holidays.length ? Math.min(0.5, mean(holidays.map((p) => p.y)) / overall) : 0.08;
  const weekend = mean(points.filter((p) => !isWeekday(p.t)).map((p) => p.y));
  const lastT = points.at(-1)?.t ?? 0;
  const model = { a, b, index, schoolFactor, holidayRatio, weekend, lastT, relSd: 0 };
  const rel = work.slice(-40).map((p) => p.y / Math.max(1e-6, predictMean(model, p.t)) - 1);
  model.relSd = Math.max(0.03, sd(rel));
  return model;
}
function predictMean(m, t) {
  if (!isWeekday(t)) return m.weekend;
  const base = Math.max(0, (m.a + m.b * (t / DAY)) * (m.index[weekdayOf(t)] || 1) * (inSchoolHoliday(t) ? m.schoolFactor : 1));
  return holidayOf(t) ? base * m.holidayRatio : base;
}
/** Forecast with a P10–P90 range that widens with the horizon. */
export function predict(m, t) {
  const mu = predictMean(m, t);
  const h = Math.max(0, (t - m.lastT) / DAY);
  const s = mu * m.relSd * Math.sqrt(1 + h / 30);
  return { mean: mu, sd: s, p10: Math.max(0, mu - 1.2816 * s), p90: mu + 1.2816 * s };
}
/** Mean absolute percentage error of forecasting the last `days` days from the history before them. */
export function backtest(points, days = 28) {
  const cut = points.at(-1).t - days * DAY;
  const m = fit(points.filter((p) => p.t <= cut));
  const test = points.filter((p) => p.t > cut && isWeekday(p.t) && !p.holiday && p.y > 0);
  return test.length ? mean(test.map((p) => Math.abs(predict(m, p.t).mean - p.y) / p.y)) : null;
}

// Normal distribution helpers for "chance over a threshold" and expected shortfall.
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152073) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

// ---------- What the page needs ----------

/** Simulate, model and summarise everything the Insights page shows. */
export function buildInsights(building, { today = new Date(), seed } = {}) {
  const sim = simulate(building, { today, seed });
  const { zones, projects, days } = sim;
  const floors = [...new Map(zones.map((z) => [z.floor, z.floorName]))].map(([id, name]) => ({ id, name }));
  const scopes = [
    { id: 'office', label: 'Whole office', zones: zones.map((z) => z.id) },
    ...floors.map((f) => ({ id: f.id, label: f.name, zones: zones.filter((z) => z.floor === f.id).map((z) => z.id) })),
    ...zones.map((z) => ({ id: z.id, label: `${z.floorName} · ${z.name}`, zones: [z.id] })),
  ].map((s) => ({ ...s, seats: s.zones.reduce((n, id) => n + zones.find((z) => z.id === id).seats, 0) }));

  const futureDays = [];
  for (let t = sim.end; t < sim.end + HORIZON_DAYS * DAY; t += DAY) futureDays.push({ t, date: iso(t), weekday: weekdayOf(t), holiday: holidayOf(t), school: inSchoolHoliday(t) });
  const last8 = days.slice(-56).filter((d) => isWeekday(d.t) && !d.holiday);

  const out = {};
  for (const s of scopes) {
    // Hourly demand of the scope: people wanting a seat there (the office also counts those turned away).
    const hourly = (d) => HOURS.map((_, i) => s.zones.reduce((n, z) => n + d.demand[z][i], 0));
    const seated = (d) => HOURS.map((_, i) => s.zones.reduce((n, z) => n + d.occ[z][i], 0));
    const points = days.map((d) => ({ t: d.t, holiday: d.holiday, school: d.school, y: Math.max(...hourly(d)) }));
    const model = fit(points);
    const forecast = futureDays.map((d) => ({ date: d.date, holiday: d.holiday, ...roundAll(predict(model, d.t)) }));
    // Hourly shape per weekday (share of the day's peak), from the last eight weeks.
    const shape = {};
    for (let w = 1; w <= 5; w++) {
      const ds = last8.filter((d) => d.weekday === w);
      shape[w] = HOURS.map((_, i) => round1(100 * mean(ds.map((d) => { const h = hourly(d); return h[i] / (Math.max(...h) || 1); }))) / 100);
    }
    const heat = {};
    for (let w = 1; w <= 5; w++) {
      const ds = last8.filter((d) => d.weekday === w);
      heat[w] = HOURS.map((_, i) => round1(100 * mean(ds.map((d) => seated(d)[i])) / s.seats));
    }
    // Utilisation: seat-hours used / available, last four weeks and forecast next four.
    const recentWork = days.slice(-28).filter((d) => isWeekday(d.t) && !d.holiday);
    const used = recentWork.reduce((n, d) => n + seated(d).reduce((a, b) => a + b, 0), 0);
    const utilPast = used / (s.seats * HOURS.length * (recentWork.length || 1));
    const next4 = futureDays.slice(0, 28).filter((d) => isWeekday(d.t));
    const utilNext = mean(next4.map((d) => { const f = predict(model, d.t).mean; return mean(shape[d.weekday].map((x) => Math.min(s.seats, x * f))) / s.seats; }));
    out[s.id] = {
      ...s,
      history: days.map((d) => ({ date: d.date, holiday: d.holiday, peak: Math.max(...hourly(d)), seatedPeak: Math.max(...seated(d)), unmet: s.id === 'office' ? Math.max(...d.unmet) : undefined })),
      forecast, shape, heat,
      hourly7: futureDays.slice(0, 7).filter((d) => isWeekday(d.t)).map((d) => {
        const f = predict(model, d.t);
        return { date: d.date, holiday: d.holiday, hours: shape[d.weekday].map((x) => ({ mean: round1(x * f.mean), p10: round1(x * f.p10), p90: round1(x * f.p90) })) };
      }),
      utilisation: { past: round1(100 * utilPast), next: round1(100 * utilNext) },
      model: { trendPerMonth: round1(100 * (model.b * 30.4) / (model.a + model.b * (sim.end / DAY) || 1)), relSd: round1(100 * model.relSd), mape: round1(100 * (backtest(points) ?? 0)) },
      capacity: capacityOutlook(forecast, s.seats),
    };
  }

  // Demand per project: attendance forecast for the next four weeks; seats needed = P80 of the busiest weekday at peak presence.
  const peakPresence = Math.max(...PRESENCE);
  const demand = projects.map((p) => {
    const points = days.map((d) => ({ t: d.t, holiday: d.holiday, school: d.school, y: d.attendance[p.name] }));
    const m = fit(points);
    const byDay = {};
    for (let w = 1; w <= 5; w++) {
      const ts = futureDays.slice(0, 28).filter((d) => d.weekday === w && !d.holiday).map((d) => predict(m, d.t));
      byDay[w] = { mean: round1(mean(ts.map((x) => x.mean)) * peakPresence), p80: round1(mean(ts.map((x) => x.mean + 0.8416 * x.sd)) * peakPresence) };
    }
    const busiest = Object.entries(byDay).sort((a, b) => b[1].p80 - a[1].p80)[0];
    const needed = Math.ceil(busiest[1].p80);
    const recent = days.slice(-28).filter((d) => isWeekday(d.t) && !d.holiday);
    return {
      name: p.name, home: p.home, allocated: p.allocated, teamSize: Math.round(p.size * (1 + p.growth) ** (WEEKS * 7 / 30.4)),
      growthPerMonth: round1(p.growth * 100),
      attendedRecent: round1(mean(recent.map((d) => d.attendance[p.name])) * peakPresence),
      byDay, busiestDay: Number(busiest[0]), needed, gap: needed - p.allocated,
    };
  });

  const office = out.office;
  return {
    simulated: true,
    note: 'Simulated data for planning demos. Not actual usage; not linked to live check-ins.',
    generatedFor: iso(sim.end), seed: sim.seed, hours: HOURS, threshold: THRESHOLD,
    historyFrom: iso(sim.start), horizonDays: HORIZON_DAYS,
    scopes: scopes.map(({ id, label, seats }) => ({ id, label, seats })),
    zones: zones.map(({ id, name, floorName, seats }) => ({ id, name, floorName, seats })),
    series: out, demand,
    recommendations: recommend(out, demand, zones),
    totals: { teamSize: demand.reduce((n, d) => n + d.teamSize, 0), seats: office.seats },
  };
}

function roundAll(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round1(v)])); }

/** When the busiest days pass the threshold, and what capacity keeps the next 12 weeks under it. */
export function capacityOutlook(forecast, seats, threshold = THRESHOLD) {
  const work = forecast.filter((f) => !f.holiday && f.mean > 0.05 * seats);
  const over = (cap) => work.reduce((n, f) => n + (1 - normCdf((threshold * cap - f.mean) / (f.sd || 1))), 0);
  const first = work.find((f) => f.mean > threshold * seats) ?? null;
  const firstLikely = work.find((f) => 1 - normCdf((threshold * seats - f.mean) / (f.sd || 1)) > 0.5) ?? null;
  let recommended = seats;
  while (over(recommended) > 2 && recommended < seats * 3) recommended++;
  const peak = work.reduce((best, f) => (f.p90 > (best?.p90 ?? -1) ? f : best), null);
  return {
    daysOverThreshold: round1(over(seats)), firstOver: first?.date ?? null, firstLikelyOver: firstLikely?.date ?? null,
    recommendedSeats: recommended, peak: peak && { date: peak.date, mean: peak.mean, p90: peak.p90 },
  };
}

/** "Wed 4 Nov" from "2026-11-04". */
const nice = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');

function recommend(series, demand, zones) {
  const recs = [];
  const office = series.office, cap = office.capacity;
  if (cap.firstOver) recs.push({ kind: 'capacity', level: 'high', text: `Peak demand is forecast to pass ${Math.round(THRESHOLD * 100)}% of the office's ${office.seats} seats from ${nice(cap.firstOver)}. Plan about ${cap.recommendedSeats} seats (+${cap.recommendedSeats - office.seats}) to keep the next 12 weeks under ${Math.round(THRESHOLD * 100)}% on all but ~2 days, or spread attendance across the week.` });
  else if (cap.daysOverThreshold >= 1) recs.push({ kind: 'capacity', level: 'medium', text: `About ${Math.round(cap.daysOverThreshold)} busy days in the next 12 weeks may pass ${Math.round(THRESHOLD * 100)}% of seats. ${cap.recommendedSeats > office.seats ? `${cap.recommendedSeats} seats would avoid most of them.` : ''}` });
  for (const d of [...demand].sort((a, b) => b.gap - a.gap)) {
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.busiestDay];
    if (d.gap >= 2) recs.push({ kind: 'project', level: 'medium', project: d.name, text: `${d.name} needs about ${d.needed} seats on ${day}s (P80) but has ${d.allocated} pre-allocated: add ${d.gap}.` });
    else if (d.gap <= -3) recs.push({ kind: 'project', level: 'low', project: d.name, text: `${d.name} uses at most ~${d.needed} of its ${d.allocated} pre-allocated seats (P80, ${day}): ${-d.gap} could be released to others.` });
  }
  for (const z of zones) {
    const s = series[z.id];
    if (s.utilisation.past < 35) recs.push({ kind: 'zone', level: 'low', text: `${s.label} averages ${s.utilisation.past}% utilisation; consider opening it to other teams or consolidating.` });
    if (s.capacity.firstOver) recs.push({ kind: 'zone', level: 'medium', text: `${s.label} is forecast to run over ${Math.round(THRESHOLD * 100)}% from ${nice(s.capacity.firstOver)}; overflow will move to other zones.` });
  }
  const fri = office.heat[5], wed = office.heat[3];
  if (fri && wed && Math.max(...fri) < 0.65 * Math.max(...wed)) recs.push({ kind: 'pattern', level: 'low', text: `Fridays peak at ${Math.round(Math.max(...fri))}% vs ${Math.round(Math.max(...wed))}% on Wednesdays: moving some team days to Friday would ease the mid-week peak.` });
  return recs;
}
