import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expandLayout } from '../src/occupancy.js';

// public/floorplan.js is a browser script; load it into a sandbox to test the layout.
const code = readFileSync(new URL('../public/floorplan.js', import.meta.url), 'utf8');
const sandbox = runInNewContext(`${code}\nFloorPlan`);
// Results cross a realm boundary: copy them so assert.deepEqual compares plain local objects.
const local = (fn) => (...args) => JSON.parse(JSON.stringify(fn(...args)));
const FloorPlan = { ...sandbox, layoutZone: local(sandbox.layoutZone), layoutFloor: local(sandbox.layoutFloor) };
const building = JSON.parse(readFileSync(new URL('../config/building.json', import.meta.url), 'utf8'));
const seats = expandLayout(building);
const zone = (f, z) => seats.filter((s) => s.floor === f && s.zone === z);

test('every seat is placed exactly once, inside its zone', () => {
  for (const floor of building.floors) {
    const fl = FloorPlan.layoutFloor(floor, seats, floor.plan);
    for (const z of fl.zones) {
      const ids = z.layout.seats.map((p) => p.id).sort();
      assert.deepEqual(ids, zone(floor.id, z.id).map((s) => s.id).sort());
      for (const p of z.layout.seats) {
        assert.ok(p.x >= 0 && p.y >= 0 && p.x + FloorPlan.CHAIR <= z.layout.w + 1e-6 && p.y + FloorPlan.CHAIR <= z.layout.h + 1e-6, `${p.id} inside its zone`);
      }
      assert.ok(z.ox >= z.box.x && z.ox + z.layout.w <= z.box.x + z.box.w + 1e-6, `${z.id} fits its box`);
    }
  }
});

test('desk banks become tables: pairs, benches and counters', () => {
  // Digital Factory: ".. .. .." x3, blank, x3 -> six 6-seat tables with chairs on both sides.
  const df = FloorPlan.layoutZone(zone('L1', 'DF'));
  assert.deepEqual(df.tables.map((t) => `${t.kind}:${t.seats}`), Array(6).fill('pair:6'));
  // Discussion Area: "...." is a 4-seat counter, then two 6-seat tables.
  const da = FloorPlan.layoutZone(zone('L1', 'DA'));
  assert.deepEqual(da.tables.map((t) => `${t.kind}:${t.seats}`).sort(), ['counter:4', 'pair:6', 'pair:6']);
  assert.ok(da.seats.filter((p) => p.side === 'bottom').length === 4, 'counter chairs face the counter');
  // AI Lab: ". .. .." x6 -> a 6-seat bench and two 12-seat tables.
  const ai = FloorPlan.layoutZone(zone('L1', 'AI'));
  assert.deepEqual(ai.tables.map((t) => `${t.kind}:${t.seats}`).sort(), ['pair:12', 'pair:12', 'single:6']);
});

test('chairs do not overlap each other or the tables', () => {
  const overlap = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
  for (const floor of building.floors) {
    for (const z of floor.zones) {
      const l = FloorPlan.layoutZone(zone(floor.id, z.id));
      const chairs = l.seats.map((p) => ({ x: p.x, y: p.y, w: FloorPlan.CHAIR, h: FloorPlan.CHAIR, id: p.id }));
      chairs.forEach((a, i) => chairs.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b), `${a.id} / ${b.id}`)));
      for (const c of chairs) for (const t of l.tables) assert.ok(!overlap(c, t), `${c.id} clear of a table`);
    }
  }
});

test('a floor without a plan still lays out its zones side by side', () => {
  const floor = building.floors.find((f) => f.id === 'L2');
  const fl = FloorPlan.layoutFloor(floor, seats, null);
  assert.equal(fl.plan, null);
  assert.ok(fl.w > 0 && fl.h > 0);
  const svg = FloorPlan.floorSVG(fl);
  assert.equal((svg.match(/class="seat"/g) ?? []).length, zone('L2', 'GO').length);
});
