// Simulates an office day against a running server: people from the project teams arrive,
// sit down (desk sensors see them), mostly check in with their project, and leave again;
// team leads now and then book a few seats for their team; a few visitors sit without
// checking in; two sensors break so their desks show offline.
//
// Usage: node scripts/simulate.js [baseUrl] [--reset]
//   --speed=N  run N times faster than real time (e.g. 10 for a demo; see scripts/demo.js,
//              which also shortens the server's hold times to match)
//   --reset  first clear every seat's live state (who sits where, check-ins, team bookings,
//            away holds) on the server, keeping projects and seat allocations. Use only on a
//            demo server: it also clears real people's check-ins.
// Env:   SENSOR_API_KEY  the server's sensor key (needed if the server has one)
//        ADMIN_TOKEN     the server's admin token (needed for team bookings if the server has one)
//        SIM_INTERVAL_MS time between rounds (default 3000)
import { readFileSync } from 'node:fs';
import { expandLayout } from '../src/occupancy.js';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? process.env.BASE_URL ?? 'http://localhost:3000';
const reset = args.includes('--reset');
const SPEED = Math.max(0.1, Number(args.find((a) => a.startsWith('--speed='))?.split('=')[1] ?? process.env.SIM_SPEED ?? 1) || 1);
const interval = Number(process.env.SIM_INTERVAL_MS ?? 3000);
const building = JSON.parse(readFileSync(new URL('../config/building.json', import.meta.url), 'utf8'));
const seats = expandLayout(building);
const seatById = new Map(seats.map((s) => [s.id, s]));
const sensored = seats.filter((s) => s.sensorId);
const qrOnly = seats.filter((s) => !s.sensorId);

// Rates are per minute of simulated time (real time x SPEED), so the picture is the same at any
// SIM_INTERVAL_MS; SPEED makes the day pass faster.
const PEOPLE = 70;              // people in the project teams
const EXTERNAL_SHARE = 0.1;    // share of people from outside the project teams ("External")
const VISITORS = 8;             // people who sit down without checking in
const START_SEATED = 0.45;      // share of people already at a desk when the simulation starts
const ARRIVE = 1 / 10;          // someone who is out comes back after about 10 minutes
const LEAVE = 1 / 20;           // someone stays at a desk for about 20 minutes
const CHECK_IN = 0.85;          // share of arrivals who check in with their project
const CHECK_OUT = 0.85;         // share of leavers who check out (the rest are held as away for the grace, then freed)
const PREFER_ALLOCATED = 0.8;   // chance to pick their project's pre-allocated seat when one is free
const TEAM_BOOKING = 1 / 12;    // a team lead books seats for the team about every 12 minutes
const MAX_BOOKINGS = 3;         // ...while fewer than this many team bookings are running
const BOOKING_MINUTES = Math.max(1, Math.round(60 / SPEED));
/** The chance of something that happens `perMinute` times a minute happening in one round. */
const chance = (perMinute) => 1 - Math.exp(-perMinute * SPEED * interval / 60_000);

// Sensors that break: they report once, then go silent, so their desks turn "sensor offline".
const broken = new Set(sensored.slice(-2).map((s) => s.sensorId));
const present = new Map(sensored.map((s) => [s.sensorId, false]));

// The project list comes from the running server (it can be edited on the dashboard), falling
// back to building.json if it can't be read.
let teams = (building.projectTeams ?? ['External', 'Bolt On', 'eWorkplace', 'G&C', 'STREAM', 'SAP', 'ITGC', 'DDAP'])
  .map((t) => (typeof t === 'string' ? t : t.name));
const people = Array.from({ length: PEOPLE }, (_, i) => ({ name: `employee${i + 1}`, team: null, seat: null, checkedIn: false }));
const visitors = Array.from({ length: VISITORS }, () => ({ seat: null }));
const teamBooked = new Map(); // seat id -> { team, until, booking } for seats our team leads booked
let bookingCount = 0;

const headers = { 'content-type': 'application/json' };
if (process.env.SENSOR_API_KEY) headers['x-api-key'] = process.env.SENSOR_API_KEY;
const adminHeaders = process.env.ADMIN_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};
let teamBookings = true;

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

