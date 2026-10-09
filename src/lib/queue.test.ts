import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  configureQueue,
  MAX_CONCURRENT,
  onThrottle,
  QUEUE_DEFAULTS,
  queueState,
  reportThrottled,
  resetQueue,
  withSlot,
} from "./queue";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("request queue", () => {
  it("never runs more than MAX_CONCURRENT at once and keeps the order", async () => {
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const jobs = Array.from({ length: 8 }, (_, i) =>
      withSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        order.push(i);
        await tick();
        running--;
        return i;
      }),
    );
    expect(queueState().active).toBe(MAX_CONCURRENT);
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(MAX_CONCURRENT);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(queueState()).toEqual({ active: 0, waiting: 0 });
  });

  it("drops a waiting job when its signal aborts, without running it", async () => {
    const blockers = Array.from({ length: MAX_CONCURRENT }, () => withSlot(() => tick()));
    const ctrl = new AbortController();
    let ran = false;
    const queued = withSlot(async () => {
      ran = true;
    }, ctrl.signal);
    expect(queueState().waiting).toBe(1);
    ctrl.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await Promise.all(blockers);
    expect(ran).toBe(false);
    expect(queueState()).toEqual({ active: 0, waiting: 0 });
  });

  it("rejects immediately for an already aborted signal", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(withSlot(async () => 1, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

// brouter.de (measured 2026-10-09): about 17 requests per minute per IP, then
// "403 Please, retry later!" for roughly half a minute.
describe("request queue pacing for the public server", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  beforeEach(() => resetQueue());
  afterEach(() => {
    configureQueue({ limit: QUEUE_DEFAULTS.limit, windowMs: QUEUE_DEFAULTS.windowMs, pauseMs: QUEUE_DEFAULTS.pauseMs });
    resetQueue();
  });

  it("starts at most `limit` requests per window and holds the rest until it frees up", async () => {
    configureQueue({ limit: 3, windowMs: 60, pauseMs: 1000 });
    const started: number[] = [];
    const jobs = Array.from({ length: 5 }, (_, i) => withSlot(async () => void started.push(i)));
    await sleep(20);
    expect(started).toEqual([0, 1, 2]);
    await Promise.all(jobs);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("holds every request back after the server said it is throttling", async () => {
    configureQueue({ limit: 100, windowMs: 1000, pauseMs: 60 });
    reportThrottled();
    let ran = false;
    const job = withSlot(async () => void (ran = true));
    await sleep(25);
    expect(ran).toBe(false);
    await job;
    expect(ran).toBe(true);
  });

  it("tells listeners until when it waits, and when it goes on", async () => {
    configureQueue({ limit: 100, windowMs: 1000, pauseMs: 50 });
    const seen: number[] = [];
    const off = onThrottle((until) => seen.push(until));
    reportThrottled();
    await withSlot(async () => undefined);
    off();
    expect(seen[0]).toBeGreaterThan(Date.now() - 100);
    expect(seen[seen.length - 1]).toBe(0);
  });
});
