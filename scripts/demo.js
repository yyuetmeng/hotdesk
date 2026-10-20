// One command for a lively demo: starts the server with its hold times shortened and runs the
// simulator at the same speed, so a working day passes in minutes. Works on Windows too.
//
// Usage: npm run demo                 10x speed, keeps current seats, projects and allocations
//        npm run demo -- --fresh      same, but starts from an empty floor with no names from earlier runs
//                                     (projects and allocations kept)
//        npm run demo -- --speed=20   another speed
//        npm run demo:video           a fresh demo set up for recording the demo video (docs/DEMO-VIDEO.md):
//                                     a free desk for the booking scene, a colleague to find on the
//                                     floor display, and a reservation that turns into a no-show in
//                                     2 minutes. Type n + Enter to stage another no-show, r + Enter to
//                                     free the booking desk again for a retake.
// Stop with Ctrl+C. Uses PORT, ADMIN_TOKEN and SENSOR_API_KEY from the environment if set.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const speed = Math.max(1, Number(args.find((a) => a.startsWith('--speed='))?.split('=')[1] ?? 10) || 10);
const video = args.includes('--video');
const fresh = args.includes('--fresh') || video;
const port = process.env.PORT ?? '3000';
const url = `http://localhost:${port}`;
const root = fileURLToPath(new URL('..', import.meta.url));

const up = () => fetch(`${url}/healthz`).then((r) => r.ok, () => false);
if (await up()) {
  console.error(`Something is already running on port ${port}. Stop your server first (Ctrl+C in its window), then run npm run demo again.`);
  process.exit(1);
}

// The server's own clocks, scaled to the demo speed (normal values: away 20 min, others 15 min).
const minutes = (normal) => String(Math.max(1, Math.round(normal / speed)));
const env = {
  ...process.env,
  PORT: port,
  AWAY_GRACE_MINUTES: process.env.AWAY_GRACE_MINUTES ?? minutes(20),
  SENSOR_OFFLINE_MINUTES: process.env.SENSOR_OFFLINE_MINUTES ?? minutes(15),
  CHECKIN_CONFIRM_MINUTES: process.env.CHECKIN_CONFIRM_MINUTES ?? minutes(15),
  // Demo mode: the booking page (/book) fills in a random sample name.
  DEMO_MODE: process.env.DEMO_MODE ?? '1',
};
console.log(`Demo at ${speed}x speed: away holds ${env.AWAY_GRACE_MINUTES} min, sensor offline after ${env.SENSOR_OFFLINE_MINUTES} min.`);

const children = [];
const stop = (code = 0) => { for (const c of children) c.kill(); process.exit(code); };
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const server = spawn(process.execPath, ['src/index.js'], { cwd: root, env, stdio: 'inherit' });
children.push(server);
server.on('exit', (code) => { console.error(`Server stopped (${code}).`); stop(code ?? 1); });

for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 200));
if (!(await up())) { console.error('The server did not start.'); stop(1); }

