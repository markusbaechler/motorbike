// One small queue for every request to the public BRouter server.
//
// brouter.de throttles per IP. Measured on 2026-10-09: about 17 requests in a
// minute go through, the next ones get "403 Please, retry later!" for roughly
// half a minute (after 70 s of quiet the full quota is back). So the queue
//   - runs at most MAX_CONCURRENT requests at the same time,
//   - starts at most `limit` requests within any `windowMs` (stays below the
//     server's limit, so a normal tour never gets a 403 in the first place),
//   - and after a reported 403 holds EVERY request back for `pauseMs`, instead
//     of each request retrying on its own into the same wall.
// Listeners (the UI) learn until when the queue waits, so the rider sees
// "geht in 25 s weiter" instead of an error.

export const MAX_CONCURRENT = 3;

export const QUEUE_DEFAULTS = {
  limit: 15, // a little below the measured ~17 per minute
  windowMs: 60_000,
  pauseMs: 30_000,
};

let limit = QUEUE_DEFAULTS.limit;
let windowMs = QUEUE_DEFAULTS.windowMs;
let pauseMs = QUEUE_DEFAULTS.pauseMs;

interface Waiting {
  run: () => void;
  onAbort: () => void;
  signal?: AbortSignal;
}

let active = 0;
const waiting: Waiting[] = [];
// Start times of the requests within the current window.
let starts: number[] = [];
let pausedUntil = 0;
let wakeTimer: ReturnType<typeof setTimeout> | undefined;
// What listeners were told last (0 = not held back).
let announced = 0;
const listeners = new Set<(until: number) => void>();

const abortError = () => new DOMException("Aborted", "AbortError");

function announce(until: number): void {
  if (until === announced) return;
  announced = until;
  for (const l of listeners) l(until);
}

// Earliest time the next request may start (0 = now).
function blockedUntil(now: number): number {
  starts = starts.filter((t) => now - t < windowMs);
  const windowFree = starts.length >= limit ? starts[0] + windowMs : 0;
  const until = Math.max(pausedUntil, windowFree);
  return until > now ? until : 0;
}

function pump(): void {
  while (active < MAX_CONCURRENT && waiting.length > 0) {
    const now = Date.now();
    const until = blockedUntil(now);
    if (until) {
      announce(until);
      clearTimeout(wakeTimer);
      wakeTimer = setTimeout(pump, until - now);
      return;
    }
    const w = waiting.shift()!;
    w.signal?.removeEventListener("abort", w.onAbort);
    active++;
    starts.push(now);
    w.run();
  }
  // Not held back by the server (any wait now is just the concurrency cap).
  announce(0);
}

/**
 * Run `fn` once a slot is free (and the server's limit allows it). A caller
 * that aborts while still waiting is dropped from the queue without ever
 * running (stale legs after an edit).
 */
export function withSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const entry: Waiting = {
      signal,
      run: () => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      },
      onAbort: () => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        if (waiting.length === 0) announce(0);
        reject(abortError());
      },
    };
    signal?.addEventListener("abort", entry.onAbort, { once: true });
    waiting.push(entry);
    pump();
  });
}

/** The server answered 403/429: hold every request back for a while. */
export function reportThrottled(): void {
  pausedUntil = Math.max(pausedUntil, Date.now() + pauseMs);
  announce(pausedUntil);
}

/** Subscribe to "held back until <ms timestamp>" (0 = running again). */
export function onThrottle(listener: (until: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests and debugging. */
export const queueState = () => ({ active, waiting: waiting.length });

/** Test hook: change the pacing. */
export function configureQueue(c: { limit: number; windowMs: number; pauseMs: number }): void {
  limit = c.limit;
  windowMs = c.windowMs;
  pauseMs = c.pauseMs;
}

/** Test hook: forget the window and any pause. */
export function resetQueue(): void {
  starts = [];
  pausedUntil = 0;
  clearTimeout(wakeTimer);
  announced = 0;
}
