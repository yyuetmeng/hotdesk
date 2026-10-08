import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from './occupancy.js';
import { buildInsights } from './insights.js';
import { renderLabelsPage } from './labels.js';
import { parseChirpstack, parseTtn } from './integrations.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const MAX_BODY = 256 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** The origin the client used, honouring the proxy headers set by Codespaces and reverse proxies. */
function requestOrigin(req) {
  const first = (h) => String(h ?? '').split(',')[0].trim();
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  const proto = first(req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

/** What employees may see: status only, never who is sitting where. */
function publicView(v) {
  const { checkedInBy, checkedInAt, presence, lastPresenceAt, sensorId, lastSensorSeenAt, projectTeam, ...rest } = v;
  return rest;
}

/**
 * @param {object} opts
 * @param {import('./occupancy.js').OccupancyEngine} opts.engine
 * @param {string} opts.publicDir
 * @param {string} [opts.sensorApiKey]  required in X-Api-Key for sensor ingestion when set
 * @param {string} [opts.adminToken]    required for admin endpoints when set
 * @param {string} [opts.publicUrl]     base URL printed in desk QR codes (default: the URL the page was opened at)
 * @param {string} [opts.buildingName]
 * @param {{id: string, plan: object|null}[]} [opts.floorPlans]  drawing data per floor for the dashboard (building.json `plan`)
 * @param {string} [opts.displayKey]    opens the floor display (/display?key=…), which shows who sits where; the admin token works too
 * @param {object} [opts.building]     the building layout, for the simulated Insights (never the live data)
 * @param {number} [opts.teamBookingMaxSeats]  most seats an employee can book for their team on /book (admins: 100)
 * @param {boolean} [opts.demo]          demo mode (DEMO_MODE=1, set by `npm run demo`): /book fills in sample names
 */
export function createApp({ engine, publicDir, sensorApiKey, adminToken, displayKey, publicUrl, buildingName = 'Desk labels', floorPlans = [], demo = false, teamBookingMaxSeats = 10, building = null }) {
  const streams = new Set();

  engine.on('change', (seat) => {
    const payload = `event: seat\ndata: ${JSON.stringify(seat)}\n\n`;
    for (const res of streams) res.write(payload);
  });
  engine.on('projects', (projects) => {
    const payload = `event: projects\ndata: ${JSON.stringify(projects)}\n\n`;
    for (const res of streams) res.write(payload);
  });

  const requireAdmin = (req, url) => {
    if (!adminToken) return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    if (!token || !safeEqual(token, adminToken)) throw new HttpError(401, 'Admin token required');
  };

  // The floor display shows names, so it needs the display key (or the admin token). Without a display
  // key it falls back to the admin rule: open when no admin token is set either.
  const requireDisplay = (req, url) => {
    const key = req.headers['x-display-key'] ?? url.searchParams.get('key');
    if (displayKey && key && safeEqual(key, displayKey)) return;
    try { requireAdmin(req, url); } catch { throw new HttpError(401, 'Display key required'); }
  };

  let insightsCache = null;

  const requireSensorKey = (req) => {
    if (!sensorApiKey) return;
    const key = req.headers['x-api-key'];
    if (!key || !safeEqual(key, sensorApiKey)) throw new HttpError(401, 'Invalid sensor API key');
  };

  async function serveStatic(res, file) {
    const path = normalize(join(publicDir, file));
    if (!path.startsWith(publicDir + sep)) throw new HttpError(404, 'Not found');
    try {
      const body = await readFile(path);
      // no-cache: browsers revalidate, so an updated dashboard script is picked up straight away.
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      throw new HttpError(404, 'Not found');
    }
  }

  function openStream(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify({ seats: engine.list(), summary: engine.summary() })}\n\n`);
    streams.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      streams.delete(res);
    });
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const { method } = req;

    if (method === 'GET' && url.pathname === '/') return serveStatic(res, 'index.html');
    if (method === 'GET' && url.pathname === '/checkin') return serveStatic(res, 'checkin.html');
    if (method === 'GET' && url.pathname === '/book') return serveStatic(res, 'book.html');
    if (method === 'GET' && url.pathname === '/display') return serveStatic(res, 'display.html');
    if (method === 'GET' && url.pathname === '/insights') return serveStatic(res, 'insights.html');
    // Simulated planning data (admin): built from the layout only, once a day, never from live check-ins.
    if (method === 'GET' && url.pathname === '/api/insights') {
      requireAdmin(req, url);
      if (!building) throw new HttpError(404, 'Insights are not available');
      const day = new Date().toDateString();
      if (insightsCache?.day !== day) insightsCache = { day, data: buildInsights(building) };
      return send(res, 200, insightsCache.data);
    }
    if (method === 'GET' && url.pathname === '/api/display/people') {
      requireDisplay(req, url);
      return send(res, 200, { building: buildingName, at: Date.now(), awayGraceMinutes: engine.rules.awayGraceMinutes, people: engine.peopleIn() });
    }
    if (method === 'GET' && url.pathname === '/sensors') return serveStatic(res, 'sensors.html');
    if (method === 'GET' && parts[0] === 'static') return serveStatic(res, parts.slice(1).join('/'));
    if (method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (method === 'GET' && url.pathname === '/labels') {
      requireAdmin(req, url);
      const floor = url.searchParams.get('floor') ?? undefined;
      const zone = url.searchParams.get('zone') ?? undefined;
      const baseUrl = publicUrl || url.searchParams.get('base') || requestOrigin(req);
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(renderLabelsPage({ seats: engine.list({ floor, zone }), baseUrl, buildingName }));
    }

    if (parts[0] !== 'api') throw new HttpError(404, 'Not found');

    // --- Sensor ingestion (gateway -> server) ---
    if (method === 'POST' && url.pathname === '/api/sensors/events') {
      requireSensorKey(req);
      const body = await readJson(req);
      const events = Array.isArray(body) ? body : [body];
      const results = events.map((e) => {
        try {
          const at = e.at === undefined ? undefined : new Date(e.at).getTime();
          return { ok: true, seat: engine.recordSensorEvent({ sensorId: e.sensorId, presence: e.presence, at }).id };
        } catch (err) {
          if (err instanceof NotFoundError) return { ok: false, sensorId: e.sensorId, error: err.message };
          throw err;
        }
      });
      return send(res, 202, { accepted: results.filter((r) => r.ok).length, results });
    }

    // LoRaWAN network server webhooks. Always answer 2xx so the network server
    // doesn't disable the webhook over a sensor that simply isn't linked yet.
    if (method === 'POST' && (url.pathname === '/api/integrations/ttn' || url.pathname === '/api/integrations/chirpstack')) {
      requireSensorKey(req);
      const body = await readJson(req);
      const reading = url.pathname.endsWith('/ttn') ? parseTtn(body) : parseChirpstack(body, url.searchParams.get('event'));
      if (!reading || !reading.ids.length) return send(res, 202, { ignored: true });
      const sensorId = reading.ids.find((id) => engine.isLinked(id)) ?? reading.ids[0];
      try {
        const seat = engine.recordSensorEvent({ sensorId, presence: reading.presence, at: reading.at, name: reading.name });
        return send(res, 202, { ok: true, sensorId, seat: seat.id, presence: reading.presence ?? null });
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
        return send(res, 202, { ok: false, sensorId, error: err.message });
      }
    }

    // --- Linking sensors to desks (admin) ---
    if (url.pathname === '/api/sensors' && method === 'GET') {
      requireAdmin(req, url);
      return send(res, 200, engine.sensorReport());
    }
    if (url.pathname === '/api/sensors/links' && method === 'POST') {
      // Bulk link: [{ seatId, sensorId }]; sensorId null/"" unlinks.
      requireAdmin(req, url);
      const body = await readJson(req);
      if (!Array.isArray(body)) throw new HttpError(400, 'Expected an array of { seatId, sensorId }');
      if (body.length > 2000) throw new HttpError(400, 'Too many rows');
      const results = body.map(({ seatId, sensorId }) => {
        try {
          const seat = engine.linkSensor(String(seatId ?? '').trim(), sensorId || null);
          return { ok: true, seatId: seat.id, sensorId: seat.sensorId };
        } catch (err) {
          if (err instanceof NotFoundError) return { ok: false, seatId, error: err.message };
          throw err;
        }
      });
      return send(res, 200, { linked: results.filter((r) => r.ok).length, results });
    }
    if (method === 'PUT' && parts[1] === 'seats' && parts[3] === 'sensor' && parts.length === 4) {
      requireAdmin(req, url);
      const body = await readJson(req);
      return send(res, 200, engine.linkSensor(parts[2], body.sensorId || null));
    }

    // --- Projects and seat pre-allocation (admin) ---
    // GET/POST /api/projects, PATCH/DELETE /api/projects/:name, PUT /api/projects/:name/seats
    if (parts[1] === 'projects') {
      requireAdmin(req, url);
      const name = parts[2] === undefined ? undefined : decodeURIComponent(parts[2]);
      if (parts.length === 2 && method === 'GET') return send(res, 200, engine.listProjects());
      if (parts.length === 2 && method === 'POST') return send(res, 201, engine.addProject(await readJson(req)));
      if (parts.length === 3 && method === 'PATCH') return send(res, 200, engine.updateProject(name, await readJson(req)));
      if (parts.length === 3 && method === 'DELETE') return send(res, 200, engine.deleteProject(name));
      if (parts.length === 4 && parts[3] === 'seats' && method === 'PUT') return send(res, 200, engine.allocateSeats(name, (await readJson(req)).seats));
      throw new HttpError(404, 'Not found');
    }

    // --- Clear all seats' live state, keeping projects and allocations (admin) ---
    if (method === 'POST' && url.pathname === '/api/seats/reset') {
      requireAdmin(req, url);
      const body = await readJson(req);
      const result = engine.resetSeats({ people: body.people === true });
      // Tell dashboards to reload project counts, and save the cleared history.
      if (body.people === true) engine.emit('projects', engine.listProjects());
      return send(res, 200, result);
    }

    // --- Booking several seats for a project team under one name (admin) ---
    if (method === 'POST' && url.pathname === '/api/bookings') {
      requireAdmin(req, url);
      const body = await readJson(req);
      const user = typeof body.user === 'string' ? body.user.trim().slice(0, 100) : '';
      if (!user) throw new HttpError(400, 'user is required');
      const minutes = body.minutes === undefined ? undefined : Number(body.minutes);
      return send(res, 200, engine.bookSeats(body.seats, user, { minutes, team: body.projectTeam }));
    }

    // --- Employee endpoints (QR code on each desk opens /checkin?seat=ID) ---
    if (method === 'GET' && url.pathname === '/api/checkin-options') {
      const { checkinDurationMinutes, checkinMaxMinutes } = engine.rules;
      const projects = engine.listProjects().map(({ name, code, color, slot }) => ({ name, code, color, slot }));
      return send(res, 200, { checkinDurationMinutes, checkinMaxMinutes, projectTeams: engine.projectTeams, projects, teamBookingMaxSeats, ...(demo ? { demo: true } : {}) });
    }
    if (method === 'GET' && url.pathname === '/api/project-teams') {
      return send(res, 200, engine.projectTeams);
    }
    // Floors, zones and drawings for the self-service booking page (/book); no personal data.
    if (method === 'GET' && url.pathname === '/api/floors') {
      const plans = new Map(floorPlans.map((f) => [f.id, f.plan]));
      return send(res, 200, engine.summary().floors.map((f) => ({
        id: f.id, name: f.name, zones: f.zones.map((z) => ({ id: z.id, name: z.name })), plan: plans.get(f.id) ?? null,
      })));
    }
    if (method === 'GET' && url.pathname === '/api/availability') {
      return send(res, 200, engine.list({ floor: url.searchParams.get('floor') ?? undefined }).map(publicView));
    }
    // An employee books several seats for their project team (/book). Same rules as the dashboard's
    // team booking (held for the whole time, all or nothing), but capped and the project is required.
    if (method === 'POST' && url.pathname === '/api/team-bookings') {
      const body = await readJson(req);
      const user = typeof body.user === 'string' ? body.user.trim().slice(0, 100) : '';
      if (!user) throw new HttpError(400, 'user is required');
      if (typeof body.projectTeam !== 'string' || !body.projectTeam) throw new HttpError(400, 'projectTeam is required');
      const minutes = body.minutes === undefined ? undefined : Number(body.minutes);
      const seats = engine.bookSeats(body.seats, user, { minutes, team: body.projectTeam, maxSeats: teamBookingMaxSeats });
      return send(res, 200, seats.map(publicView));
    }
    if (parts[1] === 'seats' && parts[2] && parts.length === 4 && method === 'POST') {
      const body = await readJson(req);
      const user = typeof body.user === 'string' ? body.user.trim().slice(0, 100) : '';
      const team = typeof body.projectTeam === 'string' ? body.projectTeam : undefined;
      if (parts[3] === 'checkin') {
        if (!user) throw new HttpError(400, 'user is required');
        const minutes = body.minutes === undefined ? undefined : Number(body.minutes);
        return send(res, 200, publicView(engine.checkIn(parts[2], user, { minutes, team })));
      }
      if (parts[3] === 'checkout') {
        if (!user) throw new HttpError(400, 'user is required');
        return send(res, 200, publicView(engine.checkOut(parts[2], user, { team })));
      }
    }
    if (method === 'GET' && parts[1] === 'seats' && parts[2] && parts.length === 3) {
      return send(res, 200, publicView(engine.view(engine.getSeat(parts[2]))));
    }

    // --- Administrator endpoints ---
    if (method === 'GET') {
      requireAdmin(req, url);
      const q = Object.fromEntries(['floor', 'zone', 'status', 'team'].map((k) => [k, url.searchParams.get(k) ?? undefined]));
      switch (url.pathname) {
        case '/api/seats':
          return send(res, 200, engine.list(q));
        case '/api/summary':
          return send(res, 200, engine.summary());
        case '/api/floorplan':
          return send(res, 200, floorPlans);
        case '/api/history':
          return send(res, 200, url.searchParams.has('period') ? engine.historyFor(url.searchParams.get('period')) : engine.history);
        case '/api/activity':
          return send(res, 200, engine.activity.slice(-100).reverse());
        case '/api/project-teams/summary':
          return send(res, 200, engine.projectTeamSummary());
        case '/api/requesters.csv': {
          const cell = (v) => {
            const t = v === null || v === undefined ? '' : String(v);
            // Quote, and neutralise leading = + - @ so spreadsheets don't run it as a formula.
            return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
          };
          const iso = (t) => (t ? new Date(t).toISOString() : '');
          const rows = [['project_team', 'requester', 'checked_in_at_desk', 'last_desk', 'last_check_in', 'last_check_out', 'check_ins', 'check_outs']];
          for (const team of engine.projectTeamSummary()) {
            for (const r of team.requesters) {
              rows.push([team.name, r.name, r.checkedInAt, r.lastSeatId, iso(r.lastCheckInAt), iso(r.lastCheckOutAt), r.checkins, r.checkouts]);
            }
          }
          res.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="requesters-by-project-team.csv"',
            'cache-control': 'no-store',
          });
          return res.end(rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
        }
        case '/api/stream':
          return openStream(req, res);
      }
    }
    throw new HttpError(404, 'Not found');
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof NotFoundError) return send(res, 404, { error: err.message });
      if (err instanceof ConflictError) return send(res, 409, { error: err.message });
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Internal error' });
    });
  });
  server.on('close', () => {
    for (const res of streams) res.end();
  });
  return server;
}
