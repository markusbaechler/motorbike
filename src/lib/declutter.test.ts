import { describe, it, expect } from "vitest";
import { declutter, type Box } from "./declutter";

const box = (x: number, y: number, w = 50, h = 20): Box => ({ x, y, w, h });

describe("declutter", () => {
  it("keeps everything when nothing overlaps", () => {
    expect(declutter([{ box: box(0, 0), priority: 1 }, { box: box(100, 0), priority: 1 }], [])).toEqual([true, true]);
  });
  it("of two overlapping chips the higher priority (lower number) wins", () => {
    const vis = declutter([{ box: box(0, 0), priority: 3 }, { box: box(20, 5), priority: 0 }], []);
    expect(vis).toEqual([false, true]);
  });
  it("same priority: the earlier one wins", () => {
    expect(declutter([{ box: box(0, 0), priority: 2 }, { box: box(10, 0), priority: 2 }], [])).toEqual([true, false]);
  });
  it("chips never cover an obstacle (waypoint markers)", () => {
    const vis = declutter([{ box: box(0, 0), priority: 0 }, { box: box(200, 0), priority: 0 }], [box(10, 5, 30, 30)]);
    expect(vis).toEqual([false, true]);
  });
  it("a hidden chip does not block others", () => {
    // A (prio 0) blocks B (prio 1); B would have blocked C (prio 2), but B is hidden.
    const vis = declutter(
      [{ box: box(0, 0), priority: 0 }, { box: box(40, 0), priority: 1 }, { box: box(80, 0), priority: 2 }],
      [],
    );
    expect(vis).toEqual([true, false, true]);
  });
});

import { visibleHeight } from "./declutter";

describe("visibleHeight", () => {
  const map = { left: 0, top: 0, right: 375, bottom: 812 };
  it("phone: the bottom sheet covers the lower part", () => {
    expect(visibleHeight(map, { left: 0, top: 466, right: 375, bottom: 812 })).toBe(466);
  });
  it("desktop: a sidebar next to the map covers nothing", () => {
    expect(visibleHeight({ left: 456, top: 0, right: 1024, bottom: 768 }, { left: 76, top: 0, right: 456, bottom: 768 })).toBe(768);
  });
  it("no panel → whole map", () => {
    expect(visibleHeight(map, null)).toBe(812);
  });
});
