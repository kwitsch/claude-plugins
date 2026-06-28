// capture-tracker.mjs — registry of in-flight "fire-and-forget" context-mode capture promises.
//
// The PostToolUse and UserPromptSubmit hooks return nothing the harness uses: context-mode's
// capture writes the session DB as a side effect and returns null. To cut hook execution time
// they no longer AWAIT that capture — they register the promise here and return immediately
// (see handlers.mjs). The capture continues in the background; the cave-context server process
// persists, so the work survives the hook response.
//
// The one consumer that needs those writes to have LANDED is PreCompact: inproc-hooks.preCompact
// reads the event store (db.getEvents) to build the resume snapshot. It therefore calls
// drainCaptures() before reading, so a snapshot never misses a capture that was still in flight
// when the producing hook returned. (Session shutdown is synchronous and best-effort; the
// load-bearing drain is PreCompact.)
const _inflight = new Set();

/**
 * @param {PromiseLike<any>|any} promise
 * @returns {any}
 */
export function trackCapture(promise) {
  if (!promise || typeof promise.then !== "function") return promise;
  const tracked = Promise.resolve(promise).catch(() => {});
  _inflight.add(tracked);
  tracked.finally(() => _inflight.delete(tracked));
  return promise;
}

/**
 * @returns {Promise<void>}
 */
export async function drainCaptures() {
  await Promise.allSettled([..._inflight]);
}

/**
 * @returns {number}
 */
export function inflightCount() {
  return _inflight.size;
}
