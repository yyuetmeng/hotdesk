// One command for a lively demo: starts the server with its hold times shortened and runs the
// simulator at the same speed, so a working day passes in minutes. Works on Windows too.
//
// Usage: npm run demo                 10x speed, keeps current seats, projects and allocations
//        npm run demo -- --fresh      same, but starts from an empty floor (projects and allocations kept)
//        npm run demo -- --speed=20   another speed
// Stop with Ctrl+C. Uses PORT, ADMIN_TOKEN and SENSOR_API_KEY from the environment if set.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const speed = Math.max(1, Number(args.find((a) => a.startsWith('--speed='))?.split('=')[1] ?? 10) || 10);
const fresh = args.includes('--fresh');
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

const sim = spawn(process.execPath, ['scripts/simulate.js', url, `--speed=${speed}`, ...(fresh ? ['--reset'] : [])],
  { cwd: root, env: { ...env, SIM_INTERVAL_MS: process.env.SIM_INTERVAL_MS ?? '1000' }, stdio: 'inherit' });
children.push(sim);
sim.on('exit', (code) => { if (code) { console.error('Simulator stopped.'); stop(code); } });
console.log(`Open ${url} in your browser. Press Ctrl+C to stop.`);
