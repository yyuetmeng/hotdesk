import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { OccupancyEngine, expandLayout } from './occupancy.js';
import { JsonStore } from './store.js';
import { createApp } from './server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const num = (v) => (v === undefined ? undefined : Number(v));

const building = JSON.parse(readFileSync(env.BUILDING_FILE ?? resolve(root, 'config/building.json'), 'utf8'));
const store = new JsonStore(env.STATE_FILE ?? resolve(root, 'data/state.json'));

const rules = Object.fromEntries(
  Object.entries({
    awayGraceMinutes: num(env.AWAY_GRACE_MINUTES),
    checkinConfirmMinutes: num(env.CHECKIN_CONFIRM_MINUTES),
    checkinTtlMinutes: num(env.CHECKIN_TTL_MINUTES),
    sensorOfflineMinutes: num(env.SENSOR_OFFLINE_MINUTES),
  }).filter(([, v]) => v !== undefined),
);

const engine = new OccupancyEngine({ seats: expandLayout(building), rules, state: await store.load() });
engine.on('change', () => store.scheduleSave(() => engine.snapshot()));

const server = createApp({
  engine,
  publicDir: resolve(root, 'public'),
  sensorApiKey: env.SENSOR_API_KEY,
  adminToken: env.ADMIN_TOKEN,
});

const sweep = setInterval(() => engine.sweep(), 15_000);
engine.sweep();

const port = Number(env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Hot desk monitor for ${building.name} on http://localhost:${port}`);
  if (!env.ADMIN_TOKEN) console.warn('ADMIN_TOKEN not set: admin dashboard is open to anyone who can reach it.');
  if (!env.SENSOR_API_KEY) console.warn('SENSOR_API_KEY not set: sensor ingestion is unauthenticated.');
});

async function shutdown() {
  clearInterval(sweep);
  server.close();
  await store.flush(() => engine.snapshot());
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
