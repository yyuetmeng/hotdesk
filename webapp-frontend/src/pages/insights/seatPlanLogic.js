// Team seat planning (owner 2026-10-22): a plan only, no seat moves. `tries` maps team id -> the seats the admin is
// trying; it is saved per team (owner 2026-10-23), null meaning "as allocated".
// The total never changes: + takes a seat from the team with the most spare (try above its utilisation, never
// below it), − gives the seat to the team furthest short (below its required or utilisation). Ties go A-Z.

/** What a team needs: the larger of its required seats (if set) and its utilisation. */
export const needOf = (team) => Math.max(team.required ?? 0, team.utilisation);

/** Every team at its current allocation (where Reset goes). */
export const startTries = (teams) => Object.fromEntries(teams.map((t) => [t.id, t.allocated]));

/** The saved plan: each team's planned seats, or its allocation when it has none. */
export const savedTries = (teams) => Object.fromEntries(teams.map((t) => [t.id, t.planned ?? t.allocated]));

/** What to save: every team's tried number, null where it equals the allocation. */
export const planBody = (teams, tries) => Object.fromEntries(teams.map((t) => [t.id, tries[t.id] === t.allocated ? null : tries[t.id]]));

const byName = (a, b) => a.name.localeCompare(b.name);
const best = (teams, score) => teams.map((t) => [t, score(t)]).filter(([, s]) => s > 0)
  .sort(([a, sa], [b, sb]) => sb - sa || byName(a, b))[0]?.[0] ?? null;

/** The team a seat would come from when `id` gets one more, or null when nobody has spare. */
export const donorFor = (teams, tries, id) => best(teams.filter((t) => t.id !== id), (t) => tries[t.id] - t.utilisation);

/** The team a seat would go to when `id` gives one up, or null when nobody is short (or `id` has none). */
export const receiverFor = (teams, tries, id) => (tries[id] > 0
  ? best(teams.filter((t) => t.id !== id), (t) => needOf(t) - tries[t.id]) : null);

const move = (tries, from, to) => ({ ...tries, [from.id]: tries[from.id] - 1, [to.id]: tries[to.id] + 1 });

/** One more seat for `id`: { tries, from } or null. */
export function plus(teams, tries, id) {
  const from = donorFor(teams, tries, id);
  return from && { tries: move(tries, from, { id }), from };
}

/** One seat fewer for `id`: { tries, to } or null. */
export function minus(teams, tries, id) {
  const to = receiverFor(teams, tries, id);
  return to && { tries: move(tries, { id }, to), to };
}

/** `id` set to `target` seats (typed): the same one-seat moves as −/+, until it gets there or no move is left.
 * { tries, reached, moved: [{ name, seats }] }: seats > 0 taken from that team, < 0 given to it, A-Z. */
export function tryTo(teams, tries, id, target) {
  let now = tries;
  const moved = {};
  while (now[id] !== target) {
    const up = now[id] < target, done = up ? plus(teams, now, id) : minus(teams, now, id);
    if (!done) break;
    const other = up ? done.from : done.to;
    moved[other.name] = (moved[other.name] ?? 0) + (up ? 1 : -1);
    now = done.tries;
  }
  return { tries: now, reached: now[id] === target,
    moved: Object.entries(moved).sort(([a], [b]) => a.localeCompare(b)).map(([name, seats]) => ({ name, seats })) };
}

/** "3 taken from SAP · 1 taken from eWorkplace" for tryTo's moved list. */
export const movedText = (moved) => moved.map((m) => (m.seats > 0 ? `${m.seats} taken from ${m.name}` : `${-m.seats} given to ${m.name}`)).join(' · ');

/** How a tried number compares with what the team needs: { kind: 'short' | 'spare' | 'ok', text }. */
export function verdict(team, tried) {
  if (tried < team.utilisation) return { kind: 'short', text: `${team.utilisation - tried} below utilisation` };
  if (team.required != null && tried < team.required) return { kind: 'short', text: `${team.required - tried} below required` };
  const spare = tried - needOf(team);
  if (spare > 0) return { kind: 'spare', text: `${spare} spare` };
  return { kind: 'ok', text: team.required != null ? 'covers required and utilisation' : 'covers utilisation' };
}

/** Teams whose tried number differs from their allocation, as "SAP −4" pieces, A-Z. */
export const changes = (teams, tries) => teams.filter((t) => tries[t.id] !== t.allocated).sort(byName)
  .map((t) => `${t.name} ${tries[t.id] > t.allocated ? '+' : '−'}${Math.abs(tries[t.id] - t.allocated)}`);

/** Right end of every bar and of the Required slider: 150 seats (owner 2026-10-23), or more when a number shown is
 * bigger: then that number with room to drag Required a little further, in steps of 5. */
export const SCALE_DEFAULT = 150;
export function scaleMax(teams, tries) {
  const top = Math.max(0, ...teams.flatMap((t) => [t.allocated, t.utilisation, t.required ?? 0, tries[t.id] ?? 0]));
  return Math.max(SCALE_DEFAULT, Math.ceil((top + 2) / 5) * 5);
}
