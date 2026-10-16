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

// One shared loader (owner 2026-10-16): stays at least 1 s, and back-to-back loaders do not blink.
{
  const { createLoaderStore } = await import('../src/loaderStore.js');
  let t = 0; const timers = [];
  const store = createLoaderStore({ minMs: 1000, now: () => t, setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; }, clearTimer: (id) => { timers[id - 1].fn = null; } });
  const run = () => timers.filter((x) => x.fn && x.at <= t).forEach((x) => { const fn = x.fn; x.fn = null; fn(); });
  assert.equal(store.snapshot(), null);
  store.show('Loading users...');
  assert.equal(store.snapshot(), 'Loading users...');
  t = 200; store.hide();
  assert.equal(store.snapshot(), 'Loading users...');            // data came fast: still showing
  t = 600; run(); assert.equal(store.snapshot(), 'Loading users...');
  store.show('Loading the floor display…');                        // the next loader takes over without a gap
  assert.equal(store.snapshot(), 'Loading the floor display…');
  t = 1100; run(); assert.equal(store.snapshot(), 'Loading the floor display…');
  t = 1200; store.hide(); assert.equal(store.snapshot(), null);   // shown over 1 s already: goes at once
  store.show('A'); t = 3000; store.hide(); assert.equal(store.snapshot(), null);   // slow load: no extra wait
}
console.log('shared loader smoke OK');
