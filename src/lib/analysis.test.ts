import { describe, it, expect } from "vitest";
import { analyse } from "./analysis";

// A line heading east while climbing steadily.
function climbingLine(): GeoJSON.Feature {
  const coords: number[][] = [];
  for (let i = 0; i < 60; i++) coords.push([8 + i * 0.005, 46, 400 + i * 12]);
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
}

describe("analyse", () => {
  it("computes distance, ascent and keeps scores in 0..10", () => {
    const a = analyse([climbingLine()]);
    expect(a.distanceKm).toBeGreaterThan(0);
    expect(a.hasElevation).toBe(true);
    expect(a.ascentM).toBeGreaterThan(0);
    expect(a.maxEle).toBeGreaterThan(a.minEle);
    for (const v of [a.scores.curves, a.scores.mountains, a.scores.scenic, a.scores.overall]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it("handles an empty feature list without throwing", () => {
    const a = analyse([]);
    expect(a.distanceKm).toBe(0);
    expect(a.hasElevation).toBe(false);
  });
});
