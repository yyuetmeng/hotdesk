import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { OccupancyEngine, expandLayout } from '../src/occupancy.js';
import { createApp } from '../src/server.js';

const building = { floors: [{ id: 'L1', name: 'Level 1', zones: [{ id: 'A', name: 'A', rows: 1, cols: 2 }] }] };
let server;
let base;

before(async () => {
  const engine = new OccupancyEngine({ seats: expandLayout(building) });
  server = createApp({
    engine,
    publicDir: resolve(import.meta.dirname, '../public'),
    sensorApiKey: 'sensor-key',
    adminToken: 'admin-token',
    floorPlans: [{ id: 'L1', plan: { width: 40, height: 20, zones: { A: { x: 2, y: 2, w: 20, h: 12 } } } }],
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const admin = { authorization: 'Bearer admin-token' };

test('sensor ingestion requires the API key', async () => {
  assert.equal((await post('/api/sensors/events', { sensorId: 'S-L1-A-01', presence: true })).status, 401);
  const res = await post(
    '/api/sensors/events',
    [{ sensorId: 'S-L1-A-01', presence: true }, { sensorId: 'nope', presence: true }],
    { 'x-api-key': 'sensor-key' },
  );
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.accepted, 1);
  assert.equal(body.results[1].ok, false);
});

test('admin endpoints require the token', async () => {
  assert.equal((await fetch(`${base}/api/summary`)).status, 401);
  const res = await fetch(`${base}/api/summary`, { headers: admin });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).overall.occupied, 1);
  assert.equal((await fetch(`${base}/api/seats?token=admin-token&status=occupied`)).status, 200);
});

test('check-in flow and privacy of public views', async () => {
  let res = await post('/api/seats/L1-A-02/checkin', { user: 'alice', projectTeam: 'G&C' });
  assert.equal(res.status, 200);
  const seat = await res.json();
  assert.equal(seat.status, 'occupied');
  assert.equal(seat.checkedInBy, undefined, 'public view must not reveal who sits there');

  assert.equal(seat.checkedInUntil - Date.now() > 179 * 60_000, true, 'default 3-hour check-in');

  res = await post('/api/seats/L1-A-02/checkin', { user: 'bob', projectTeam: 'G&C' });
  assert.equal(res.status, 409);
  assert.equal((await post('/api/seats/L1-A-01/checkin', { user: 'bob', projectTeam: 'G&C', minutes: 9999 })).status, 400);
  res = await post('/api/seats/L1-A-01/checkin', { user: 'bob', projectTeam: 'G&C', minutes: 60 });
  assert.equal(res.status, 200);
  assert.ok(Math.abs((await res.json()).checkedInUntil - Date.now() - 60 * 60_000) < 5_000);

  const seats = await (await fetch(`${base}/api/seats`, { headers: admin })).json();
  assert.equal(seats.find((s) => s.id === 'L1-A-02').checkedInBy, 'alice');

  res = await post('/api/seats/L1-A-02/checkout', { user: 'alice', projectTeam: 'G&C' });
  assert.equal((await res.json()).status, 'available'); // no sensor has reported: follows check-ins
  assert.equal((await post('/api/seats/L1-A-02/checkin', {})).status, 400);
  assert.equal((await post('/api/seats/ZZ/checkin', { user: 'x', projectTeam: 'G&C' })).status, 404);
});

test('history by chart period', async () => {
  const res = await fetch(`${base}/api/history?period=7d`, { headers: admin });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
  assert.equal((await fetch(`${base}/api/history?period=nope`, { headers: admin })).status, 400);
  assert.equal((await fetch(`${base}/api/history?period=24h`)).status, 401);
});

test('floor-plan drawing data is admin-only', async () => {
  assert.equal((await fetch(`${base}/api/floorplan`)).status, 401);
  const plans = await (await fetch(`${base}/api/floorplan`, { headers: admin })).json();
  assert.deepEqual(plans, [{ id: 'L1', plan: { width: 40, height: 20, zones: { A: { x: 2, y: 2, w: 20, h: 12 } } } }]);
});

test('projects and seat allocation API is admin-only and validates input', async () => {
  const json = (body) => ({ method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/api/projects`)).status, 401);
  assert.equal((await post('/api/projects', { name: 'Ops' })).status, 401);
  let res = await fetch(`${base}/api/projects`, json({ name: 'Ops Team', color: '#336699' }));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).code, 'OT');
  assert.equal((await fetch(`${base}/api/projects`, json({ name: 'ops team' }))).status, 409);
  res = await fetch(`${base}/api/projects/${encodeURIComponent('Ops Team')}/seats`, { ...json({ seats: ['L1-A-01'] }), method: 'PUT' });
  assert.deepEqual((await res.json()).seats, ['L1-A-01']);
  assert.equal((await fetch(`${base}/api/projects/G%26C/seats`, { ...json({ seats: ['L1-A-01'] }), method: 'PUT' })).status, 409);
  res = await fetch(`${base}/api/projects/${encodeURIComponent('Ops Team')}`, { ...json({ color: '#ff0000' }), method: 'PATCH' });
  assert.equal((await res.json()).color, '#ff0000');
  assert.equal((await (await fetch(`${base}/api/seats/L1-A-01`)).json()).allocatedTo, 'Ops Team');
  const opts = await (await fetch(`${base}/api/checkin-options`)).json();
  assert.ok(opts.projectTeams.includes('Ops Team'), 'new projects can be chosen at check-in');
  res = await fetch(`${base}/api/projects/${encodeURIComponent('Ops Team')}`, { headers: admin, method: 'DELETE' });
  assert.deepEqual((await res.json()).released, ['L1-A-01']);
});

test('booking several seats for a team is admin-only', async () => {
  const body = { user: 'ana', projectTeam: 'SAP', seats: ['L1-A-01'] };
  assert.equal((await post('/api/bookings', body)).status, 401);
  const res = await post('/api/bookings', { ...body, seats: ['ZZ'] }, admin);
  assert.equal(res.status, 400);
  assert.equal((await post('/api/bookings', { ...body, user: '' }, admin)).status, 400);
});

test('clearing seats is admin-only', async () => {
  assert.equal((await post('/api/seats/reset', {})).status, 401);
  const res = await post('/api/seats/reset', {}, admin);
  assert.equal(res.status, 200);
  assert.equal(typeof (await res.json()).cleared, 'number');
});

test('serves dashboard and check-in pages; blocks traversal', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/checkin?seat=L1-A-01`)).status, 200);
  assert.equal((await fetch(`${base}/static/..%2f..%2fpackage.json`)).status, 404);
});

