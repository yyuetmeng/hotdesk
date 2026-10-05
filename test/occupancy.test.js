import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OccupancyEngine, Status, ConflictError, NotFoundError, ValidationError, expandLayout } from '../src/occupancy.js';

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

test('placeholder sensor id counts once it reports; a linked sensor that never reports is offline', () => {
  const { engine } = setup();
  // No hardware yet: the desk works as a QR-only desk rather than showing "offline".
  assert.equal(status(engine, 'L1-A-01'), Status.AVAILABLE);
  assert.equal(engine.view(engine.getSeat('L1-A-01')).hasSensor, false);
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01' }); // a device named after the desk reports
  assert.equal(engine.view(engine.getSeat('L1-A-01')).hasSensor, true);
  assert.equal(status(engine, 'L1-A-01'), Status.AVAILABLE);

  engine.linkSensor('L1-A-02', '24E124136B316941');
  assert.equal(status(engine, 'L1-A-02'), Status.OFFLINE, 'installed but not reporting yet');
  engine.recordSensorEvent({ sensorId: '24E124136B316941' });
  assert.equal(status(engine, 'L1-A-02'), Status.AVAILABLE);
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
  engine.checkIn('L1-A-01', 'alice', { team: 'SAP' });
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
  engine.checkIn('L1-A-01', 'bob', { team: 'SAP' });
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
  const v = engine.checkIn('L1-Q-01', 'carol', { team: 'SAP' });
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

  engine.checkIn('L1-Q-01', 'carol', { team: 'SAP' });
  engine.checkOut('L1-Q-01', 'carol', { team: 'SAP' });
  assert.equal(status(engine, 'L1-Q-01'), Status.AVAILABLE);
});

test('user-chosen duration, renewal, and validation', () => {
  const { engine, clock } = setup();
  engine.checkIn('L1-Q-01', 'dora', { minutes: 60, team: 'SAP' });
  clock.advance(50);
  const renewed = engine.checkIn('L1-Q-01', 'dora', { team: 'SAP' }); // scan again: another 3 hours from now
  assert.equal(renewed.checkedInUntil, clock.now() + 180 * MIN);
  assert.ok(engine.activity.some((a) => a.type === 'renew'));
  clock.advance(100);
  engine.sweep();
  assert.equal(status(engine, 'L1-Q-01'), Status.OCCUPIED);

  for (const minutes of [0, 481, 1.5, NaN]) {
    assert.throws(() => engine.checkIn('L1-Q-01', 'dora', { minutes, team: 'SAP' }), ValidationError);
  }
  assert.throws(() => engine.checkIn('L1-Q-01', ''), ValidationError);
});

test('on a sensor desk the check-in still expires after 3 hours, but presence keeps it occupied', () => {
  const { engine, clock } = setup();
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  engine.checkIn('L1-A-01', 'erik', { team: 'SAP' });
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
  engine.checkIn('L1-A-01', 'dan', { team: 'SAP' });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: false });
  assert.equal(status(engine, 'L1-A-01'), Status.AWAY);
  engine.checkOut('L1-A-01', 'dan', { team: 'SAP' });
  assert.equal(status(engine, 'L1-A-01'), Status.AVAILABLE);
});

test('cannot take a seat held by someone else; one seat per person', () => {
  const { engine } = setup();
  engine.checkIn('L1-Q-01', 'erin', { team: 'SAP' });
  assert.throws(() => engine.checkIn('L1-Q-01', 'frank', { team: 'SAP' }), ConflictError);
  assert.throws(() => engine.checkOut('L1-Q-01', 'frank', { team: 'SAP' }), ConflictError);

  engine.recordSensorEvent({ sensorId: 'S-L1-A-02' });
  engine.checkIn('L1-A-02', 'erin', { team: 'SAP' });
  assert.equal(engine.getSeat('L1-Q-01').checkedInBy, null);
  assert.equal(status(engine, 'L1-Q-01'), Status.AVAILABLE);
  assert.equal(engine.getSeat('L1-A-02').checkedInBy, 'erin');
});

