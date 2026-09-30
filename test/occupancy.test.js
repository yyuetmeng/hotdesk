import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OccupancyEngine, Status, ConflictError, ValidationError, expandLayout } from '../src/occupancy.js';

const MIN = 60_000;
const building = {
  floors: [
    {
      id: 'L1',
      name: 'Level 1',
      zones: [
        { id: 'A', name: 'A', rows: 1, cols: 2 },
        { id: 'Q', name: 'Quiet', rows: 1, cols: 1, sensors: false },
      ],
    },
  ],
};

function setup(rules) {
  let now = Date.parse('2026-09-30T09:00:00Z');
  const clock = { now: () => now, advance: (m) => (now += m * MIN) };
  const engine = new OccupancyEngine({ seats: expandLayout(building), rules, clock: clock.now });
  const changes = [];
  engine.on('change', (s) => changes.push(s));
  return { engine, clock, changes };
}

const status = (engine, id) => engine.view(engine.getSeat(id)).status;

test('layout expansion assigns ids and sensors', () => {
  const seats = expandLayout(building);
  assert.deepEqual(seats.map((s) => [s.id, s.sensorId]), [
    ['L1-A-01', 'S-L1-A-01'],
    ['L1-A-02', 'S-L1-A-02'],
    ['L1-Q-01', null],
  ]);
});

test('map layouts: spaces are gaps, letters assign teams, "." is unassigned', () => {
  const seats = expandLayout({
    teams: { a: { name: 'Alpha', color: '#ff0000' } },
    floors: [{ id: 'L1', name: 'L1', zones: [{ id: 'Z', name: 'Z', map: ['aa .', '', ' a'] }] }],
  });
  assert.deepEqual(
    seats.map((s) => [s.id, s.row, s.col, s.team, s.teamName]),
    [
      ['L1-Z-01', 0, 0, 'a', 'Alpha'],
      ['L1-Z-02', 0, 1, 'a', 'Alpha'],
      ['L1-Z-03', 0, 3, null, null],
      ['L1-Z-04', 2, 1, 'a', 'Alpha'],
    ],
  );
  assert.throws(
    () => expandLayout({ floors: [{ id: 'L1', zones: [{ id: 'Z', map: ['x'] }] }] }),
    /unknown team code 'x'/,
  );
});

test('summary groups seats by team, unassigned last', () => {
  const layout = {
    teams: { a: { name: 'Alpha', color: '#ff0000' } },
    floors: [{ id: 'L1', name: 'L1', zones: [{ id: 'Z', name: 'Z', map: ['.a', 'a'] }] }],
  };
  const engine = new OccupancyEngine({ seats: expandLayout(layout) });
  engine.recordSensorEvent({ sensorId: 'S-L1-Z-02', presence: true });
  const teams = engine.summary().teams.map((t) => [t.id, t.total, t.occupied]);
  assert.deepEqual(teams, [['a', 2, 1], [null, 1, 0]]);
  assert.equal(engine.list({ team: 'a' }).length, 2);
});

test('sensor seat: never-seen sensor is offline, heartbeat makes it available', () => {
  const { engine } = setup();
  assert.equal(status(engine, 'L1-A-01'), Status.OFFLINE);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01' });
  assert.equal(status(engine, 'L1-A-01'), Status.AVAILABLE);
});

test('presence -> occupied; leaving -> away during grace -> available after grace', () => {
  const { engine, clock, changes } = setup({ awayGraceMinutes: 20 });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  assert.equal(status(engine, 'L1-A-01'), Status.OCCUPIED);

  clock.advance(60);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false });
  assert.equal(status(engine, 'L1-A-01'), Status.AWAY);
  const v = engine.view(engine.getSeat('L1-A-01'));
  assert.equal(v.holdExpiresAt, clock.now() + 20 * MIN);

  clock.advance(10);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false }); // heartbeat
  engine.sweep();
  assert.equal(status(engine, 'L1-A-01'), Status.AWAY);

  clock.advance(11);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false });
  engine.sweep();
  assert.equal(status(engine, 'L1-A-01'), Status.AVAILABLE);
  assert.deepEqual(
    changes.filter((c) => c.id === 'L1-A-01').map((c) => c.status),
    ['occupied', 'away', 'available'],
  );
});

test('returning within grace keeps the seat', () => {
  const { engine, clock } = setup();
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false });
  clock.advance(15);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  assert.equal(status(engine, 'L1-A-01'), Status.OCCUPIED);
});

test('checked-in user is auto-released after leaving for longer than the grace', () => {
  const { engine, clock } = setup({ awayGraceMinutes: 20 });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false });
  engine.checkIn('L1-A-01', 'alice');
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  clock.advance(120);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false });
  clock.advance(21);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01' });
  engine.sweep();
  const v = engine.view(engine.getSeat('L1-A-01'));
  assert.equal(v.status, Status.AVAILABLE);
  assert.equal(v.checkedInBy, null);
  assert.ok(engine.activity.some((a) => a.type === 'auto-release' && a.detail === 'alice'));
});

test('check-in on a sensor seat with no presence is released after the confirm window', () => {
  const { engine, clock } = setup({ checkinConfirmMinutes: 15 });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01' });
  engine.checkIn('L1-A-01', 'bob');
  assert.equal(status(engine, 'L1-A-01'), Status.OCCUPIED);
  clock.advance(14);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01' });
  engine.sweep();
  assert.equal(status(engine, 'L1-A-01'), Status.OCCUPIED);
  clock.advance(2);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01' });
  engine.sweep();
  assert.equal(status(engine, 'L1-A-01'), Status.AVAILABLE);
  assert.equal(engine.getSeat('L1-A-01').checkedInBy, null);
});

