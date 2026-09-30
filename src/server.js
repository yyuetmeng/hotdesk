import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { ConflictError, NotFoundError } from './occupancy.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
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

/** What employees may see: status only, never who is sitting where. */
function publicView(v) {
  const { checkedInBy, checkedInAt, presence, lastPresenceAt, ...rest } = v;
  return rest;
}

/**
 * @param {object} opts
 * @param {import('./occupancy.js').OccupancyEngine} opts.engine
 * @param {string} opts.publicDir
 * @param {string} [opts.sensorApiKey]  required in X-Api-Key for sensor ingestion when set
 * @param {string} [opts.adminToken]    required for admin endpoints when set
 */
export function createApp({ engine, publicDir, sensorApiKey, adminToken }) {
  const streams = new Set();

  engine.on('change', (seat) => {
    const payload = `event: seat\ndata: ${JSON.stringify(seat)}\n\n`;
    for (const res of streams) res.write(payload);
  });

  const requireAdmin = (req, url) => {
    if (!adminToken) return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    if (!token || !safeEqual(token, adminToken)) throw new HttpError(401, 'Admin token required');
  };

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
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
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
    if (method === 'GET' && parts[0] === 'static') return serveStatic(res, parts.slice(1).join('/'));
    if (method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });

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

    // --- Employee endpoints (QR code on each desk opens /checkin?seat=ID) ---
    if (method === 'GET' && url.pathname === '/api/availability') {
      return send(res, 200, engine.list({ floor: url.searchParams.get('floor') ?? undefined }).map(publicView));
    }
    if (parts[1] === 'seats' && parts[2] && parts.length === 4 && method === 'POST') {
      const body = await readJson(req);
      const user = typeof body.user === 'string' ? body.user.trim().slice(0, 100) : '';
      if (parts[3] === 'checkin') {
        if (!user) throw new HttpError(400, 'user is required');
        return send(res, 200, publicView(engine.checkIn(parts[2], user)));
      }
      if (parts[3] === 'checkout') return send(res, 200, publicView(engine.checkOut(parts[2], user || undefined)));
    }
    if (method === 'GET' && parts[1] === 'seats' && parts[2] && parts.length === 3) {
      return send(res, 200, publicView(engine.view(engine.getSeat(parts[2]))));
    }

    // --- Administrator endpoints ---
    if (method === 'GET') {
      requireAdmin(req, url);
      const q = Object.fromEntries(['floor', 'zone', 'status'].map((k) => [k, url.searchParams.get(k) ?? undefined]));
      switch (url.pathname) {
        case '/api/seats':
          return send(res, 200, engine.list(q));
        case '/api/summary':
          return send(res, 200, engine.summary());
        case '/api/history':
          return send(res, 200, engine.history);
        case '/api/activity':
          return send(res, 200, engine.activity.slice(-100).reverse());
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
      console.error(err);
      send(res, 500, { error: 'Internal error' });
    });
  });
  server.on('close', () => {
    for (const res of streams) res.end();
  });
  return server;
}