test('sensor going silent falls back to check-in, else offline', () => {
  const { engine, clock } = setup({ sensorOfflineMinutes: 15 });
  engine.recordSensorEvent({ sensorId: 'S-L1-A-01', presence: true });
  clock.advance(16);
  assert.equal(status(engine, 'L1-A-01'), Status.OFFLINE);
  engine.checkIn('L1-A-01', 'gus', { team: 'SAP' });
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

test('linking a real sensor to a desk, moving it, and unlinking', () => {
  const { engine, clock } = setup();
  // A sensor that isn't linked yet is remembered so an admin can link it.
  assert.throws(() => engine.recordSensorEvent({ sensorId: '24e124136b316941', presence: true, name: 'desk-1' }), NotFoundError);
  assert.deepEqual([...engine.unlinked.keys()], ['24E124136B316941']);
  assert.equal(engine.sensorReport().unlinked[0].name, 'desk-1');

  engine.linkSensor('L1-A-01', '24e124136b316941');
  assert.equal(engine.unlinked.size, 0);
  assert.equal(engine.isLinked('S-L1-A-01'), false, 'placeholder id replaced');
  engine.recordSensorEvent({ sensorId: '24E124136B316941', presence: true });
  assert.equal(status(engine, 'L1-A-01'), Status.OCCUPIED);

  // Moving the sensor to another desk clears the old desk's readings.
  engine.linkSensor('L1-A-02', '24E124136B316941');
  assert.equal(engine.getSeat('L1-A-01').sensorId, null);
  assert.equal(status(engine, 'L1-A-01'), Status.AVAILABLE, 'no sensor: follows check-ins');
  assert.equal(status(engine, 'L1-A-02'), Status.OFFLINE, 'waiting for first reading from the moved sensor');

  engine.linkSensor('L1-A-02', null);
  assert.equal(engine.isLinked('24E124136B316941'), false);
  assert.ok(engine.activity.some((a) => a.type === 'sensor' && /linked 24E1/.test(a.detail)));

  // Links survive a restart.
  const copy = new OccupancyEngine({ seats: expandLayout(building), state: engine.snapshot(), clock: clock.now });
  assert.equal(copy.getSeat('L1-A-01').sensorId, null);
  assert.equal(copy.getSeat('L1-A-02').sensorId, null);
  assert.equal(copy.getSeat('L1-Q-01').sensorId, null);
});


test('project team is required on check-in and check-out and must be one of the list', () => {
  const { engine } = setup();
  assert.throws(() => engine.checkIn('L1-Q-01', 'hana'), /Project team is required/);
  assert.throws(() => engine.checkIn('L1-Q-01', 'hana', { team: 'Marketing' }), /Unknown project team "Marketing"/);
  const v = engine.checkIn('L1-Q-01', 'hana', { team: 'g&c' }); // case-insensitive, stored canonically
  assert.equal(v.projectTeam, 'G&C');
  assert.throws(() => engine.checkOut('L1-Q-01', 'hana'), ValidationError);
  assert.equal(engine.getSeat('L1-Q-01').checkedInBy, 'hana', 'a rejected check-out keeps the desk');
  engine.checkOut('L1-Q-01', 'hana', { team: 'G&C' });
  assert.equal(engine.getSeat('L1-Q-01').checkedInBy, null);
  const log = engine.activity.filter((a) => a.type === 'checkin' || a.type === 'checkout');
  assert.deepEqual(log.map((a) => [a.type, a.detail, a.team]), [['checkin', 'hana', 'G&C'], ['checkout', 'hana', 'G&C']]);
});

test('custom project team list', () => {
  const engine = new OccupancyEngine({ seats: expandLayout(building), projectTeams: ['Alpha', ' Beta ', 'Alpha'] });
  assert.deepEqual(engine.projectTeams, ['Alpha', 'Beta']);
  assert.throws(() => engine.checkIn('L1-Q-01', 'x', { team: 'SAP' }), ValidationError);
  assert.equal(engine.checkIn('L1-Q-01', 'x', { team: 'beta' }).projectTeam, 'Beta');
  assert.throws(() => new OccupancyEngine({ seats: [], projectTeams: [] }), /At least one project team/);
});

test('requesters are grouped by project team with today\'s counts', () => {
  const { engine, clock } = setup();
  engine.checkIn('L1-Q-01', 'Ivan', { team: 'SAP' });
  engine.checkIn('L1-A-01', 'Jo', { team: 'SAP' });
  engine.checkIn('L1-A-02', 'Kim', { team: 'DDAP' });
  engine.checkOut('L1-A-01', 'Jo', { team: 'SAP' });
  engine.checkIn('L1-Q-01', 'Ivan', { team: 'SAP' }); // renewal: not a new check-in
  clock.advance(1);
  // Kim moves to another team: the requester follows the latest team given.
  engine.checkOut('L1-A-02', 'Kim', { team: 'ITGC' });

  const byName = Object.fromEntries(engine.projectTeamSummary().map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName), ['External', 'Bolt On', 'eWorkplace', 'G&C', 'STREAM', 'SAP', 'ITGC', 'DDAP']);
  assert.equal(byName.SAP.checkedInNow, 1);
  assert.equal(byName.SAP.checkinsToday, 2);
  assert.equal(byName.SAP.checkoutsToday, 1);
  assert.deepEqual(byName.SAP.requesters.map((r) => [r.name, r.checkedInAt, r.lastSeatId]), [
    ['Ivan', 'L1-Q-01', 'L1-Q-01'],
    ['Jo', null, 'L1-A-01'],
  ]);
  assert.equal(byName.DDAP.checkinsToday, 1);
  assert.equal(byName.DDAP.requesters.length, 0);
  assert.deepEqual(byName.ITGC.requesters.map((r) => r.name), ['Kim']);
  assert.equal(byName.ITGC.checkoutsToday, 1);

  // Survives a restart; a team removed from the list still shows up in reports.
  const copy = new OccupancyEngine({ seats: expandLayout(building), state: engine.snapshot(), clock: clock.now, projectTeams: ['SAP'] });
  const names = copy.projectTeamSummary().map((t) => [t.name, t.configured]);
  assert.deepEqual(names, [['SAP', true], ['ITGC', false]]);
  assert.equal(copy.view(copy.getSeat('L1-Q-01')).projectTeam, 'SAP');
});

test('automatic releases keep the project team in the activity log', () => {
  const { engine, clock } = setup();
  engine.checkIn('L1-Q-01', 'lee', { team: 'STREAM' });
  clock.advance(181);
  engine.sweep();
  assert.deepEqual(
    engine.activity.filter((a) => a.type === 'expired').map((a) => [a.detail, a.team]),
    [['lee', 'STREAM']],
  );
  assert.equal(engine.getSeat('L1-Q-01').checkedInTeam, null);
});

test('project teams can carry a short code and a colour', () => {
  const engine = new OccupancyEngine({
    seats: expandLayout(building),
    projectTeams: ['Bolt On', { name: 'eWorkplace', code: 'eWP', color: '#123abc' }, 'Information Security'],
  });
  assert.deepEqual(engine.projectTeams, ['Bolt On', 'eWorkplace', 'Information Security']);
  const byName = Object.fromEntries(engine.projectTeamSummary().map((t) => [t.name, [t.code, t.color, t.slot]]));
  assert.deepEqual(byName, {
    'Bolt On': ['BO', null, 0],
    eWorkplace: ['eWP', '#123abc', 1],
    'Information Security': ['IS', null, 2],
  });
  assert.throws(() => new OccupancyEngine({ seats: [], projectTeams: [{ name: 'X', color: 'red' }] }), /color must look like/);
});
