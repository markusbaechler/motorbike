import { describe, it, expect } from "vitest";
import { MAX_CONCURRENT, queueState, withSlot } from "./queue";

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