test('check-in lasts 3 hours by default, then expires; checkout frees immediately', () => {
  const { engine, clock } = setup();
  assert.equal(status(engine, 'L1-Q-01'), Status.AVAILABLE);
  const v = engine.checkIn('L1-Q-01', 'carol');
  assert.equal(v.checkedInUntil, clock.now() + 180 * MIN);
  assert.equal(v.holdExpiresAt, v.checkedInUntil);
  clock.advance(179);
  engine.sweep();
  assert.equal(status(engine, 'L1-Q-01'), Status.OCCUPIED);
  clock.advance(1);
  engine.sweep();
  assert.equal(status(engine, 'L1-Q-01'), Status.AVAILABLE);
  assert.equal(engine.getSeat('L1-Q-01').checkedInBy, null);
  assert.ok(engine.activity.some((a) => a.type === 'expired' && a.detail === 'carol'));

  engine.checkIn('L1-Q-01', 'carol');
  engine.checkOut('L1-Q-01', 'carol');
  assert.equal(status(engine, 'L1-Q-01'), Status.AVAILABLE);
});

test('user-chosen duration, renewal, and validation', () => {
  const { engine, clock } = setup();
  engine.checkIn('L1-Q-01', 'dora', { minutes: 60 });
  clock.advance(50);
  const renewed = engine.checkIn('L1-Q-01', 'dora'); // scan again: another 3 hours from now
  assert.equal(renewed.checkedInUntil, clock.now() + 180 * MIN);
  assert.ok(engine.activity.some((a) => a.type === 'renew'));
  clock.advance(100);
  engine.sweep();
  assert.equal(status(engine, 'L1-Q-01'), Status.OCCUPIED);

  for (const minutes of [0, 481, 1.5, NaN]) {
    assert.throws(() => engine.checkIn('L1-Q-01', 'dora', { minutes }), ValidationError);
  }
  assert.throws(() => engine.checkIn('L1-Q-01', ''), ValidationError);
});

test('on a sensor desk the check-in still expires after 3 hours, but presence keeps it occupied', () => {
  const { engine, clock } = setup();
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  engine.checkIn('L1-A-01', 'erik');
  clock.advance(181);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  engine.sweep();
  const v = engine.view(engine.getSeat('L1-A-01'));
  assert.equal(v.checkedInBy, null);
  assert.equal(v.status, Status.OCCUPIED);
  // The person has left: normal away grace then release.
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false });
  assert.equal(status(engine, 'L1-A-01'), Status.AWAY);
});

test('state saved before check-ins had an end time gets the default duration', () => {
  let now = Date.parse('2026-09-30T09:00:00Z');
  const engine = new OccupancyEngine({
    seats: expandLayout(building),
    state: { seats: { 'L1-Q-01': { checkedInBy: 'fay', checkedInAt: now - 60 * MIN } } },
    clock: () => now,
  });
  assert.equal(engine.getSeat('L1-Q-01').checkedInUntil, now + 120 * MIN);
  assert.equal(status(engine, 'L1-Q-01'), Status.OCCUPIED);
});

test('checkout on a sensor seat skips the away hold', () => {
  const { engine } = setup();
  engine.checkIn('L1-A-01', 'dan');
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false });
  assert.equal(status(engine, 'L1-A-01'), Status.AWAY);
  engine.checkOut('L1-A-01', 'dan');
  assert.equal(status(engine, 'L1-A-01'), Status.AVAILABLE);
});

test('cannot take a seat held by someone else; one seat per person', () => {
  const { engine } = setup();
  engine.checkIn('L1-Q-01', 'erin');
  assert.throws(() => engine.checkIn('L1-Q-01', 'frank'), ConflictError);
  assert.throws(() => engine.checkOut('L1-Q-01', 'frank'), ConflictError);

  engine.recordSensorEvent({ sensorId: 'S-L1-A-02' });
  engine.checkIn('L1-A-02', 'erin');
  assert.equal(engine.getSeat('L1-Q-01').checkedInBy, null);
  assert.equal(status(engine, 'L1-Q-01'), Status.AVAILABLE);
  assert.equal(engine.getSeat('L1-A-02').checkedInBy, 'erin');
});

test('sensor going silent falls back to check-in, else offline', () => {
  const { engine, clock } = setup({ sensorOfflineMinutes: 15 });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  clock.advance(16);
  assert.equal(status(engine, 'L1-A-01'), Status.OFFLINE);
  engine.checkIn('L1-A-01', 'gus');
  assert.equal(status(engine, 'L1-A-01'), Status.OCCUPIED);
});

test('out-of-order sensor events are ignored', () => {
  const { engine, clock } = setup();
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false, at: clock.now() - 5 * MIN });
  assert.equal(status(engine, 'L1-A-01'), Status.OCCUPIED);
});

test('summary, history sampling and snapshot round-trip', () => {
  const { engine, clock } = setup();
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-02' });
  engine.sweep();
  clock.advance(0.5);
  engine.sweep();
  clock.advance(1);
  engine.sweep();
  assert.equal(engine.history.length, 2);

  const s = engine.summary();
  assert.deepEqual(
    { total: s.overall.total, occupied: s.overall.occupied, available: s.overall.available },
    { total: 3, occupied: 1, available: 2 },
  );
  assert.equal(s.floors[0].zones.length, 2);

  const copy = new OccupancyEngine({ seats: expandLayout(building), state: engine.snapshot(), clock: clock.now });
  assert.equal(status(copy, 'L1-A-01'), Status.OCCUPIED);
  assert.equal(copy.history.length, 2);
});
