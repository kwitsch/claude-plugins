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

// Register a fire-and-forget capture promise. Returns the original value unchanged so callers
// can `return trackCapture(...)` if they wish. Non-thenables pass through untracked. The wrapper
// swallows rejections (the capture path already fails open to null upstream; an unhandled
// rejection here would just be noise) and removes itself from the set once settled.
export function trackCapture(promise) {
  if (!promise || typeof promise.then !== "function") return promise;
  const tracked = Promise.resolve(promise).catch(() => {});
  _inflight.add(tracked);
  tracked.finally(() => _inflight.delete(tracked));
  return promise;
}

// Await every capture in flight at call time (all settled — never rejects). Captures registered
// after the call begins are not awaited (they belong to a later boundary, e.g. a post-compaction
// turn). Snapshot the set so concurrently-added captures don't extend this drain.
export async function drainCaptures() {
  await Promise.allSettled([..._inflight]);
}

// Count of captures currently in flight. For tests/diagnostics.
export function inflightCount() {
  return _inflight.size;
}
