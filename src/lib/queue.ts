// One small queue for every request to the public BRouter server. It
// throttles per IP, so a burst (ten legs at once, or the Tour-Genius with
// dozens of candidates) gets answered with 403. Three requests at a time
// keep it happy and still feel instant for a normal tour.

export const MAX_CONCURRENT = 3;

interface Waiting {
  run: () => void;
  onAbort: () => void;
  signal?: AbortSignal;
}

let active = 0;
const waiting: Waiting[] = [];

const abortError = () => new DOMException("Aborted", "AbortError");

function pump(): void {
  while (active < MAX_CONCURRENT && waiting.length > 0) {
    const w = waiting.shift()!;
    w.signal?.removeEventListener("abort", w.onAbort);
    active++;
    w.run();
  }
}

/**
 * Run `fn` once a slot is free. A caller that aborts while still waiting is
 * dropped from the queue without ever running (stale legs after an edit).
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
        reject(abortError());
      },
    };
    signal?.addEventListener("abort", entry.onAbort, { once: true });
    waiting.push(entry);
    pump();
  });
}

/** For tests and debugging. */
export const queueState = () => ({ active, waiting: waiting.length });