// ---------- Video mode: a scripted scenario on top of the simulation ----------
const admin = { 'content-type': 'application/json', ...(process.env.ADMIN_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {}) };
const api = async (method, path, body) => {
  const res = await fetch(url + path, { method, headers: admin, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error ?? res.status}`);
  return data;
};
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
// The cast. Rachel and the no-shows are not among the simulated people, so nobody else uses their names.
const FIND = { name: 'Rachel Tan', team: 'STREAM', desk: 'L2-GO-12' };
const NOSHOW = { names: ['Marcus Lim', 'Daniel Koh', 'Priya Nair', 'Jason Ong', 'Aisha Rahman'], team: 'G&C', desks: ['L1-AI-05', 'L1-AI-06', 'L1-AI-11', 'L1-AI-12'] };
const BOOK = { team: 'SAP', desk: 'L1-DF-07' };
let noShows = 0;
async function stageNoShow() {
  const now = new Date(), h = now.getHours() + now.getMinutes() / 60;
  // The slot under way (its check-in window open), or the next one today.
  const slot = h < 12 ? 'am' : h < 18 ? 'pm' : null;
  if (!slot) { console.log('  No-show: no slot left today to reserve (after 18:00).'); return; }
  const desk = NOSHOW.desks[noShows % NOSHOW.desks.length], name = NOSHOW.names[noShows++ % NOSHOW.names.length];
  const date = now.toLocaleDateString('en-CA');
  const [r] = await api('POST', '/api/reservations', { seatId: desk, user: name, projectTeam: NOSHOW.team, date, slot, graceMinutes: 2 });
  console.log(`  No-show: ${name} reserved ${desk} and never comes. It shows as Reserved${r.checkInFrom > Date.now() ? ` from ${hhmm(r.checkInFrom)}` : ''} and is released at about ${hhmm(r.deadline + 15_000)}.`);
}
async function freeBookingDesk() {
  for (const r of await api('GET', '/api/reservations')) {
    if (r.seatId === BOOK.desk && r.status === 'booked') await api('POST', `/api/reservations/${r.id}/cancel`, {});
  }
  const seat = (await api('GET', '/api/seats')).find((x) => x.id === BOOK.desk);
  if (seat?.checkedInBy) await api('POST', `/api/seats/${BOOK.desk}/checkout`, { user: seat.checkedInBy, projectTeam: seat.projectTeam });
  console.log(`  ${BOOK.desk} is checked out and its reservation cancelled. It shows Away for up to ${env.AWAY_GRACE_MINUTES} min (the sensor just saw someone leave), then Free for the next take.`);
}
if (video) {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 8 || h >= 17.5) console.log('\n  Note: reservations follow the real clock (slots 08:00–19:00). Record between 08:00 and 17:30 for every scene to work.\n');
  await api('POST', '/api/seats/reset', { people: true });
  // The booking scene uses a desk pre-allocated to SAP if there is one (so no warning appears).
  const list = await api('GET', '/api/availability');
  BOOK.desk = list.find((x) => x.allocatedTo === BOOK.team && x.hasSensor && !NOSHOW.desks.includes(x.id) && x.id !== FIND.desk)?.id ?? BOOK.desk;
  await api('POST', `/api/seats/${FIND.desk}/checkin`, { user: FIND.name, projectTeam: FIND.team });
  await stageNoShow().catch((e) => console.log(`  No-show not staged: ${e.message}`));
  console.log(`
  ── Demo video cues (docs/DEMO-VIDEO.md) ─────────────────────────────
  Dashboard        ${url}
  Reserve a desk   ${url}/book        project ${BOOK.team}, desk ${BOOK.desk} (kept free)
  Floor display    ${url}/display     search "${FIND.name.split(' ')[0]}": ${FIND.desk} on Level 2
  Insights         ${url}/insights
  Type n + Enter: stage another no-show.  r + Enter: free ${BOOK.desk} for a retake.
  ─────────────────────────────────────────────────────────────────────
`);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (line) => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'n') stageNoShow().catch((e) => console.log(`  ${e.message}`));
    else if (cmd === 'r') freeBookingDesk().catch((e) => console.log(`  ${e.message}`));
  });
}

const scripted = video ? [`--keep-free=${[BOOK.desk, ...NOSHOW.desks].join(',')}`, `--seated=${FIND.desk}`] : [];
const sim = spawn(process.execPath, ['scripts/simulate.js', url, `--speed=${speed}`, ...(fresh && !video ? ['--reset'] : []), ...scripted],
  { cwd: root, env: { ...env, SIM_INTERVAL_MS: process.env.SIM_INTERVAL_MS ?? '1000' }, stdio: 'inherit' });
children.push(sim);
sim.on('exit', (code) => { if (code) { console.error('Simulator stopped.'); stop(code); } });
console.log(`Open ${url} in your browser. Press Ctrl+C to stop.`);
