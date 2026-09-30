// Translate uplinks from LoRaWAN network servers into sensor readings.
//
// Desk sensors (Milesight, Elsys, Browan, Pressac, ...) decode their payloads
// in the network server with the vendor's codec. The field that means "someone
// is at the desk" is named differently per vendor, so presenceFrom() accepts
// the common names and values.

const PRESENCE_KEYS = [
  'occupancy', 'occupied', 'occupancy_status', 'occupancystatus', 'desk_occupancy', 'deskoccupancy',
  'presence', 'present', 'pir', 'motion', 'status',
];
const TRUE_WORDS = new Set(['occupied', 'occupy', 'present', 'presence', 'trigger', 'triggered', 'motion', 'detected', 'yes', 'on', 'true', 'busy', 'in_use']);
const FALSE_WORDS = new Set(['vacant', 'free', 'idle', 'unoccupied', 'empty', 'none', 'no', 'off', 'false', 'clear', 'not_occupied', 'available']);

function presenceValue(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v > 0; // e.g. Elsys: 0 free, 1 pending, 2 occupied
  if (typeof v === 'string') {
    const w = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (TRUE_WORDS.has(w)) return true;
    if (FALSE_WORDS.has(w)) return false;
    if (/^\d+$/.test(w)) return Number(w) > 0;
  }
  return undefined;
}

/**
 * Find a presence reading in a decoded payload. Returns true/false, or
 * undefined when the payload has none (a battery or heartbeat message).
 */
export function presenceFrom(decoded) {
  if (!decoded || typeof decoded !== 'object') return undefined;
  const scan = (obj) => {
    const byKey = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
    for (const key of PRESENCE_KEYS) {
      if (!byKey.has(key)) continue;
      const v = byKey.get(key);
      const p = v && typeof v === 'object' ? scan(v) : presenceValue(v);
      if (p !== undefined) return p;
    }
    return undefined;
  };
  const top = scan(decoded);
  if (top !== undefined) return top;
  for (const v of Object.values(decoded)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = scan(v);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

const time = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
};

/**
 * The Things Stack (TTN) v3 webhook, "Uplink message".
 * Returns { ids, name, presence, at } or null when the message is not an uplink.
 * `ids` are candidate sensor ids in preference order: DevEUI, then device id.
 */
export function parseTtn(body) {
  const up = body?.uplink_message;
  const dev = body?.end_device_ids;
  if (!up || !dev) return null;
  return {
    ids: [dev.dev_eui, dev.device_id].filter(Boolean),
    name: dev.device_id ?? null,
    presence: presenceFrom(up.decoded_payload),
    at: time(up.received_at ?? body.received_at),
  };
}

/**
 * ChirpStack v4 HTTP integration. ChirpStack posts every event type to the
 * same URL with ?event=up|join|status|...; only "up" carries readings.
 */
export function parseChirpstack(body, event) {
  if (event && event !== 'up') return null;
  const dev = body?.deviceInfo;
  if (!dev) return null;
  return {
    ids: [dev.devEui, dev.deviceName].filter(Boolean),
    name: dev.deviceName ?? null,
    presence: presenceFrom(body.object),
    at: time(body.time),
  };
}
