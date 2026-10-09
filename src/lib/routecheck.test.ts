import { describe, it, expect } from "vitest";
import {
  checkRoute,
  findSpur,
  formatLegDistance,
  legCoordinates,
  OFFROAD_MIN_M,
  SPUR_MIN_M,
} from "./routecheck";
import type { Waypoint } from "../types";
import valcolla from "./__fixtures__/valcolla-legs.json";

// Points along a north-south line: 0.001° lat ≈ 111 m.
const at = (n: number, lng = 9): [number, number] => [lng, 46 + n * 0.001];
const wp = (id: string, p: [number, number], extra: Partial<Waypoint> = {}): Waypoint => ({
  id,
  lng: p[0],
  lat: p[1],
  legProfile: "kurvig",
  ...extra,
});

// Main road runs from 0 to 10; a dead-end side road branches off at 5 and
// goes east to the village V (≈ 4 × 111 m … depends on lng step, see below).
const side = (k: number): [number, number] => [9 + k * 0.001, 46.005]; // ≈ 77 m per step at 46°N

describe("findSpur", () => {
  it("finds nothing when the next leg leaves in another direction", () => {
    const prev = [at(0), at(1), at(2)];
    const next = [at(2), at(3), at(4)];
    expect(findSpur(prev, next)).toBeNull();
  });

  it("measures an out-and-back and returns the junction where it ends", () => {
    // In: road 0→5, then side road to the village (4 steps east).
    const prev = [at(0), at(5), side(1), side(2), side(3), side(4)];
    // Out: the same side road back to the junction, then on to 10.
    const next = [side(4), side(3), side(2), side(1), at(5), at(10)];
    const s = findSpur(prev, next)!;
    expect(s.meters).toBeGreaterThan(300); // 4 × ~77 m
    expect(s.meters).toBeLessThan(320);
    expect(s.base).toEqual(at(5));
  });

  it("ignores elevation in the coordinates", () => {
    const prev = [[9, 46, 300], [9, 46.003, 320]];
    const next = [[9, 46.003, 320], [9, 46, 300], [9.01, 46]];
    expect(findSpur(prev, next)!.base).toEqual([9, 46]);
  });
});

describe("checkRoute", () => {
  // Tour S → V → E where V sits at the end of a dead-end side road.
  const S = at(0);
  const V = side(4);
  const E = at(10);
  const legIn = [S, at(5), side(1), side(2), side(3), side(4)];
  const legOut = [side(4), side(3), side(2), side(1), at(5), E];

  it("flags a via point that is only reached by an out-and-back", () => {
    const checks = checkRoute([wp("s", S), wp("v", V), wp("e", E)], [legIn, legOut]);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ index: 1, kind: "spur", fix: at(5) });
    expect(checks[0].meters).toBeGreaterThanOrEqual(SPUR_MIN_M);
  });

  it("does not flag an overnight stop (riding into the hotel village is fine)", () => {
    const checks = checkRoute([wp("s", S), wp("v", V, { dayEnd: true }), wp("e", E)], [legIn, legOut]);
    expect(checks).toEqual([]);
  });

  it("does not flag short spurs below the threshold", () => {
    const prev = [S, at(5), side(1)];
    const next = [side(1), at(5), E];
    expect(checkRoute([wp("s", S), wp("v", side(1)), wp("e", E)], [prev, next])).toEqual([]);
  });

  it("flags a point far away from the routed road and offers the road position", () => {
    // The waypoint lies 3 steps (≈ 230 m) east of where the route starts.
    const route = [[at(0)[0], at(0)[1]], at(5)];
    const start = side(3);
    const checks = checkRoute([wp("s", [start[0], 46]), wp("e", at(5))], [route]);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ index: 0, kind: "offroad", fix: at(0) });
    expect(checks[0].meters).toBeGreaterThanOrEqual(OFFROAD_MIN_M);
  });

  it("checks the destination against the end of the last leg", () => {
    const route = [at(0), at(5)];
    const checks = checkRoute([wp("s", at(0)), wp("e", [9.003, 46.005])], [route]);
    expect(checks).toMatchObject([{ index: 1, kind: "offroad", fix: at(5) }]);
  });

  it("returns nothing when the route does not belong to these waypoints", () => {
    expect(checkRoute([wp("s", S), wp("v", V), wp("e", E)], [legIn])).toEqual([]);
  });
});

// Real BRouter output (custom curvy profile, 2026-10-09) for the reported
// tour Monte Ceneri → Capriasca → Molino → Insone → Scareglia. Insone sits on
// a dead-end road, the Capriasca village node on a side street.
describe("checkRoute on the reported Val Colla tour", () => {
  const legs = valcolla as number[][][];
  const tour = [
    wp("ceneri", [8.907085, 46.139177]),
    wp("capriasca", [8.971489, 46.067369]),
    wp("molino", [9.034861, 46.082484]),
    wp("insone", [9.030057, 46.086578]),
    wp("scareglia", [9.035898, 46.09024]),
  ];

  it("flags exactly the two out-and-backs, nothing else", () => {
    const checks = checkRoute(tour, legs);
    expect(checks.map((c) => [c.index, c.kind])).toEqual([
      [1, "spur"],
      [3, "spur"],
    ]);
    expect(Math.round(checks[0].meters)).toBeGreaterThan(380);
    expect(Math.round(checks[0].meters)).toBeLessThan(430);
    expect(Math.round(checks[1].meters)).toBeGreaterThan(1700);
    expect(Math.round(checks[1].meters)).toBeLessThan(1900);
  });
});

describe("legCoordinates", () => {
  it("returns each leg's line in order and an empty list for anything else", () => {
    const route = {
      distanceKm: 0,
      durationMin: 0,
      legs: [],
      geojson: {
        type: "FeatureCollection" as const,
        features: [
          { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [at(0), at(1)] } },
          { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: at(1) } },
        ],
      },
    };
    expect(legCoordinates(route)).toEqual([[at(0), at(1)], []]);
  });
});

describe("formatLegDistance", () => {
  it("shows metres below one kilometre instead of '0 km'", () => {
    expect(formatLegDistance(0.041)).toBe("41 m");
  });
  it("shows one decimal for short legs", () => {
    expect(formatLegDistance(2.17)).toBe("2.2 km");
  });
  it("rounds longer legs to whole kilometres", () => {
    expect(formatLegDistance(18.3)).toBe("18 km");
  });
});
