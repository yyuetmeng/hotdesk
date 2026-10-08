import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OccupancyEngine, expandLayout, Status } from '../src/occupancy.js';

const MIN = 60_000;
const building = { floors: [{ id: 'L1', name: 'Level 1', zones: [{ id: 'A', name: 'A', rows: 1, cols: 4 }] }] };
const day = (offset = 0) => { const d = new Date(2026, 9, 7 + offset, 12); return d.toLocaleDateString('en-CA'); };

/** An engine whose clock starts at a local time on Wed 7 Oct 2026 (slots are in local time). */
function setup(h = 7, m = 0) {
  let now = new Date(2026, 9, 7, h, m).getTime();
  const clock = { now: () => now, at: (hh, mm = 0, d = 0) => { now = new Date(2026, 9, 7 + d, hh, mm).getTime(); }, advance: (mins) => { now += mins * MIN; } };
  const engine = new OccupancyEngine({ seats: expandLayout(building), clock: clock.now });
  const status = (id) => engine.view(engine.getSeat(id)).status;
  return { engine, clock, status };
}

test('a reservation holds the desk from 15 minutes before its slot; checking in confirms it', () => {
  const { engine, clock, status } = setup(7, 0);
  const [r] = engine.reserve(['L1-A-01'], 'Ana', { team: 'SAP', date: day(), slot: 'am' });
  assert.equal(r.slotLabel, 'Morning');
  assert.equal(status('L1-A-01'), Status.AVAILABLE); // window opens at 7:45
  assert.equal(engine.view(engine.getSeat('L1-A-01')).reservation.id, r.id);
  clock.at(7, 50); engine.sweep();
  assert.equal(status('L1-A-01'), Status.RESERVED);
  // Someone else can't take it while it waits for Ana.
  assert.throws(() => engine.checkIn('L1-A-01', 'Ben', { team: 'SAP' }), /reserved/);
  const seat = engine.checkIn('L1-A-01', 'ana', { team: 'SAP' }); // names match case-insensitively
  assert.equal(seat.status, Status.OCCUPIED);
  assert.equal(seat.checkedInUntil, r.end); // held to the end of the slot
  assert.equal(engine.listReservations({ user: 'Ana' })[0].status, 'checked-in');
});

test('no check-in by 30 minutes after the start: a no-show, and the desk is free again', () => {
  const { engine, clock, status } = setup(7, 0);
  engine.reserve(['L1-A-02'], 'Ana', { team: 'SAP', date: day(), slot: 'am' });
  clock.at(8, 29); engine.sweep();
  assert.equal(status('L1-A-02'), Status.RESERVED);
  clock.at(8, 30); engine.sweep();
  assert.equal(status('L1-A-02'), Status.AVAILABLE);
  assert.equal(engine.listReservations({ user: 'Ana' })[0].status, 'no-show');
  assert.equal(engine.counts().reserved, 0);
});

test('walk-ins can use a desk until a later reservation; the slot, day and person limits apply', () => {
  const { engine, clock } = setup(9, 0);
  engine.reserve(['L1-A-03'], 'Ana', { team: 'SAP', date: day(), slot: 'pm' });
  const walkIn = engine.checkIn('L1-A-03', 'Ben', { team: 'SAP', minutes: 480 });
  assert.equal(walkIn.checkedInUntil, new Date(2026, 9, 7, 12, 45).getTime()); // until the window opens
  // One desk per person per slot; the full day overlaps the afternoon.
  assert.throws(() => engine.reserve(['L1-A-04'], 'ANA', { team: 'SAP', date: day(), slot: 'day' }), /already have/);
  // Only today and tomorrow.
  assert.throws(() => engine.reserve(['L1-A-04'], 'Cat', { team: 'SAP', date: day(2), slot: 'am' }), /today or tomorrow/);
  assert.throws(() => engine.reserve(['L1-A-04'], 'Cat', { team: 'SAP', date: day(1), slot: 'noon' }), /Unknown slot/);
  // A slot that is nearly over can't be booked.
  clock.at(12, 30);
  assert.throws(() => engine.reserve(['L1-A-04'], 'Cat', { team: 'SAP', date: day(), slot: 'am' }), /over/);
  // Double booking the same desk and slot.
  engine.reserve(['L1-A-04'], 'Cat', { team: 'SAP', date: day(1), slot: 'am' });
  assert.throws(() => engine.reserve(['L1-A-04'], 'Dan', { team: 'SAP', date: day(1), slot: 'day' }), /Already reserved/);
  assert.equal(engine.slotAvailability(day(1), 'pm')['L1-A-04'].state, 'free');
  assert.equal(engine.slotAvailability(day(1), 'am')['L1-A-04'].state, 'reserved');
});

test('at most 5 reservations a week per person; cancelling frees the desk and the quota', () => {
  const { engine, clock } = setup(7, 0);
  clock.at(7, 0, -2); // Monday 5 Oct
  const r = (d, slot, seat) => engine.reserve([seat], 'Ana', { team: 'SAP', date: day(d), slot })[0];
  const mon = r(-2, 'am', 'L1-A-01'); r(-2, 'pm', 'L1-A-02'); r(-1, 'am', 'L1-A-01'); r(-1, 'pm', 'L1-A-02');
  clock.at(7, 0, -1); engine.sweep(); // Tuesday: Monday's were no-shows, and still count
  r(0, 'am', 'L1-A-03'); // the fifth this week
  assert.throws(() => r(0, 'pm', 'L1-A-04'), /at most 5/);
  // Cancelling one that hasn't started frees a place in the quota.
  const tue = engine.listReservations({ user: 'Ana', date: day(-1) }).find((x) => x.slot === 'pm');
  assert.throws(() => engine.cancelReservation(tue.id, 'Ben'), /Only the person/);
  engine.cancelReservation(tue.id, 'ana');
  assert.throws(() => engine.cancelReservation(tue.id, 'Ana'), /already cancelled/);
  assert.throws(() => engine.cancelReservation(mon.id, 'Ana'), /no-show/);
  r(0, 'pm', 'L1-A-04');
});

test('a team reservation: several desks, confirmed by anyone in that project', () => {
  const { engine, clock, status } = setup(7, 0);
  const rs = engine.reserve(['L1-A-01', 'L1-A-02'], 'Lead', { team: 'SAP', date: day(), slot: 'am', forTeam: true });
  assert.equal(rs.length, 2);
  assert.throws(() => engine.reserve(['L1-A-03', 'L1-A-04'], 'Ana', { team: 'SAP', date: day(), slot: 'am' }), /one desk/);
  clock.at(8, 0); engine.sweep();
  assert.throws(() => engine.checkIn('L1-A-01', 'Zed', { team: 'ITGC' }), /reserved/);
  engine.checkIn('L1-A-01', 'Mei', { team: 'SAP' });
  assert.equal(status('L1-A-01'), Status.OCCUPIED);
  assert.equal(status('L1-A-02'), Status.RESERVED);
  // The people list shows the person who is expected.
  assert.deepEqual(engine.peopleIn().map((p) => [p.name, p.status]).sort(), [['Lead', 'reserved'], ['Mei', 'onsite']]);
});

test('reservations survive a restart', () => {
  const { engine } = setup(7, 0);
  engine.reserve(['L1-A-01'], 'Ana', { team: 'SAP', date: day(1), slot: 'day' });
  const copy = new OccupancyEngine({ seats: expandLayout(building), state: engine.snapshot(), clock: engine.clock });
  assert.equal(copy.listReservations({ user: 'Ana' }).length, 1);
});
