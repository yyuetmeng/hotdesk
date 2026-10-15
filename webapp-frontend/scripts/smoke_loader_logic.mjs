import assert from 'node:assert/strict';
import { DESKS, PIN_DROP_MS, PIN_STEP_MS, pinStep } from '../src/pinLoaderLogic.js';

// Pin drop loader (from pin-drop-loader.html): six desks, the pin visits 4, 0, 5, 2, 3, 1, then repeats.
assert.equal(DESKS.length, 6);
assert.deepEqual(DESKS[0], [22, 28]);
assert.equal(PIN_STEP_MS, 1800);
assert.equal(PIN_DROP_MS, 550);
assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((s) => pinStep(s).desk), [4, 0, 5, 2, 3, 1, 4]);
assert.deepEqual(pinStep(0), { desk: 4, pin: { left: 107, top: 72 }, ripple: { left: 98, top: 96 } });
console.log('loader logic smoke OK');
