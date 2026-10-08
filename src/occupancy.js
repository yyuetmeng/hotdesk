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
  // How long a check-in holds a desk unless the user picks another duration or scans again to renew.
  checkinDurationMinutes: 180,
  // Longest duration a user may pick for a single check-in.
  checkinMaxMinutes: 480,
  // A sensor that has not reported for this long is considered offline.
  sensorOfflineMinutes: 15,
});

/** Project teams requesters choose from when they check in or out (config/building.json "projectTeams"). */
export const DEFAULT_PROJECT_TEAMS = Object.freeze(['External', 'Bolt On', 'eWorkplace', 'G&C', 'STREAM', 'SAP', 'ITGC', 'DDAP']);

/** Short label shown on a desk: the name if short, else initials, else the first three letters. */
export function teamCode(name) {
  if (name.length <= 4) return name;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0]).join('').toUpperCase().slice(0, 4) : name.slice(0, 3).toUpperCase();
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Normalise the configured teams: each entry is a name or { name, code?, color? }.
 * `slot` is the team's position, which the dashboard maps to its colour palette
 * unless an explicit color is configured.
 */
function parseProjectTeams(list) {
  const seen = new Set();
  const teams = [];
  for (const entry of list) {
    const t = typeof entry === 'string' ? { name: entry } : entry ?? {};
    const name = String(t.name ?? '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const code = String(t.code ?? '').trim().slice(0, 4) || teamCode(name);
    if (t.color !== undefined && t.color !== null && !HEX.test(t.color)) throw new Error(`Project team ${name}: color must look like #1a2b3c`);
    // A saved list keeps each team's slot, so deleting one doesn't shift the others' default colours.
    const slot = Number.isInteger(t.slot) && !teams.some((x) => x.slot === t.slot) ? t.slot : nextSlot(teams);
    teams.push({ name, code, color: t.color ?? null, slot });
  }
  return teams;
}

const nextSlot = (teams) => teams.reduce((m, t) => Math.max(m, t.slot + 1), 0);
const MAX_PROJECT_NAME = 40;

const MINUTE = 60_000;
const TEAM_DAYS_KEPT = 62;
const HISTORY_LIMIT = 24 * 60; // one sample per minute, 24h
const HOUR = 60 * 60_000;
const HOURLY_LIMIT = 30 * 24;  // hourly averages, 30 days
/** Chart periods: minutes of history, and whether hourly averages are used instead of minute samples. */
export const HISTORY_PERIODS = { '1h': 60, '6h': 6 * 60, '24h': 24 * 60, '7d': 7 * 24 * 60, '30d': 30 * 24 * 60 };
const COUNT_FIELDS = ['total', 'available', 'occupied', 'away', 'offline'];
const ACTIVITY_LIMIT = 200;
const UNLINKED_LIMIT = 500;

/** Sensor IDs are compared case-insensitively (DevEUIs and MACs are written both ways). */
export function normalizeSensorId(id) {
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return String(id).trim().toUpperCase() || null;
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {}

/**
 * Pure function: the status of a seat at time `now`.
 * Sensor data wins when the sensor is healthy; check-ins are the fallback.
 */
/**
 * Does this desk have a sensor? A placeholder id from the layout (S-<desk>)
 * only counts once a device has actually reported under it, so desks
 * without hardware yet behave as QR-only desks instead of "offline".
 */
export function hasSensor(seat) {
  return Boolean(seat.sensorId) && !(seat.placeholderSensor && !seat.lastSensorSeenAt);
}

export function deriveStatus(seat, now, rules = DEFAULT_RULES) {
  const hasSensor_ = hasSensor(seat);
  const checkedIn = Boolean(seat.checkedInAt) && now < seat.checkedInUntil;
  const sensorOffline =
    hasSensor_ && (!seat.lastSensorSeenAt || now - seat.lastSensorSeenAt > rules.sensorOfflineMinutes * MINUTE);

  if (hasSensor_ && !sensorOffline) {
    if (seat.presence) return Status.OCCUPIED;
    // Booked for a team: held for the whole booking, whether or not anyone has sat down yet.
    if (checkedIn && seat.teamBooking) return Status.OCCUPIED;
    if (checkedIn && now - seat.checkedInAt < rules.checkinConfirmMinutes * MINUTE) {
      // Just checked in; give the sensor a chance to see them. If they had
      // already been sitting there and left, the away grace applies instead.
      if (!seat.lastPresenceAt || seat.lastPresenceAt < seat.checkedInAt) return Status.OCCUPIED;
    }
    if (seat.lastPresenceAt && now - seat.lastPresenceAt < rules.awayGraceMinutes * MINUTE) return Status.AWAY;
    return Status.AVAILABLE;
  }

  if (checkedIn) return Status.OCCUPIED;
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

const STATE_FIELDS = ['presence', 'lastPresenceAt', 'lastSensorSeenAt', 'checkedInBy', 'checkedInAt', 'checkedInUntil', 'checkedInTeam', 'teamBooking'];
const MAX_BOOKING_SEATS = 100;

/** Calendar day in the server's time zone (TZ), e.g. 2026-10-05. */
const dayKey = (t) => new Date(t).toLocaleDateString('en-CA');

export class OccupancyEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object[]} opts.seats  seat definitions (see expandLayout)
   * @param {object} [opts.rules]  overrides for DEFAULT_RULES
   * @param {object} [opts.state]  persisted snapshot from snapshot(); its `sensorLinks`
   *   (desk id -> sensor id, or null for none) override the layout's default sensor ids
   * @param {(string|{name: string, code?: string, color?: string})[]} [opts.projectTeams]
   *   teams requesters must pick from (default DEFAULT_PROJECT_TEAMS). Once the list has
   *   been edited in the dashboard, the saved list in `state.projects` is used instead.
   * @param {() => number} [opts.clock]
   */
  constructor({ seats, rules = {}, state = {}, clock = Date.now, projectTeams = DEFAULT_PROJECT_TEAMS }) {
    super();
    this.rules = { ...DEFAULT_RULES, ...rules };
    // The project list as edited in the dashboard wins over the configured one.
    this.projectsEdited = Array.isArray(state.projects) && state.projects.length > 0;
    this.projectTeamInfo = parseProjectTeams(this.projectsEdited ? state.projects : projectTeams);
    this.projectTeams = this.projectTeamInfo.map((t) => t.name);
    if (!this.projectTeams.length) throw new Error('At least one project team is required');
    // Everyone who has checked in, by lower-cased name: their project team and last desk.
    this.requesters = new Map(Object.entries(state.requesters ?? {}));
    // Check-ins and check-outs per project team per day: { '2026-10-05': { 'SAP': { checkins, checkouts } } }
    this.teamDays = state.teamDays ?? {};
    this.clock = clock;
    this.seats = new Map();
    this.bySensor = new Map();
    this.lastStatus = new Map();
    this.history = state.history ?? [];
    // Hourly sums for the longer chart periods: { t, n, total, available, occupied, away, offline, peak }.
    this.hourly = state.hourly ?? [];
    this.activity = state.activity ?? [];
    this.sensorLinks = { ...(state.sensorLinks ?? {}) };
    // Sensors that report but are not linked to any desk yet, so an admin can link them.
    this.unlinked = new Map(Object.entries(state.unlinkedSensors ?? {}));

    const saved = state.seats ?? {};
    for (const def of seats) {
      const linked = def.id in this.sensorLinks ? this.sensorLinks[def.id] : def.sensorId;
      const seat = { ...def, sensorId: normalizeSensorId(linked), placeholderSensor: !(def.id in this.sensorLinks) && Boolean(def.sensorId), presence: false, lastPresenceAt: null, lastSensorSeenAt: null, checkedInBy: null, checkedInAt: null, checkedInUntil: null, checkedInTeam: null, teamBooking: false };
      for (const f of STATE_FIELDS) if (saved[def.id]?.[f] !== undefined) seat[f] = saved[def.id][f];
      // State saved before check-ins had an end time: give them the default duration.
      if (seat.checkedInAt && !seat.checkedInUntil) seat.checkedInUntil = seat.checkedInAt + this.rules.checkinDurationMinutes * MINUTE;
      this.seats.set(seat.id, seat);
      if (seat.sensorId) this.bySensor.set(seat.sensorId, seat);
    }
    // Seats pre-allocated to a project (seat id -> project name), for pre-booking.
    this.allocations = new Map(Object.entries(state.allocations ?? {})
      .filter(([id, team]) => this.seats.has(id) && this.projectTeams.includes(team)));
    const now = this.clock();
    for (const seat of this.seats.values()) this.lastStatus.set(seat.id, deriveStatus(seat, now, this.rules));
  }

  // ---------- Projects and seat pre-allocation ----------

  /** Every project with its code, colour and pre-allocated seats. */
  listProjects() {
    return this.projectTeamInfo.map((t) => ({
      ...t,
      seats: [...this.allocations].filter(([, team]) => team === t.name).map(([id]) => id).sort(),
    }));
  }

  #findProject(name) {
    const wanted = String(name ?? '').trim().toLowerCase();
    const t = this.projectTeamInfo.find((x) => x.name.toLowerCase() === wanted);
    if (!t) throw new NotFoundError(`Unknown project "${name}"`);
    return t;
  }

  #checkColor(color) {
    if (color === undefined || color === null || color === '') return null;
    if (!HEX.test(color)) throw new ValidationError('Colour must look like #1a2b3c');
    return color.toLowerCase();
  }

  #projectsChanged() {
    this.projectsEdited = true;
    this.projectTeams = this.projectTeamInfo.map((t) => t.name);
    this.emit('projects', this.listProjects());
  }

  /** Add a project people can check in under and seats can be allocated to. */
  addProject({ name, code, color } = {}) {
    name = String(name ?? '').trim();
    if (!name) throw new ValidationError('Project name is required');
    if (name.length > MAX_PROJECT_NAME) throw new ValidationError(`Project name must be at most ${MAX_PROJECT_NAME} characters`);
    if (this.projectTeams.some((t) => t.toLowerCase() === name.toLowerCase())) throw new ConflictError(`Project "${name}" already exists`);
    const t = { name, code: String(code ?? '').trim().slice(0, 4) || teamCode(name), color: this.#checkColor(color), slot: nextSlot(this.projectTeamInfo) };
    this.projectTeamInfo.push(t);
    this.#projectsChanged();
    return this.listProjects().find((p) => p.name === name);
  }

  /** Change a project's short code or colour. */
  updateProject(name, { code, color } = {}) {
    const t = this.#findProject(name);
    if (code !== undefined) t.code = String(code ?? '').trim().slice(0, 4) || teamCode(t.name);
    if (color !== undefined) t.color = this.#checkColor(color);
    this.#projectsChanged();
    return this.listProjects().find((p) => p.name === t.name);
  }

  /**
   * Remove a project from the list and release its allocated seats. People already
   * checked in under it stay checked in, and its history stays in the reports.
   */
  deleteProject(name) {
    const t = this.#findProject(name);
    if (this.projectTeamInfo.length === 1) throw new ValidationError('At least one project is required');
    this.projectTeamInfo = this.projectTeamInfo.filter((x) => x !== t);
    const released = [...this.allocations].filter(([, team]) => team === t.name).map(([id]) => id);
    for (const id of released) this.allocations.delete(id);
    this.#projectsChanged();
    this.#seatsChanged(released);
    return { name: t.name, released };
  }

  /**
   * Set the seats pre-allocated to a project (replacing its previous set). A seat can
   * belong to only one project: seats held by another project are refused.
   */
  allocateSeats(name, seatIds) {
    const t = this.#findProject(name);
    if (!Array.isArray(seatIds)) throw new ValidationError('seats must be a list of seat ids');
    const ids = [...new Set(seatIds.map((id) => String(id ?? '').trim().toUpperCase()).filter(Boolean))];
    const unknown = ids.filter((id) => !this.seats.has(id));
    if (unknown.length) throw new ValidationError(`Unknown seats: ${unknown.join(', ')}`);
    const taken = ids.filter((id) => this.allocations.has(id) && this.allocations.get(id) !== t.name);
    if (taken.length) {
      throw new ConflictError(`Already allocated to another project: ${taken.map((id) => `${id} (${this.allocations.get(id)})`).join(', ')}`);
    }
    const before = [...this.allocations].filter(([, team]) => team === t.name).map(([id]) => id);
    for (const id of before) this.allocations.delete(id);
    for (const id of ids) this.allocations.set(id, t.name);
    this.#projectsChanged();
    this.#seatsChanged([...new Set([...before, ...ids])].filter((id) => before.includes(id) !== ids.includes(id)));
    return this.listProjects().find((p) => p.name === t.name);
  }

  /** Tell listeners (live dashboards, persistence) that these seats' views changed. */
  #seatsChanged(ids) {
    const now = this.clock();
    for (const id of ids) this.emit('change', this.view(this.seats.get(id), now));
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
  recordSensorEvent({ sensorId, presence, at, name }) {
    const id = normalizeSensorId(sensorId);
    const seat = this.bySensor.get(id);
    const now = this.clock();
    if (!seat) {
      if (id) this.#noteUnlinked(id, { presence, at: now, name });
      throw new NotFoundError(`Sensor ${sensorId} is not linked to a desk`);
    }
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

  /**
   * Check `user` in at a desk for `minutes` (default: checkinDurationMinutes).
   * Checking in again at the same desk renews the check-in from now.
   */
  /** Is this sensor id linked to a desk? */
  isLinked(sensorId) {
    return this.bySensor.has(normalizeSensorId(sensorId));
  }

  /**
   * Link a sensor to a desk (or unlink with a null sensorId). A sensor can only
   * be on one desk: linking it here removes it from any other desk.
   */
  linkSensor(seatId, sensorId) {
    const seat = this.getSeat(seatId);
    const id = normalizeSensorId(sensorId);
    const now = this.clock();
    if (id === seat.sensorId) return this.view(seat, now);
    const previous = id && this.bySensor.get(id);
    if (previous) {
      this.#setSensor(previous, null);
      this.#log(now, previous, 'sensor', `${id} moved to ${seat.id}`);
      this.#refresh(previous, now);
    }
    this.#setSensor(seat, id);
    this.unlinked.delete(id);
    this.#log(now, seat, 'sensor', id ? `linked ${id}` : 'sensor unlinked');
    this.#refresh(seat, now);
    this.emit('change', this.view(seat, now));
    return this.view(seat, now);
  }

  #setSensor(seat, id) {
    if (seat.sensorId) this.bySensor.delete(seat.sensorId);
    seat.sensorId = id;
    seat.placeholderSensor = false;
    if (id) this.bySensor.set(id, seat);
    this.sensorLinks[seat.id] = id;
    // Readings from the old sensor say nothing about the new one.
    seat.presence = false;
    seat.lastPresenceAt = null;
    seat.lastSensorSeenAt = null;
  }

  #noteUnlinked(id, { presence, at, name }) {
    const prev = this.unlinked.get(id);
    this.unlinked.delete(id); // re-insert so the map stays ordered by last report
    this.unlinked.set(id, {
      sensorId: id,
      name: name ?? prev?.name ?? null,
      firstSeenAt: prev?.firstSeenAt ?? at,
      lastSeenAt: at,
      presence: typeof presence === 'boolean' ? presence : (prev?.presence ?? null),
      reports: (prev?.reports ?? 0) + 1,
    });
    if (this.unlinked.size > UNLINKED_LIMIT) this.unlinked.delete(this.unlinked.keys().next().value);
    if (!prev) this.emit('unlinked', this.unlinked.get(id));
  }

  /** Every desk's sensor link and health, plus sensors reporting without a desk. */
  sensorReport() {
    const now = this.clock();
    return {
      desks: [...this.seats.values()].map((seat) => {
        const v = this.view(seat, now);
        return {
          id: v.id,
          floorName: v.floorName,
          zoneName: v.zoneName,
          sensorId: v.sensorId,
          // A device named after this desk in the network server links itself.
          placeholderId: seat.placeholderSensor && !seat.lastSensorSeenAt ? seat.sensorId : null,
          sensorOnline: v.sensorOnline,
          lastSensorSeenAt: seat.lastSensorSeenAt,
          presence: seat.presence,
          status: v.status,
        };
      }),
      unlinked: [...this.unlinked.values()].reverse(),
    };
  }

  /** The canonical spelling of a project team, or a ValidationError listing the choices. */
  projectTeam(name) {
    const wanted = String(name ?? '').trim().toLowerCase();
    if (!wanted) throw new ValidationError(`Project team is required (one of: ${this.projectTeams.join(', ')})`);
    const team = this.projectTeams.find((t) => t.toLowerCase() === wanted);
    if (!team) throw new ValidationError(`Unknown project team "${name}" (choose one of: ${this.projectTeams.join(', ')})`);
    return team;
  }

  checkIn(seatId, user, { minutes = this.rules.checkinDurationMinutes, team } = {}) {
    if (!user) throw new ValidationError('user is required');
    team = this.projectTeam(team);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > this.rules.checkinMaxMinutes) {
      throw new ValidationError(`Check-in duration must be between 1 and ${this.rules.checkinMaxMinutes} minutes`);
    }
    const seat = this.getSeat(seatId);
    const now = this.clock();
    const status = deriveStatus(seat, now, this.rules);
    if (seat.checkedInBy && seat.checkedInBy !== user && status !== Status.AVAILABLE) {
      throw new ConflictError(`Seat ${seatId} is already taken`);
    }
    if (seat.checkedInBy && seat.checkedInBy !== user) this.#release(seat, now, 'auto-release');
    const renewing = seat.checkedInBy === user;
    // Extending a seat booked for the team keeps it a team booking.
    const teamBooking = renewing && seat.teamBooking;
    // One seat per person: checking in elsewhere releases the person's previous seat.
    // Seats they booked for their team are not theirs to sit in, so they are kept.
    if (!teamBooking) {
      for (const other of this.seats.values()) {
        if (other !== seat && other.checkedInBy === user && !other.teamBooking) {
          this.#release(other, now, 'moved');
          this.#refresh(other, now);
        }
      }
    }
    seat.checkedInBy = user;
    seat.checkedInAt = now;
    seat.checkedInUntil = now + minutes * MINUTE;
    seat.checkedInTeam = team;
    seat.teamBooking = teamBooking;
    this.#log(now, seat, renewing ? 'renew' : 'checkin', user, team);
    if (!renewing) this.#countTeam(now, team, 'checkins');
    this.#noteRequester(user, team, now, { seatId: seat.id, checkin: !renewing });
    this.#refresh(seat, now);
    return this.view(seat);
  }

  /**
   * Book several seats for a project team under one person's name. All or nothing: if any
   * seat is unknown or taken, none are booked. Team-booked seats are held for the whole
   * booking (no 15-minute no-show release) and are exempt from the one-seat rule, so the
   * booker can still check in somewhere for themselves. Seats the same person already holds
   * are renewed.
   */
  bookSeats(seatIds, user, { minutes = this.rules.checkinDurationMinutes, team, maxSeats = MAX_BOOKING_SEATS } = {}) {
    if (!user) throw new ValidationError('user is required');
    team = this.projectTeam(team);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > this.rules.checkinMaxMinutes) {
      throw new ValidationError(`Booking duration must be between 1 and ${this.rules.checkinMaxMinutes} minutes`);
    }
    if (!Array.isArray(seatIds)) throw new ValidationError('seats must be a list of seat ids');
    const ids = [...new Set(seatIds.map((id) => String(id ?? '').trim().toUpperCase()).filter(Boolean))];
    if (!ids.length) throw new ValidationError('Choose at least one seat');
    if (ids.length > maxSeats) throw new ValidationError(`At most ${maxSeats} seats can be booked at once`);
    const unknown = ids.filter((id) => !this.seats.has(id));
    if (unknown.length) throw new ValidationError(`Unknown seats: ${unknown.join(', ')}`);
    const now = this.clock();
    // Someone else's check-in, or a person sitting there, makes a seat unavailable.
    const taken = ids.filter((id) => {
      const seat = this.seats.get(id);
      if (seat.checkedInBy === user) return false;
      const status = deriveStatus(seat, now, this.rules);
      return status === Status.OCCUPIED || status === Status.AWAY;
    });
    if (taken.length) throw new ConflictError(`Already taken: ${taken.join(', ')}`);
    for (const id of ids) {
      const seat = this.seats.get(id);
      if (seat.checkedInBy && seat.checkedInBy !== user) this.#release(seat, now, 'auto-release');
      const renewing = seat.checkedInBy === user;
      seat.checkedInBy = user;
      seat.checkedInAt = now;
      seat.checkedInUntil = now + minutes * MINUTE;
      seat.checkedInTeam = team;
      seat.teamBooking = true;
      this.#log(now, seat, renewing ? 'renew' : 'book', user, team);
      if (!renewing) this.#countTeam(now, team, 'checkins');
      this.#noteRequester(user, team, now, { seatId: seat.id, checkin: !renewing });
      this.#refresh(seat, now);
    }
    return ids.map((id) => this.view(this.seats.get(id), now));
  }

  /**
   * Who is in today, for the floor display's colleague finder: one entry per person (per project) who
   * is checked in or has booked desks. People sitting without a check-in are anonymous and not listed.
   * Status: `onsite` (at the desk, or checked in at a desk without a sensor), `away` (stepped away,
   * desk held), `booked` (checked in but not seen at the desk yet), `team` (desks booked for the team).
   */
  peopleIn(now = this.clock()) {
    const people = new Map();
    for (const seat of this.seats.values()) {
      if (!seat.checkedInBy) continue;
      const v = this.view(seat, now);
      if (v.status !== Status.OCCUPIED && v.status !== Status.AWAY && v.status !== Status.OFFLINE) continue;
      const key = `${seat.checkedInBy.toLowerCase()}|${seat.checkedInTeam ?? ''}|${seat.teamBooking ? 'team' : ''}`;
      if (!people.has(key)) {
        people.set(key, { name: seat.checkedInBy, team: seat.checkedInTeam ?? null, teamBooking: Boolean(seat.teamBooking), seats: [], since: seat.checkedInAt, until: seat.checkedInUntil });
      }
      const p = people.get(key);
      const status = v.status === Status.AWAY ? 'away'
        : seat.presence || !hasSensor(seat) || v.status === Status.OFFLINE ? 'onsite' : 'booked';
      p.seats.push({ id: seat.id, floor: seat.floor, floorName: seat.floorName, zone: seat.zone, zoneName: seat.zoneName, status });
      p.since = Math.min(p.since, seat.checkedInAt);
      p.until = Math.max(p.until, seat.checkedInUntil);
    }
    const rank = { onsite: 0, away: 1, booked: 2 };
    return [...people.values()].map((p) => {
      p.seats.sort((a, b) => a.id.localeCompare(b.id));
      // A person at a single desk takes that desk's status; a team booking is listed as such.
      p.status = p.teamBooking ? 'team' : p.seats.map((s) => s.status).sort((a, b) => rank[a] - rank[b])[0];
      return p;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Clear every seat's live state (presence, away holds, check-ins and team bookings) so
   * the floor starts empty, e.g. to restart a demo. Projects, seat allocations, sensor links,
   * history and reports are kept. Readings from real sensors bring presence back at once.
   */
  resetSeats() {
    const now = this.clock();
    let cleared = 0;
    for (const seat of this.seats.values()) {
      if (seat.presence || seat.lastPresenceAt || seat.checkedInBy) cleared++;
      seat.presence = false;
      seat.lastPresenceAt = null;
      seat.checkedInBy = null;
      seat.checkedInAt = null;
      seat.checkedInUntil = null;
      seat.checkedInTeam = null;
      seat.teamBooking = false;
      this.lastStatus.set(seat.id, deriveStatus(seat, now, this.rules));
      this.emit('change', this.view(seat, now));
    }
    return { cleared };
  }

  checkOut(seatId, user, { team } = {}) {
    team = this.projectTeam(team);
    const seat = this.getSeat(seatId);
    if (!seat.checkedInBy) return this.view(seat);
    if (user && seat.checkedInBy !== user) throw new ConflictError(`Seat ${seatId} is held by someone else`);
    const now = this.clock();
    const who = seat.checkedInBy;
    seat.checkedInTeam = team; // the team given at check-out is the one recorded
    this.#release(seat, now, 'checkout');
    this.#countTeam(now, team, 'checkouts');
    this.#noteRequester(who, team, now, { checkout: true });
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
      const sample = { t: now, ...this.counts(now) };
      this.history.push(sample);
      if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
      this.#addHourly(sample);
    }
  }

  #addHourly(sample) {
    const t = sample.t - (sample.t % HOUR);
    let b = this.hourly.at(-1);
    if (!b || b.t !== t) {
      b = { t, n: 0, ...Object.fromEntries(COUNT_FIELDS.map((f) => [f, 0])), peak: 0 };
      this.hourly.push(b);
      if (this.hourly.length > HOURLY_LIMIT) this.hourly.splice(0, this.hourly.length - HOURLY_LIMIT);
    }
    b.n++;
    for (const f of COUNT_FIELDS) b[f] += sample[f];
    if (sample.total) b.peak = Math.max(b.peak, (sample.occupied + sample.away) / sample.total);
  }

  /**
   * Occupancy samples for a chart period (see HISTORY_PERIODS): minute samples up to 24 hours,
   * hourly averages (with each hour's peak rate) beyond that.
   */
  historyFor(period, now = this.clock()) {
    const minutes = HISTORY_PERIODS[period];
    if (!minutes) throw new ValidationError(`Unknown period "${period}". Use one of: ${Object.keys(HISTORY_PERIODS).join(', ')}`);
    const from = now - minutes * MINUTE;
    if (minutes <= 24 * 60) return this.history.filter((h) => h.t >= from);
    return this.hourly.filter((b) => b.t + HOUR > from && b.n).map((b) => ({
      t: b.t, hourly: true, peak: Math.round(b.peak * 1000) / 1000,
      ...Object.fromEntries(COUNT_FIELDS.map((f) => [f, Math.round((b[f] / b.n) * 10) / 10])),
    }));
  }

  #refresh(seat, now) {
    if (seat.checkedInBy && now >= seat.checkedInUntil) this.#release(seat, now, 'expired');
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
    const team = seat.checkedInTeam;
    seat.checkedInBy = null;
    seat.checkedInAt = null;
    seat.checkedInUntil = null;
    seat.checkedInTeam = null;
    seat.teamBooking = false;
    this.#log(now, seat, reason, user, team);
    this.emit('change', this.view(seat, now));
  }

  #countTeam(now, team, field) {
    const day = (this.teamDays[dayKey(now)] ??= {});
    const counts = (day[team] ??= { checkins: 0, checkouts: 0 });
    counts[field]++;
    const days = Object.keys(this.teamDays).sort();
    for (const old of days.slice(0, Math.max(0, days.length - TEAM_DAYS_KEPT))) delete this.teamDays[old];
  }

  #noteRequester(name, team, now, { seatId, checkin, checkout } = {}) {
    const key = name.trim().toLowerCase();
    const r = this.requesters.get(key) ?? { name, team, checkins: 0, checkouts: 0, firstSeenAt: now };
    r.name = name;
    r.team = team;
    if (seatId) r.lastSeatId = seatId;
    if (checkin) {
      r.checkins++;
      r.lastCheckInAt = now;
    }
    if (checkout) {
      r.checkouts++;
      r.lastCheckOutAt = now;
    }
    this.requesters.set(key, r);
  }

  /**
   * Requesters grouped by project team, with today's check-in/out counts and
   * who is checked in right now. Teams no longer in the list but still in the
   * data are added at the end so nothing disappears from reports.
   */
  projectTeamSummary() {
    const now = this.clock();
    const today = this.teamDays[dayKey(now)] ?? {};
    const current = new Map(); // lower-cased name -> seat
    for (const seat of this.seats.values()) {
      if (seat.checkedInBy) current.set(seat.checkedInBy.trim().toLowerCase(), seat);
    }
    const names = [...this.projectTeams];
    for (const r of this.requesters.values()) if (!names.includes(r.team)) names.push(r.team);
    for (const seat of current.values()) if (seat.checkedInTeam && !names.includes(seat.checkedInTeam)) names.push(seat.checkedInTeam);
    return names.map((name) => {
      const requesters = [...this.requesters.entries()]
        .filter(([, r]) => r.team === name)
        .map(([key, r]) => {
          const seat = current.get(key);
          return {
            name: r.name,
            checkedInAt: seat ? seat.id : null,
            checkedInUntil: seat ? seat.checkedInUntil : null,
            lastSeatId: r.lastSeatId ?? null,
            lastCheckInAt: r.lastCheckInAt ?? null,
            lastCheckOutAt: r.lastCheckOutAt ?? null,
            checkins: r.checkins,
            checkouts: r.checkouts,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const info = this.projectTeamInfo.find((t) => t.name === name);
      return {
        name,
        code: info?.code ?? teamCode(name),
        color: info?.color ?? null,
        slot: info?.slot ?? null, // null: no longer offered, shown in a neutral colour
        configured: Boolean(info),
        checkedInNow: [...current.values()].filter((s) => s.checkedInTeam === name).length,
        checkinsToday: today[name]?.checkins ?? 0,
        checkoutsToday: today[name]?.checkouts ?? 0,
        requesters,
      };
    });
  }

  #log(at, seat, type, detail, team) {
    const entry = { at, seatId: seat.id, type, detail: detail ?? null };
    if (team) entry.team = team;
    this.activity.push(entry);
    if (this.activity.length > ACTIVITY_LIMIT) this.activity.splice(0, this.activity.length - ACTIVITY_LIMIT);
  }

  view(seat, now = this.clock()) {
    const status = deriveStatus(seat, now, this.rules);
    const sensorOnline = hasSensor(seat)
      ? Boolean(seat.lastSensorSeenAt) && now - seat.lastSensorSeenAt <= this.rules.sensorOfflineMinutes * MINUTE
      : null;
    let holdExpiresAt = null;
    if (status === Status.AWAY) holdExpiresAt = seat.lastPresenceAt + this.rules.awayGraceMinutes * MINUTE;
    else if (status === Status.OCCUPIED && !seat.presence && seat.checkedInAt) {
      // Unconfirmed check-in on a working sensor ends early if nobody sits down; a team booking doesn't.
      holdExpiresAt = seat.sensorId && sensorOnline && !seat.teamBooking
        ? Math.min(seat.checkedInAt + this.rules.checkinConfirmMinutes * MINUTE, seat.checkedInUntil)
        : seat.checkedInUntil;
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
      hasSensor: hasSensor(seat),
      sensorId: hasSensor(seat) ? seat.sensorId : null,
      sensorOnline,
      lastSensorSeenAt: seat.lastSensorSeenAt,
      presence: seat.presence,
      checkedInBy: seat.checkedInBy,
      checkedInAt: seat.checkedInAt,
      checkedInUntil: seat.checkedInUntil,
      projectTeam: seat.checkedInTeam,
      teamBooking: Boolean(seat.teamBooking),
      lastPresenceAt: seat.lastPresenceAt,
      holdExpiresAt,
      allocatedTo: this.allocations.get(seat.id) ?? null,
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
    return {
      seats,
      history: this.history,
      hourly: this.hourly,
      activity: this.activity,
      sensorLinks: this.sensorLinks,
      unlinkedSensors: Object.fromEntries(this.unlinked),
      requesters: Object.fromEntries(this.requesters),
      teamDays: this.teamDays,
      allocations: Object.fromEntries(this.allocations),
      // Saved only once edited, so building.json stays in charge until then.
      ...(this.projectsEdited ? { projects: this.projectTeamInfo.map(({ name, code, color, slot }) => ({ name, code, color, slot })) } : {}),
    };
  }
}
