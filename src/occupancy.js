import { EventEmitter } from 'node:events';

export const Status = Object.freeze({
  AVAILABLE: 'available',
  OCCUPIED: 'occupied',
  AWAY: 'away',
  OFFLINE: 'offline',
});

export const DEFAULT_RULES = Object.freeze({
  // Presence lost for less than this -> seat is held as "away" (lunch, a meeting).
  awayGraceMinutes: 20,
  // A QR check-in on a sensor seat must be confirmed by presence within this window.
  checkinConfirmMinutes: 15,
  // Seats without a (working) sensor: a check-in lasts this long unless renewed.
  checkinTtlMinutes: 240,
  // A sensor that has not reported for this long is considered offline.
  sensorOfflineMinutes: 15,
});

const MINUTE = 60_000;
const HISTORY_LIMIT = 24 * 60; // one sample per minute, 24h
const ACTIVITY_LIMIT = 200;

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/**
 * Pure function: the status of a seat at time `now`.
 * Sensor data wins when the sensor is healthy; check-ins are the fallback.
 */
export function deriveStatus(seat, now, rules = DEFAULT_RULES) {
  const hasSensor = Boolean(seat.sensorId);
  const sensorOffline =
    hasSensor && (!seat.lastSensorSeenAt || now - seat.lastSensorSeenAt > rules.sensorOfflineMinutes * MINUTE);

  if (hasSensor && !sensorOffline) {
    if (seat.presence) return Status.OCCUPIED;
    if (seat.checkedInAt && now - seat.checkedInAt < rules.checkinConfirmMinutes * MINUTE) {
      // Just checked in; give the sensor a chance to see them. If they had
      // already been sitting there and left, the away grace applies instead.
      if (!seat.lastPresenceAt || seat.lastPresenceAt < seat.checkedInAt) return Status.OCCUPIED;
    }
    if (seat.lastPresenceAt && now - seat.lastPresenceAt < rules.awayGraceMinutes * MINUTE) return Status.AWAY;
    return Status.AVAILABLE;
  }

  if (seat.checkedInAt && now - seat.checkedInAt < rules.checkinTtlMinutes * MINUTE) return Status.OCCUPIED;
  return sensorOffline ? Status.OFFLINE : Status.AVAILABLE;
}

/**
 * Expand the building layout into a flat list of seat definitions.
 *
 * A zone is either a plain grid (`rows` x `cols`, every cell a desk) or a
 * `map`: one string per row where ' ' is no desk, '.' is an unassigned desk
 * and any other character is a desk assigned to that code in `building.teams`.
 */
export function expandLayout(building) {
  const teams = building.teams ?? {};
  const seats = [];
  for (const floor of building.floors) {
    for (const zone of floor.zones) {
      const noSensor = new Set(zone.sensorless ?? []);
      const map = zone.map ?? Array.from({ length: zone.rows }, () => '.'.repeat(zone.cols));
      let n = 0;
      map.forEach((line, r) => {
        [...line].forEach((ch, c) => {
          if (ch === ' ') return;
          if (ch !== '.' && !teams[ch]) throw new Error(`Zone ${floor.id}-${zone.id}: unknown team code '${ch}'`);
          n++;
          const id = `${floor.id}-${zone.id}-${String(n).padStart(2, '0')}`;
          const sensored = zone.sensors !== false && !noSensor.has(id);
          const team = ch === '.' ? null : ch;
          seats.push({
            id,
            floor: floor.id,
            floorName: floor.name,
            zone: zone.id,
            zoneName: zone.name,
            row: r,
            col: c,
            team,
            teamName: team ? teams[team].name : null,
            teamColor: team ? teams[team].color : null,
            sensorId: sensored ? `S-${id}` : null,
          });
        });
      });
    }
  }
  return seats;
}

const STATE_FIELDS = ['presence', 'lastPresenceAt', 'lastSensorSeenAt', 'checkedInBy', 'checkedInAt'];

