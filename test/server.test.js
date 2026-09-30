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
  let res = await post('/api/seats/L1-A-02/checkin', { user: 'alice' });
  assert.equal(res.status, 200);
  const seat = await res.json();
  assert.equal(seat.status, 'occupied');
  assert.equal(seat.checkedInBy, undefined, 'public view must not reveal who sits there');

  res = await post('/api/seats/L1-A-02/checkin', { user: 'bob' });
  assert.equal(res.status, 409);

  const seats = await (await fetch(`${base}/api/seats`, { headers: admin })).json();
  assert.equal(seats.find((s) => s.id === 'L1-A-02').checkedInBy, 'alice');

  res = await post('/api/seats/L1-A-02/checkout', { user: 'alice' });
  assert.equal((await res.json()).status, 'offline'); // sensor never reported
  assert.equal((await post('/api/seats/L1-A-02/checkin', {})).status, 400);
  assert.equal((await post('/api/seats/ZZ/checkin', { user: 'x' })).status, 404);
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
