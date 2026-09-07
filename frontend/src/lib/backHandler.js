/**
 * What Android's back gesture should do, in priority order.
 *
 * Without this, back leaves the app from anywhere — including with a drawer or
 * modal open, which on Android reads as a crash rather than a navigation. Any
 * component showing something layered registers a handler while it is open;
 * the most recently registered one wins, so nested overlays unwind in order.
 *
 * Nothing here is native: the same stack works in a browser, which is what
 * lets the behaviour be tested without a device.
 */
const handlers = [];

/**
 * Registers a handler while an overlay is open. Returns the unregister
 * function, so it can be returned directly from a `useEffect`.
 */
export function pushBackHandler(handler) {
  handlers.push(handler);
  return () => {
    const at = handlers.indexOf(handler);
    if (at >= 0) handlers.splice(at, 1);
  };
}

/**
 * Runs the topmost handler, if any. Returns true when one handled the press,
 * so the caller knows not to navigate.
 */
export function runBackHandler() {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

/** Only for tests: how many overlays currently claim the back gesture. */
export function backHandlerDepth() {
  return handlers.length;
}