export class OccupancyEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object[]} opts.seats  seat definitions (see expandLayout)
   * @param {object} [opts.rules]  overrides for DEFAULT_RULES
   * @param {object} [opts.state]  persisted snapshot from snapshot()
   * @param {() => number} [opts.clock]
   */
  constructor({ seats, rules = {}, state = {}, clock = Date.now }) {
    super();
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.clock = clock;
    this.seats = new Map();
    this.bySensor = new Map();
    this.lastStatus = new Map();
    this.history = state.history ?? [];
    this.activity = state.activity ?? [];

    const saved = state.seats ?? {};
    for (const def of seats) {
      const seat = { ...def, presence: false, lastPresenceAt: null, lastSensorSeenAt: null, checkedInBy: null, checkedInAt: null };
      for (const f of STATE_FIELDS) if (saved[def.id]?.[f] !== undefined) seat[f] = saved[def.id][f];
      this.seats.set(seat.id, seat);
      if (seat.sensorId) this.bySensor.set(seat.sensorId, seat);
    }
    const now = this.clock();
    for (const seat of this.seats.values()) this.lastStatus.set(seat.id, deriveStatus(seat, now, this.rules));
  }

  getSeat(id) {
    const seat = this.seats.get(id);
    if (!seat) throw new NotFoundError(`Unknown seat ${id}`);
    return seat;
  }

  /**
   * Ingest a reading from a desk sensor. `presence` may be omitted for a
   * pure heartbeat (keeps the sensor marked online).
   */
  recordSensorEvent({ sensorId, presence, at }) {
    const seat = this.bySensor.get(sensorId);
    if (!seat) throw new NotFoundError(`Unknown sensor ${sensorId}`);
    const now = this.clock();
    const t = Math.min(Number.isFinite(at) ? at : now, now);
    if (seat.lastSensorSeenAt && t < seat.lastSensorSeenAt) return this.view(seat); // stale / out of order

    seat.lastSensorSeenAt = t;
    if (typeof presence === 'boolean') {
      // lastPresenceAt marks the last moment someone was known to be there:
      // refreshed while present and stamped once when they leave.
      if (presence || seat.presence) seat.lastPresenceAt = t;
      seat.presence = presence;
    }
    this.#refresh(seat, now);
    return this.view(seat);
  }

  checkIn(seatId, user) {
    if (!user) throw new ConflictError('user is required');
    const seat = this.getSeat(seatId);
    const now = this.clock();
    const status = deriveStatus(seat, now, this.rules);
    if (seat.checkedInBy && seat.checkedInBy !== user && status !== Status.AVAILABLE) {
      throw new ConflictError(`Seat ${seatId} is already taken`);
    }
    if (seat.checkedInBy && seat.checkedInBy !== user) this.#release(seat, now, 'auto-release');
    // One seat per person: checking in elsewhere releases the previous seat.
    for (const other of this.seats.values()) {
      if (other !== seat && other.checkedInBy === user) {
        this.#release(other, now, 'moved');
        this.#refresh(other, now);
      }
    }
    const renewing = seat.checkedInBy === user;
    seat.checkedInBy = user;
    seat.checkedInAt = now;
    if (!renewing) this.#log(now, seat, 'checkin', user);
    this.#refresh(seat, now);
    return this.view(seat);
  }

  checkOut(seatId, user) {
    const seat = this.getSeat(seatId);
    if (!seat.checkedInBy) return this.view(seat);
    if (user && seat.checkedInBy !== user) throw new ConflictError(`Seat ${seatId} is held by someone else`);
    const now = this.clock();
    this.#release(seat, now, 'checkout');
    // The person said they're leaving; don't hold the seat for the away grace.
    if (!seat.presence) seat.lastPresenceAt = null;
    this.#refresh(seat, now);
    return this.view(seat);
  }

  /** Re-evaluate every seat: auto-release expired seats, emit changes, sample history. */
  sweep() {
    const now = this.clock();
    for (const seat of this.seats.values()) this.#refresh(seat, now);
    const last = this.history.at(-1);
    if (!last || now - last.t >= MINUTE) {
      this.history.push({ t: now, ...this.counts(now) });
      if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    }
  }

  #refresh(seat, now) {
    let status = deriveStatus(seat, now, this.rules);
    if (status === Status.AVAILABLE && seat.checkedInBy) {
      this.#release(seat, now, 'auto-release');
      status = deriveStatus(seat, now, this.rules);
    }
    const prev = this.lastStatus.get(seat.id);
    if (prev !== status) {
      this.lastStatus.set(seat.id, status);
      this.#log(now, seat, 'status', `${prev} → ${status}`);
      this.emit('change', this.view(seat, now));
    }
  }

  #release(seat, now, reason) {
    const user = seat.checkedInBy;
    seat.checkedInBy = null;
    seat.checkedInAt = null;
    this.#log(now, seat, reason, user);
    this.emit('change', this.view(seat, now));
  }

  #log(at, seat, type, detail) {
    this.activity.push({ at, seatId: seat.id, type, detail: detail ?? null });
    if (this.activity.length > ACTIVITY_LIMIT) this.activity.splice(0, this.activity.length - ACTIVITY_LIMIT);
  }

  view(seat, now = this.clock()) {
    const status = deriveStatus(seat, now, this.rules);
    const sensorOnline = seat.sensorId
      ? Boolean(seat.lastSensorSeenAt) && now - seat.lastSensorSeenAt <= this.rules.sensorOfflineMinutes * MINUTE
      : null;
    let holdExpiresAt = null;
    if (status === Status.AWAY) holdExpiresAt = seat.lastPresenceAt + this.rules.awayGraceMinutes * MINUTE;
    else if (status === Status.OCCUPIED && !seat.presence && seat.checkedInAt) {
      const ttl = seat.sensorId && sensorOnline ? this.rules.checkinConfirmMinutes : this.rules.checkinTtlMinutes;
      holdExpiresAt = seat.checkedInAt + ttl * MINUTE;
    }
    return {
      id: seat.id,
      floor: seat.floor,
      floorName: seat.floorName,
      zone: seat.zone,
      zoneName: seat.zoneName,
      row: seat.row,
      col: seat.col,
      team: seat.team,
      teamName: seat.teamName,
      status,
      hasSensor: Boolean(seat.sensorId),
      sensorOnline,
      presence: seat.presence,
      checkedInBy: seat.checkedInBy,
      checkedInAt: seat.checkedInAt,
      lastPresenceAt: seat.lastPresenceAt,
      holdExpiresAt,
    };
  }

  list({ floor, zone, status, team } = {}) {
    const now = this.clock();
    const out = [];
    for (const seat of this.seats.values()) {
      if (floor && seat.floor !== floor) continue;
      if (zone && seat.zone !== zone) continue;
      if (team && seat.team !== team) continue;
      const v = this.view(seat, now);
      if (status && v.status !== status) continue;
      out.push(v);
    }
    return out;
  }

  counts(now = this.clock(), filter = () => true) {
    const c = { total: 0, available: 0, occupied: 0, away: 0, offline: 0 };
    for (const seat of this.seats.values()) {
      if (!filter(seat)) continue;
      c.total++;
      c[deriveStatus(seat, now, this.rules)]++;
    }
    return c;
  }

  summary() {
    const now = this.clock();
    const floors = new Map();
    for (const seat of this.seats.values()) {
      if (!floors.has(seat.floor)) floors.set(seat.floor, { id: seat.floor, name: seat.floorName, zones: new Map() });
      floors.get(seat.floor).zones.set(seat.zone, seat.zoneName);
    }
    const teams = new Map();
    for (const seat of this.seats.values()) {
      const key = seat.team ?? '';
      if (!teams.has(key)) teams.set(key, { id: seat.team, name: seat.teamName ?? 'Unassigned (open hot desks)', color: seat.teamColor });
    }
    const withRate = (c) => ({ ...c, occupancyRate: c.total ? (c.occupied + c.away) / c.total : 0 });
    return {
      at: now,
      rules: this.rules,
      overall: withRate(this.counts(now)),
      floors: [...floors.values()].map((f) => ({
        id: f.id,
        name: f.name,
        ...withRate(this.counts(now, (s) => s.floor === f.id)),
        zones: [...f.zones].map(([id, name]) => ({
          id,
          name,
          ...withRate(this.counts(now, (s) => s.floor === f.id && s.zone === id)),
        })),
      })),
      teams: [...teams.values()].sort((a, b) => (a.id === null) - (b.id === null)).map((t) => ({ ...t, ...withRate(this.counts(now, (s) => s.team === t.id)) })),
    };
  }

  snapshot() {
    const seats = {};
    for (const seat of this.seats.values()) {
      seats[seat.id] = Object.fromEntries(STATE_FIELDS.map((f) => [f, seat[f]]));
    }
    return { seats, history: this.history, activity: this.activity };
  }
}