const isExternal = (team) => /^external$/i.test(team);
const projectTeams = () => { const list = teams.filter((t) => !isExternal(t)); return list.length ? list : teams; };

/**
 * Follow the server's current project list. Every tenth person is External (EXTERNAL_SHARE), the
 * rest are spread evenly over the project teams; people whose project was deleted move to another.
 */
async function syncTeams() {
  try {
    const res = await fetch(`${base}/api/checkin-options`);
    if (res.ok) {
      const list = (await res.json()).projectTeams;
      if (Array.isArray(list) && list.length) teams = list;
    }
  } catch {}
  const external = teams.find(isExternal), projects = projectTeams();
  const every = Math.round(1 / EXTERNAL_SHARE);
  people.forEach((p, i) => {
    if (teams.includes(p.team) && isExternal(p.team) === Boolean(external && i % every === 0)) return;
    p.team = external && i % every === 0 ? external : projects[(i - (external ? Math.floor(i / every) + 1 : 0) + projects.length) % projects.length];
  });
}

async function post(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.status === 401 && path === '/api/sensors/events') {
    console.error(process.env.SENSOR_API_KEY
      ? 'The server rejected SENSOR_API_KEY. Use the same key the server was started with.'
      : 'The server requires a sensor key. Run again with the same SENSOR_API_KEY as the server, e.g. SENSOR_API_KEY=... npm run simulate');
    process.exit(1);
  }
  if (!res.ok && res.status !== 409) console.error(path, res.status, await res.text());
  return res;
}

/** Every seat's live status and pre-allocation, from the public availability list. */
async function availability() {
  const res = await fetch(`${base}/api/availability`);
  return res.ok ? new Map((await res.json()).map((s) => [s.id, s])) : new Map();
}

/** A seat for someone from `team`: a seat booked for their team, else their pre-allocated seats, else any free seat. */
function chooseSeat(team, avail, taken) {
  const free = (id) => !taken.has(id) && avail.get(id)?.status === 'available';
  const booked = [...teamBooked].filter(([id, b]) => b.team === team && !taken.has(id)).map(([id]) => id);
  if (booked.length) return pick(booked);
  const mine = seats.filter((s) => avail.get(s.id)?.allocatedTo === team && free(s.id));
  if (mine.length && Math.random() < PREFER_ALLOCATED) return pick(mine).id;
  // Otherwise a free seat that isn't kept for another project, if there is one.
  const open = seats.filter((s) => free(s.id) && !avail.get(s.id)?.allocatedTo);
  const any = seats.filter((s) => free(s.id));
  return (open.length ? pick(open) : any.length ? pick(any) : null)?.id ?? null;
}

function sit(seatId) {
  const s = seatById.get(seatId);
  if (s?.sensorId) present.set(s.sensorId, true);
}
function stand(seatId) {
  const s = seatById.get(seatId);
  if (s?.sensorId) present.set(s.sensorId, false);
}