test('SSE stream sends a snapshot then seat changes', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream`, { headers: admin, signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const waitFor = async (needle) => {
    while (!buf.includes(needle)) buf += dec.decode((await reader.read()).value);
  };
  await waitFor('event: snapshot');
  await post('/api/sensors/events', { sensorId: 'S-L1-A-02', presence: true }, { 'x-api-key': 'sensor-key' });
  await waitFor('event: seat');
  assert.match(buf, /"id":"L1-A-02","floor"/);
  ctrl.abort();
});

test('shipped building layout loads and matches the seat assignment deck', async () => {
  const { readFile } = await import('node:fs/promises');
  const building = JSON.parse(await readFile(resolve(import.meta.dirname, '../config/building.json'), 'utf8'));
  const seats = expandLayout(building);
  const byZone = {};
  for (const s of seats) byZone[`${s.floor}-${s.zone}`] = (byZone[`${s.floor}-${s.zone}`] ?? 0) + 1;
  assert.deepEqual(byZone, { 'L1-DF': 36, 'L1-DA': 16, 'L1-AI': 30, 'L2-GO': 43 });
});

test('desk labels page is admin-only and encodes each desk check-in URL', async () => {
  assert.equal((await fetch(`${base}/labels`)).status, 401);
  const res = await fetch(`${base}/labels?base=https://desks.example.org/`, { headers: admin });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal((html.match(/<svg /g) ?? []).length, 2);
  assert.match(html, /aria-label="QR code for https:\/\/desks\.example\.org\/checkin\?seat=L1-A-01"/);
  assert.match(html, /aria-label="QR code for https:\/\/desks\.example\.org\/checkin\?seat=L1-A-02"/);

  const proxied = await fetch(`${base}/labels?floor=L1`, {
    headers: { ...admin, 'x-forwarded-host': 'demo.app.github.dev', 'x-forwarded-proto': 'https' },
  });
  assert.match(await proxied.text(), /https:\/\/demo\.app\.github\.dev\/checkin\?seat=L1-A-01/);
});

test('check-in options expose the default and maximum duration', async () => {
  const res = await fetch(`${base}/api/checkin-options`);
  const { projects, ...rest } = await res.json();
  assert.deepEqual(rest, {
    checkinDurationMinutes: 180,
    checkinMaxMinutes: 480,
    projectTeams: ['External', 'Bolt On', 'eWorkplace', 'G&C', 'STREAM', 'SAP', 'ITGC', 'DDAP'],
  });
  // Project colours for the booking page: name, code, colour and palette slot only (no allocated seats).
  assert.deepEqual(Object.keys(projects[0]).sort(), ['code', 'color', 'name', 'slot']);
  assert.equal(projects.length, 8);
});

test('self-service booking page and its floor data are public and carry no personal data', async () => {
  assert.equal((await fetch(`${base}/book`)).status, 200);
  assert.equal((await fetch(`${base}/static/book.js`)).status, 200);
  const floors = await (await fetch(`${base}/api/floors`)).json();
  assert.deepEqual(floors, [{ id: 'L1', name: 'Level 1', zones: [{ id: 'A', name: 'A' }], plan: { width: 40, height: 20, zones: { A: { x: 2, y: 2, w: 20, h: 12 } } } }]);
  const seats = await (await fetch(`${base}/api/availability`)).json();
  assert.ok(seats.every((s) => !('checkedInBy' in s) && !('projectTeam' in s)));
});

