// Simulates a building's desk sensors and a few QR check-ins against a running server.
// Usage: node scripts/simulate.js [baseUrl]   (env: SENSOR_API_KEY, SIM_INTERVAL_MS)
import { readFileSync } from 'node:fs';
import { expandLayout } from '../src/occupancy.js';

const base = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000';
const interval = Number(process.env.SIM_INTERVAL_MS ?? 3000);
const building = JSON.parse(readFileSync(new URL('../config/building.json', import.meta.url), 'utf8'));
const seats = expandLayout(building);
const sensored = seats.filter((s) => s.sensorId);
const qrOnly = seats.filter((s) => !s.sensorId);

// Each sensor keeps a little state: present or not.
const present = new Map(sensored.map((s) => [s.sensorId, Math.random() < 0.35]));
// A couple of sensors are "broken" and never report, so the dashboard shows offline seats.
const broken = new Set(sensored.slice(-2).map((s) => s.sensorId));

// 40 simulated requesters, each in one of the project teams. The list comes from the running
// server (it can be edited on the dashboard), falling back to building.json if it can't be read.
let teams = (building.projectTeams ?? ['External', 'Bolt On', 'eWorkplace', 'G&C', 'STREAM', 'SAP', 'ITGC', 'DDAP'])
  .map((t) => (typeof t === 'string' ? t : t.name));
const people = Array.from({ length: 40 }, (_, i) => ({ name: `employee${i + 1}`, team: null, seat: null }));

/** Follow the server's current project list; people whose project was deleted move to another. */
async function syncTeams() {
  try {
    const res = await fetch(`${base}/api/checkin-options`);
    if (res.ok) {
      const list = (await res.json()).projectTeams;
      if (Array.isArray(list) && list.length) teams = list;
    }
  } catch {}
  people.forEach((p, i) => { if (!teams.includes(p.team)) p.team = teams[i % teams.length]; });
}

const headers = { 'content-type': 'application/json' };
if (process.env.SENSOR_API_KEY) headers['x-api-key'] = process.env.SENSOR_API_KEY;

async function post(path, body, extra = {}) {
  const res = await fetch(base + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  if (res.status === 401 && path === '/api/sensors/events') {
    console.error(process.env.SENSOR_API_KEY
      ? 'The server rejected SENSOR_API_KEY. Use the same key the server was started with.'
      : 'The server requires a sensor key. Run again with the same SENSOR_API_KEY as the server, e.g. SENSOR_API_KEY=... npm run simulate');
    process.exit(1);
  }
  if (!res.ok && res.status !== 409) console.error(path, res.status, await res.text());
}

async function tick() {
  const events = [];
  for (const [sensorId, isPresent] of present) {
    if (broken.has(sensorId)) continue;
    // Roughly a third of desks have someone at them; the away grace adds some held seats on top.
    const flip = isPresent ? Math.random() < 0.04 : Math.random() < 0.02;
    const next = flip ? !isPresent : isPresent;
    present.set(sensorId, next);
    events.push({ sensorId, presence: next }); // every reading doubles as a heartbeat
  }
  await post('/api/sensors/events', events);

  // People check in at desks where someone is sitting, and some check out again.
  if (Math.random() < 0.3) {
    const person = people[Math.floor(Math.random() * people.length)];
    if (person.seat && Math.random() < 0.4) {
      await post(`/api/seats/${person.seat}/checkout`, { user: person.name, projectTeam: person.team });
      person.seat = null;
    } else if (!person.seat) {
      const taken = new Set(people.map((p) => p.seat));
      const free = seats.filter((s) => !taken.has(s.id) && (!s.sensorId || present.get(s.sensorId)));
      if (free.length) {
        const seat = free[Math.floor(Math.random() * free.length)];
        await post(`/api/seats/${seat.id}/checkin`, { user: person.name, projectTeam: person.team });
        person.seat = seat.id;
      }
    }
  }
}

try {
  await fetch(`${base}/healthz`);
} catch {
  console.error(`No Hot Desk server at ${base}. Start it first (npm start), or pass its address: npm run simulate -- http://host:port`);
  process.exit(1);
}
await syncTeams();
setInterval(syncTeams, 60_000);
console.log(`Simulating ${sensored.length} sensors (${broken.size} broken), ${qrOnly.length} QR-only desks and ${people.length} requesters in ${teams.length} project teams against ${base}`);
await tick();
setInterval(() => tick().catch((e) => console.error(e.message)), interval);
