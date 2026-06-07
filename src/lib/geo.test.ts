import { describe, it, expect } from "vitest";
import { haversine, bearing, bearingDelta, destination } from "./geo";

describe("geo", () => {
  it("haversine ≈ 111 km per degree of latitude", () => {
    const d = haversine([8, 46], [8, 47]);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  it("destination + haversine returns the requested distance", () => {
    const p = destination([8, 46], 90, 1000);
    const back = haversine([8, 46], p);
    expect(back).toBeGreaterThan(980);
    expect(back).toBeLessThan(1020);
  });

  it("bearing due east is ≈ 90°", () => {
    expect(Math.abs(bearing([8, 46], [9, 46]) - 90)).toBeLessThan(1);
  });

  it("bearingDelta wraps across 0/360", () => {
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(10, 350)).toBe(20);
  });
});