test('LoRaWAN webhooks feed readings; unknown sensors are listed for linking', async () => {
  const key = { 'x-api-key': 'sensor-key' };
  const ttn = (devEui, occupancy) => ({
    end_device_ids: { device_id: `dev-${devEui}`, dev_eui: devEui },
    uplink_message: { decoded_payload: { occupancy } },
  });
  assert.equal((await post('/api/integrations/ttn', ttn('A1', 'occupied'))).status, 401);

  let res = await post('/api/integrations/ttn', ttn('A1B2C3D4E5F60708', 'occupied'), key);
  assert.equal(res.status, 202);
  assert.equal((await res.json()).ok, false);

  let report = await (await fetch(`${base}/api/sensors`, { headers: admin })).json();
  assert.equal(report.unlinked[0].sensorId, 'A1B2C3D4E5F60708');

  assert.equal((await post('/api/sensors/links', [{ seatId: 'L1-A-01', sensorId: 'a1b2c3d4e5f60708' }])).status, 401);
  res = await post('/api/sensors/links', [{ seatId: 'L1-A-01', sensorId: 'a1b2c3d4e5f60708' }, { seatId: 'NOPE', sensorId: 'X' }], admin);
  assert.deepEqual((await res.json()).linked, 1);

  res = await post('/api/integrations/ttn', ttn('A1B2C3D4E5F60708', 'occupied'), key);
  assert.deepEqual(await res.json(), { ok: true, sensorId: 'A1B2C3D4E5F60708', seat: 'L1-A-01', presence: true });

  // ChirpStack: matched by device name when the DevEUI isn't linked (name the device after the desk).
  res = await post('/api/integrations/chirpstack?event=up', { deviceInfo: { devEui: 'ffff', deviceName: 's-l1-a-02' }, object: { pir: 'idle' } }, key);
  assert.equal((await res.json()).seat, 'L1-A-02');
  res = await post('/api/integrations/chirpstack?event=status', { deviceInfo: { devEui: 'ffff' } }, key);
  assert.deepEqual(await res.json(), { ignored: true });

  const put = await fetch(`${base}/api/seats/L1-A-02/sensor`, { method: 'PUT', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ sensorId: null }) });
  assert.equal((await put.json()).hasSensor, false);

  report = await (await fetch(`${base}/api/sensors`, { headers: admin })).json();
  assert.equal(report.desks.find((d) => d.id === 'L1-A-01').sensorId, 'A1B2C3D4E5F60708');
  assert.ok(!report.unlinked.some((u) => u.sensorId === 'A1B2C3D4E5F60708'), 'linked sensor leaves the waiting list');

  const pub = await (await fetch(`${base}/api/seats/L1-A-01`)).json();
  assert.equal(pub.sensorId, undefined, 'sensor ids are not shown publicly');
  assert.equal((await fetch(`${base}/sensors`)).status, 200);
});


test('project teams: required at check-in/out, listed publicly, summarised and exported for admins', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/project-teams`)).json(),
    ['External', 'Bolt On', 'eWorkplace', 'G&C', 'STREAM', 'SAP', 'ITGC', 'DDAP']);

  let res = await post('/api/seats/L1-A-02/checkin', { user: 'maya' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Project team is required/);
  res = await post('/api/seats/L1-A-02/checkin', { user: 'maya', projectTeam: 'Finance' });
  assert.equal(res.status, 400);

  res = await post('/api/seats/L1-A-02/checkin', { user: 'maya', projectTeam: 'eWorkplace' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).projectTeam, undefined, 'team is not shown on the public desk view');
  assert.equal((await post('/api/seats/L1-A-02/checkout', { user: 'maya' })).status, 400);
  assert.equal((await post('/api/seats/L1-A-02/checkout', { projectTeam: 'eWorkplace' })).status, 400);

  assert.equal((await fetch(`${base}/api/project-teams/summary`)).status, 401);
  let summary = await (await fetch(`${base}/api/project-teams/summary`, { headers: admin })).json();
  const ew = summary.find((t) => t.name === 'eWorkplace');
  assert.equal(ew.checkedInNow, 1);
  assert.deepEqual(ew.requesters.map((r) => [r.name, r.checkedInAt]), [['maya', 'L1-A-02']]);

  res = await post('/api/seats/L1-A-02/checkout', { user: 'maya', projectTeam: 'eWorkplace' });
  assert.equal(res.status, 200);
  summary = await (await fetch(`${base}/api/project-teams/summary`, { headers: admin })).json();
  assert.equal(summary.find((t) => t.name === 'eWorkplace').checkoutsToday, 1);

  assert.equal((await fetch(`${base}/api/requesters.csv`)).status, 401);
  res = await fetch(`${base}/api/requesters.csv`, { headers: admin });
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const csv = await res.text();
  assert.match(csv, /^"project_team","requester",/);
  assert.match(csv, /"eWorkplace","maya","","L1-A-02",/);

  // Spreadsheet formula injection through a requester name is neutralised.
  await post('/api/seats/L1-A-02/checkin', { user: '=HYPERLINK("x")', projectTeam: 'SAP' });
  const csv2 = await (await fetch(`${base}/api/requesters.csv`, { headers: admin })).text();
  assert.match(csv2, /"'=HYPERLINK\(""x""\)"/);
});
