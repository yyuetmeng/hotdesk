// Pin drop loader geometry and timing (from the pin-drop-loader.html design): a small room with six
// desks; every 1.8 s a pin drops onto the next desk, which lights up with a ripple 0.55 s later.

export const DESKS = [[22, 28], [98, 28], [174, 28], [22, 96], [98, 96], [174, 96]];  // desk (x, y) in the room
const ORDER = [4, 0, 5, 2, 3, 1];                                                       // which desk the pin visits next
export const PIN_STEP_MS = 1800;
export const PIN_DROP_MS = 550;

/** Where the pin and ripple go on a given step. */
export function pinStep(step) {
  const desk = ORDER[step % ORDER.length];
  const [x, y] = DESKS[desk];
  return { desk, pin: { left: x + 9, top: y - 24 }, ripple: { left: x, top: y } };
}
