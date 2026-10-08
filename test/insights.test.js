import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildInsights, simulate, fit, predict, backtest } from '../src/insights.js';
import { OccupancyEngine, expandLayout } from '../src/occupancy.js';
import { createApp } from '../src/server.js';

const building = JSON.parse(readFileSync(new URL('../config/building.json', import.meta.url), 'utf8'));
const today = new Date('2026-10-08T09:00:00');

test('the simulated history is deterministic and respects the building', () => {
  const a = simulate(building, { today }), b = simulate(building, { today });
  assert.deepEqual(a.days.map((d) => d.attendance), b.days.map((d) => d.attendance));
  assert.equal(a.days.length, 16 * 7);
  assert.equal(a.zones.reduce((n, z) => n + z.seats, 0), expandLayout(building).length);
  for (const d of a.days) {
    for (const z of a.zones) assert.ok(d.occ[z.id].every((n) => n >= 0 && n <= z.seats), 'never more people seated than seats');
  }
  // Weekends and public holidays are quiet.
  const quiet = a.days.filter((d) => d.weekday === 0 || d.weekday === 6 || d.holiday);
  assert.ok(quiet.every((d) => Object.values(d.attendance).reduce((n, x) => n + x, 0) < 25));
});

test('the model recovers a weekday pattern and trend, with ranges and a backtest', () => {
  const DAY = 86_400_000, t0 = Date.UTC(2026, 0, 5);
  const points = Array.from({ length: 112 }, (_, i) => {
    const t = t0 + i * DAY, w = new Date(t).getUTCDay();
    return { t, holiday: null, school: false, y: w === 0 || w === 6 ? 0 : (100 + i * 0.2) * [0, 0.7, 1, 1.1, 0.9, 0.5, 0][w] };
  });
  const m = fit(points);
  const wed = Date.UTC(2026, 4, 13); // a Wednesday after the history
  const p = predict(m, wed);
  const expect = (100 + (wed - t0) / DAY * 0.2) * 1.1;
  assert.ok(Math.abs(p.mean - expect) / expect < 0.05, `forecast ${p.mean} close to ${expect}`);
  assert.ok(p.p10 <= p.mean && p.mean <= p.p90);
  assert.ok(backtest(points) < 0.05);
});

test('insights: simulated, capacity outlook and project demand', () => {
  const r = buildInsights(building, { today });
  assert.equal(r.simulated, true);
  assert.match(r.note, /Simulated/);
  const office = r.series.office;
  assert.equal(office.seats, 125);
  assert.equal(office.forecast.length, 84);
  assert.ok(office.model.mape > 0 && office.model.mape < 20, `backtest error ${office.model.mape}%`);
  if (office.capacity.firstOver) assert.ok(office.capacity.recommendedSeats > office.seats);
  assert.equal(r.demand.length, building.projectTeams.length);
  for (const d of r.demand) assert.equal(d.gap, d.needed - d.allocated);
  assert.ok(r.recommendations.length > 0);
});

test('the insights API is admin-only and ignores the live data', async () => {
  const engine = new OccupancyEngine({ seats: expandLayout(building) });
  const app = createApp({ engine, publicDir: resolve(import.meta.dirname, '../public'), adminToken: 'admin', building });
  await new Promise((r2) => app.listen(0, r2));
  const url = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(`${url}/insights`)).status, 200);
  assert.equal((await fetch(`${url}/api/insights`)).status, 401);
  const before = await (await fetch(`${url}/api/insights?token=admin`)).json();
  engine.checkIn('L1-DF-01', 'Somebody', { team: 'SAP' }); // live activity changes nothing here
  const after = await (await fetch(`${url}/api/insights?token=admin`)).json();
  assert.equal(before.simulated, true);
  assert.deepEqual(after.series.office.history, before.series.office.history);
  app.close();
});
