import assert from 'node:assert/strict';
import { changes, donorFor, minus, movedText, needOf, planBody, plus, receiverFor, savedTries, scaleMax, startTries, tryTo, verdict } from '../src/pages/insights/seatPlanLogic.js';

// SAP holds 24 but never has more than 14 in; STREAM needs 16 and has 12; G&C is one short of its utilisation.
const teams = [
  { id: 'sap', name: 'SAP', required: 16, allocated: 24, utilisation: 14 },
  { id: 'str', name: 'STREAM', required: 16, allocated: 12, utilisation: 12 },
  { id: 'gc', name: 'G&C', required: 10, allocated: 10, utilisation: 11 },
  { id: 'ew', name: 'eWorkplace', required: null, allocated: 12, utilisation: 5 },
];
const total = (tries) => Object.values(tries).reduce((a, b) => a + b, 0);
let tries = startTries(teams);
assert.deepEqual(tries, { sap: 24, str: 12, gc: 10, ew: 12 });
assert.equal(needOf(teams[0]), 16);
assert.equal(needOf(teams[3]), 5);                                                  // no required: utilisation only

// + on STREAM takes from the team with the most spare above its utilisation: SAP has 10, eWorkplace 7.
let step = plus(teams, tries, 'str');
assert.equal(step.from.name, 'SAP');
tries = step.tries;
assert.deepEqual(tries, { sap: 23, str: 13, gc: 10, ew: 12 });
assert.equal(total(tries), 58);                                                     // the total never changes

// Keep adding to STREAM: donors are drained down to their utilisation, never below it, then + stops.
let n = 0;
while ((step = plus(teams, tries, 'str'))) { tries = step.tries; n += 1; }
assert.equal(n, 16);                                                                // 9 more from SAP, 7 from eWorkplace
assert.deepEqual(tries, { sap: 14, str: 29, gc: 10, ew: 5 });
assert.equal(total(tries), 58);
assert.equal(donorFor(teams, tries, 'str'), null);

// − on STREAM gives the seat to the team furthest short: SAP (2 below required 16), then G&C and SAP.
const order = [];
while ((step = minus(teams, tries, 'str'))) { tries = step.tries; order.push(step.to.name); }
assert.deepEqual(order, ['SAP', 'G&C', 'SAP']);                                // then 1 short each: A-Z
assert.deepEqual(tries, { sap: 16, str: 26, gc: 11, ew: 5 });
// Everyone else is at their need now, so STREAM's extra seats have nowhere to go.
assert.equal(receiverFor(teams, tries, 'str'), null);
assert.equal(minus(teams, tries, 'str'), null);
assert.equal(minus(teams, { ...tries, sap: 0 }, 'sap'), null);                     // nothing to give

// Ties go A-Z.
const twins = [{ id: 'b', name: 'Beta', required: null, allocated: 5, utilisation: 2 },
  { id: 'a', name: 'Alpha', required: null, allocated: 5, utilisation: 2 },
  { id: 'c', name: 'Gamma', required: 9, allocated: 1, utilisation: 1 }];
assert.equal(plus(twins, startTries(twins), 'c').from.name, 'Alpha');

// Typing a Try number: the same moves as −/+, stopping where none is left.
let typed = tryTo(teams, startTries(teams), 'str', 22);
assert.equal(typed.reached, true);
assert.deepEqual(typed.tries, { sap: 18, str: 22, gc: 10, ew: 8 });               // from the most spare each time: they even out
assert.equal(movedText(typed.moved), '4 taken from eWorkplace · 6 taken from SAP');
typed = tryTo(teams, startTries(teams), 'str', 99);
assert.equal(typed.reached, false);
assert.equal(typed.tries.str, 29);                                                 // SAP down to 14, eWorkplace to 5
assert.equal(movedText(typed.moved), '7 taken from eWorkplace · 10 taken from SAP');
typed = tryTo(teams, startTries(teams), 'sap', 20);
assert.deepEqual(typed.tries, { sap: 20, str: 15, gc: 11, ew: 12 });              // to the teams furthest short
assert.equal(movedText(typed.moved), '1 given to G&C · 3 given to STREAM');
assert.deepEqual(tryTo(teams, startTries(teams), 'sap', 24).moved, []);

// Verdicts, changes and the bar scale.
assert.deepEqual(verdict(teams[2], 10), { kind: 'short', text: '1 below utilisation' });
assert.deepEqual(verdict(teams[1], 13), { kind: 'short', text: '3 below required' });
assert.deepEqual(verdict(teams[0], 24), { kind: 'spare', text: '8 spare' });
assert.deepEqual(verdict(teams[0], 16), { kind: 'ok', text: 'covers required and utilisation' });
assert.deepEqual(verdict(teams[3], 5), { kind: 'ok', text: 'covers utilisation' });
assert.deepEqual(changes(teams, { sap: 20, str: 16, gc: 10, ew: 12 }), ['SAP −4', 'STREAM +4']);
assert.deepEqual(changes(teams, startTries(teams)), []);
assert.equal(scaleMax(teams, startTries(teams)), 150);                             // the default length
assert.equal(scaleMax([], {}), 150);
const big = [{ id: 'x', name: 'X', required: 150, allocated: 40, utilisation: 30 }];
assert.equal(scaleMax(big, startTries(big)), 155);                                 // 150 + room, rounded to 5
// The saved plan: planned where set, else allocated; saving sends null where a team is at its allocation.
const withPlan = teams.map((t) => ({ ...t, planned: { sap: 20, str: 16 }[t.id] ?? null }));
assert.deepEqual(savedTries(withPlan), { sap: 20, str: 16, gc: 10, ew: 12 });
assert.deepEqual(planBody(teams, { sap: 20, str: 16, gc: 10, ew: 12 }), { sap: 20, str: 16, gc: null, ew: null });
console.log('seat plan smoke OK');
