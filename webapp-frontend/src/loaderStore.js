// One shared page loader (owner 2026-10-16): once shown it stays at least `minMs`, so a fast load does not
// flash, and a loader that starts while another is still showing takes over without a gap.
// Pages render <Loading label=…/> (components.jsx), which registers here; <LoaderHost/> draws the overlay.

export function createLoaderStore({ minMs = 1000, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let count = 0, label = null, shownAt = 0, timer = null;
  const subs = new Set();
  const emit = () => subs.forEach((fn) => fn());
  const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  return {
    show(text) {
      count += 1;
      stop();
      if (label === null) shownAt = now();
      label = text;
      emit();
    },
    hide() {
      count = Math.max(count - 1, 0);
      if (count || label === null) return;
      const left = minMs - (now() - shownAt);
      if (left <= 0) { label = null; emit(); return; }
      stop();
      timer = setTimer(() => { timer = null; if (!count) { label = null; emit(); } }, left);
    },
    /** The label to show, or null when the loader is hidden. */
    snapshot: () => label,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

export const loader = createLoaderStore();
