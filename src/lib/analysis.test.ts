import { describe, it, expect } from "vitest";
import { analyse, passesOnRoute } from "./analysis";

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

  it("does not give every twisty road full curve marks", () => {
    // Zigzag: a 60° turn every ~330 m ≈ 3 corners/km (Jura-like, not Tessin).
    const coords: number[][] = [];
    let lng = 8, lat = 46;
    for (let i = 0; i < 90; i++) {
      coords.push([lng, lat, 500]);
      lng += 0.0043;
      lat += i % 2 === 0 ? 0.0015 : -0.0015;
    }
    const a = analyse([{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }]);
    expect(a.cornersPerKm).toBeGreaterThan(2);
    expect(a.cornersPerKm).toBeLessThan(4);
    expect(a.scores.curves).toBeGreaterThan(3);
    expect(a.scores.curves).toBeLessThan(9);
  });

  it("counts motorway against the road score, main roads only a little", () => {
    const withRoads = (tag: string): GeoJSON.Feature => ({
      ...climbingLine(),
      properties: { messages: [["Distance", "WayTags"], ["22800", `highway=${tag}`]] },
    });
    const motorway = analyse([withRoads("motorway")]).scores.scenic;
    const main = analyse([withRoads("secondary")]).scores.scenic;
    const small = analyse([withRoads("tertiary")]).scores.scenic;
    expect(motorway).toBeLessThan(1);
    expect(main).toBeGreaterThan(6);
    expect(small).toBeGreaterThan(main);
  });
});

describe("passesOnRoute", () => {
  const line: [number, number][] = [];
  for (let i = 0; i <= 100; i++) line.push([8 + i * 0.001, 46]);

  it("finds passes on the route in riding order and ignores ones off it", () => {
    const names = passesOnRoute(line, [
      { name: "Weiter hinten", lat: 46.001, lng: 8.08 },
      { name: "Vorne", lat: 46.0005, lng: 8.01 },
      { name: "Daneben", lat: 46.02, lng: 8.05 },
    ]);
    expect(names).toEqual(["Vorne", "Weiter hinten"]);
  });

  it("counts a pass listed twice only once", () => {
    const p = { name: "Alpe di Neggia", lat: 46.0, lng: 8.05 };
    expect(passesOnRoute(line, [p, { ...p }])).toEqual(["Alpe di Neggia"]);
  });
});
