import { describe, it, expect } from "vitest";
import { computeDays } from "./days";
import type { Waypoint } from "../types";

const wp = (i: number, dayEnd = false): Waypoint => ({
  id: `w${i}`,
  lng: 8 + i * 0.1,
  lat: 46,
  legProfile: "kurvig",
  dayEnd,
});

describe("computeDays", () => {
  it("is a single day when nothing is flagged", () => {
    const d = computeDays([wp(0), wp(1), wp(2)]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ startIdx: 0, endIdx: 2 });
  });

  it("splits at dayEnd and shares the overnight waypoint", () => {
    const d = computeDays([wp(0), wp(1, true), wp(2)]);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ startIdx: 0, endIdx: 1 });
    expect(d[1]).toMatchObject({ startIdx: 1, endIdx: 2 });
  });

  it("returns no days for fewer than two waypoints", () => {
    expect(computeDays([wp(0)])).toHaveLength(0);
  });
});