/** A project team lead books 2–4 seats for their team, preferring the team's pre-allocated seats. */
async function bookForTeam(avail, taken) {
  const team = pick(projectTeams());
  const free = (s) => !taken.has(s.id) && avail.get(s.id)?.status === 'available' && !teamBooked.has(s.id);
  const mine = shuffle(seats.filter((s) => free(s) && avail.get(s.id)?.allocatedTo === team));
  const others = shuffle(seats.filter((s) => free(s) && !avail.get(s.id)?.allocatedTo));
  const chosen = [...mine, ...others].slice(0, 2 + Math.floor(Math.random() * 3)).map((s) => s.id);
  if (!chosen.length) return;
  const res = await fetch(`${base}/api/bookings`, {
    method: 'POST',
    headers: { ...headers, ...adminHeaders },
    body: JSON.stringify({ user: `lead-${team.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, projectTeam: team, minutes: BOOKING_MINUTES, seats: chosen }),
  });
  if (res.status === 401) {
    teamBookings = false;
    console.error('Team bookings need the admin token: run with the same ADMIN_TOKEN as the server. Continuing without them.');
    return;
  }
  if (!res.ok) return; // a seat was taken in the meantime: another round will try again
  const until = Date.now() + BOOKING_MINUTES * 60_000;
  const booking = ++bookingCount;
  for (const id of chosen) teamBooked.set(id, { team, until, booking });
}

let round = 0;
async function tick() {
  round++;
  const avail = await availability();
  // Forget team bookings that ended (expired, or checked out on the dashboard).
  for (const [id, b] of teamBooked) if (b.until <= Date.now() || !avail.get(id)?.teamBooking) teamBooked.delete(id);
  const taken = new Set([...people, ...visitors].map((p) => p.seat).filter(Boolean));
  const checkins = [], checkouts = [];

  for (const p of people) {
    if (p.seat && Math.random() < chance(LEAVE)) {
      stand(p.seat);
      if (p.checkedIn && Math.random() < CHECK_OUT) checkouts.push({ seat: p.seat, user: p.name, projectTeam: p.team });
      taken.delete(p.seat);
      p.seat = null; p.checkedIn = false;
    } else if (!p.seat && Math.random() < (round === 1 ? START_SEATED : chance(ARRIVE))) {
      const seat = chooseSeat(p.team, avail, taken);
      if (!seat) continue;
      p.seat = seat; taken.add(seat); sit(seat);
      // Sitting in a seat booked for the team needs no check-in; desks without a sensor always do.
      const qrOnlyDesk = !seatById.get(seat).sensorId;
      if (!teamBooked.has(seat) && (qrOnlyDesk || Math.random() < CHECK_IN)) {
        p.checkedIn = true;
        checkins.push({ seat, user: p.name, projectTeam: p.team });
      }
    }
  }
  for (const v of visitors) {
    if (v.seat && Math.random() < chance(LEAVE)) { stand(v.seat); taken.delete(v.seat); v.seat = null; }
    else if (!v.seat && Math.random() < (round === 1 ? START_SEATED : chance(ARRIVE))) {
      const free = sensored.filter((s) => !taken.has(s.id) && avail.get(s.id)?.status === 'available' && !avail.get(s.id)?.allocatedTo);
      if (free.length) { v.seat = pick(free).id; taken.add(v.seat); sit(v.seat); }
    }
  }

  // Sensors report what they see (every reading doubles as a heartbeat); broken ones only once.
  const events = [];
  for (const [sensorId, isPresent] of present) {
    if (broken.has(sensorId) && round > 1) continue;
    events.push({ sensorId, presence: isPresent });
  }
  await post('/api/sensors/events', events);
  for (const c of checkins) await post(`/api/seats/${c.seat}/checkin`, { user: c.user, projectTeam: c.projectTeam });
  for (const c of checkouts) await post(`/api/seats/${c.seat}/checkout`, { user: c.user, projectTeam: c.projectTeam });

  // One booking right away so it shows from the start, then every few minutes.
  const running = new Set([...teamBooked.values()].map((b) => b.booking)).size;
  if (teamBookings && running < MAX_BOOKINGS && (round === 2 || Math.random() < chance(TEAM_BOOKING))) await bookForTeam(await availability(), taken);
}

try {
  await fetch(`${base}/healthz`);
} catch {
  console.error(`No Hot Desk server at ${base}. Start it first (npm start), or pass its address: npm run simulate -- http://host:port`);
  process.exit(1);
}
if (reset) {
  const res = await fetch(`${base}/api/seats/reset`, { method: 'POST', headers: { ...headers, ...adminHeaders } });
  if (res.status === 401) {
    console.error('Clearing the seats needs the admin token: run with the same ADMIN_TOKEN as the server.');
    process.exit(1);
  }
  if (res.status === 404) {
    console.error('The server is running an older version that cannot clear seats. Restart it (Ctrl+C, then npm start) so it loads the latest code, and run this again.');
    process.exit(1);
  }
  if (!res.ok) { console.error('Could not clear the seats:', res.status, await res.text()); process.exit(1); }
  console.log(`Cleared ${(await res.json()).cleared} seats (projects and seat allocations kept).`);
}
await syncTeams();
setInterval(syncTeams, 60_000);
console.log(`Simulating${SPEED === 1 ? '' : ` at ${SPEED}x speed`}: ${PEOPLE} people in ${teams.length} project teams, ${VISITORS} visitors, ${sensored.length} sensors (${broken.size} breaking) and ${qrOnly.length} QR-only desks against ${base}`);
await tick();
setInterval(() => tick().catch((e) => console.error(e.message)), interval);
