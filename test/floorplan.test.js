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

test('a floor without a plan gets its zones inside a generic office shell', () => {
  const floor = building.floors.find((f) => f.id === 'L2');
  const fl = FloorPlan.layoutFloor(floor, seats, null);
  assert.equal(fl.plan.generic, true);
  for (const z of fl.zones) assert.ok(z.box.x > 0 && z.box.y > 0 && z.box.x + z.box.w < fl.w && z.box.y + z.box.h < fl.h, `${z.id} inside the walls`);
  assert.ok(fl.w > 0 && fl.h > 0);
  const svg = FloorPlan.floorSVG(fl);
  assert.equal((svg.match(/class="seat"/g) ?? []).length, zone('L2', 'GO').length);
});

test('floor plans: stairs on both floors, Level 2 toilets in a corner cut out of the office zone', () => {
  const draw = (id) => {
    const floor = building.floors.find((f) => f.id === id);
    const fl = FloorPlan.layoutFloor(floor, seats, floor.plan);
    return { floor, fl, svg: FloorPlan.floorSVG(fl) };
  };
  const l1 = draw('L1');
  assert.equal((l1.svg.match(/class="seat"/g) ?? []).length, 82);
  assert.match(l1.svg, /fp-room-stairs/);
  assert.doesNotMatch(l1.svg, /fp-room-wc|fp-room-pantry|fp-room-lift/);
  // The stairs sit between the Discussion Area and the AI Lab.
  const stairs = l1.floor.plan.rooms.find((r) => r.kind === 'stairs');
  const box = (id) => l1.fl.zones.find((z) => z.id === id).box;
  assert.ok(stairs.x >= box('DA').x + box('DA').w && stairs.x + stairs.w <= box('AI').x);

  const l2 = draw('L2');
  assert.equal(l2.fl.plan.generic, undefined);
  assert.equal((l2.svg.match(/class="seat"/g) ?? []).length, 43);
  assert.equal((l2.svg.match(/fp-room-wc/g) ?? []).length, 2);
  assert.match(l2.svg, /fp-room-stairs/);
  assert.match(l2.svg, /<path class="fp-zone-area" d="M/); // L-shaped zone
  // No desk or chair lies inside the cut-out where the toilets are.
  const go = l2.fl.zones[0], cut = go.box.cut;
  for (const p of go.layout.seats) {
    const x = p.x + go.ox, y = p.y + go.oy;
    const inside = x + FloorPlan.CHAIR > cut.x && x < cut.x + cut.w && y + FloorPlan.CHAIR > cut.y && y < cut.y + cut.h;
    assert.ok(!inside, `${p.id} outside the toilets`);
  }
});
