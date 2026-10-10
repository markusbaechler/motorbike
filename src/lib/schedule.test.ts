import { describe, it, expect } from "vitest";
import {
  addDays, arrivalMin, dayDates, daysBetween, defaultStartMin, fmtHhMm, isoDate, parseHhMm,
} from "./schedule";
import { computeDays } from "./days";
import type { Waypoint } from "../types";

const wp = (id: string, extra: Partial<Waypoint> = {}): Waypoint => ({
  id, lng: 8, lat: 46, legProfile: "kurvig", ...extra,
});

describe("dates", () => {
  it("isoDate / addDays / daysBetween", () => {
    expect(isoDate(new Date(2026, 9, 10, 23, 30))).toBe("2026-10-10");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-10", "2026-10-13")).toBe(3);
    expect(daysBetween("2026-10-10", "2026-10-09")).toBe(-1);
  });
  it("days without date default to today, today+1 …", () => {
    const w = [wp("a"), wp("b", { dayEnd: true }), wp("c", { dayEnd: true }), wp("d")];
    expect(dayDates(w, computeDays(w), "2026-10-10")).toEqual([
      { date: "2026-10-10", isDefault: true },
      { date: "2026-10-11", isDefault: true },
      { date: "2026-10-12", isDefault: true },
    ]);
  });
  it("a set date wins and later days count on from it", () => {
    const w = [wp("a"), wp("b", { dayEnd: true, dayDate: "2026-11-02" }), wp("c", { dayEnd: true }), wp("d")];
    expect(dayDates(w, computeDays(w), "2026-10-10").map((d) => d.date)).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04",
    ]);
  });
});

describe("start time", () => {
  it("today: now rounded up to the quarter hour", () => {
    expect(defaultStartMin("2026-10-10", new Date(2026, 9, 10, 10, 7))).toBe(10 * 60 + 15);
    expect(defaultStartMin("2026-10-10", new Date(2026, 9, 10, 10, 15))).toBe(10 * 60 + 15);
  });
  it("other days: 09:00", () => {
    expect(defaultStartMin("2026-10-11", new Date(2026, 9, 10, 10, 7))).toBe(540);
  });
  it("parse / format", () => {
    expect(parseHhMm("08:30")).toBe(510);
    expect(fmtHhMm(510)).toBe("08:30");
    expect(fmtHhMm(1500)).toBe("01:00"); // after midnight wraps for display
  });
});

describe("arrival with breaks", () => {
  it("no breaks below 150 km and before noon", () => {
    expect(arrivalMin(540, 60, 80)).toBe(600);
  });
  it("15 min per full 150 km", () => {
    expect(arrivalMin(480, 120, 150)).toBe(615);
    expect(arrivalMin(480, 150, 310)).toBe(480 + 150 + 30); // 2 breaks → 11:00, before noon
    expect(arrivalMin(480, 240, 310)).toBe(480 + 240 + 30 + 60); // 2 breaks → 12:30 → lunch
  });
  it("lunch once the clock reaches 12:00", () => {
    expect(arrivalMin(540, 170, 100)).toBe(540 + 170); // 11:50 → no lunch yet
    expect(arrivalMin(540, 180, 100)).toBe(540 + 180 + 60); // 12:00 → lunch
  });
  it("no lunch when starting at/after noon", () => {
    expect(arrivalMin(720, 60, 50)).toBe(780);
    expect(arrivalMin(800, 60, 50)).toBe(860);
  });
});

import { planDays, MAX_STATIONS } from "./schedule";
import type { RouteResult } from "../types";

// Straight line north from (8, 46): 0.009° lat ≈ 1 km. `kmPerLeg` per leg.
function line(kmPerLeg: number[], withEle = true): RouteResult {
  let lat = 46;
  const features: GeoJSON.Feature[] = kmPerLeg.map((km, legIndex) => {
    const coords: number[][] = [];
    for (let k = 0; k <= km; k++) {
      coords.push(withEle ? [8, lat + k * 0.009, 500 + k] : [8, lat + k * 0.009]);
    }
    lat += km * 0.009;
    return { type: "Feature", properties: { legIndex }, geometry: { type: "LineString", coordinates: coords } };
  });
  return {
    geojson: { type: "FeatureCollection", features },
    distanceKm: kmPerLeg.reduce((a, b) => a + b, 0),
    durationMin: kmPerLeg.reduce((a, b) => a + b, 0),
    legs: kmPerLeg.map((km) => ({ profile: "kurvig", distanceKm: km, durationMin: km })), // 60 km/h
  };
}
const NOW = new Date(2026, 9, 10, 7, 0); // today 07:00 → default start 07:00

describe("planDays", () => {
  it("one day: start, samples every ~30 km, end; times from 60 km/h", () => {
    const w = [wp("a", { name: "A" }), wp("b", { name: "B" })];
    const [d] = planDays(w, line([100]), undefined, NOW);
    expect(d.date).toBe("2026-10-10");
    expect(d.startMin).toBe(420);
    expect(d.startIsDefault).toBe(true);
    expect(d.stations.map((s) => s.kind)).toEqual(["start", "sample", "sample", "sample", "end"]);
    expect(d.stations[0].arriveMin).toBe(420);
    expect(d.stations[1].km).toBeCloseTo(30, 0);
    expect(d.stations[1].arriveMin).toBeCloseTo(450, 0);
    expect(d.stations[4].wpId).toBe("b");
    expect(d.stations[4].ele).toBe(600);
  });
  it("uses dayStart when set", () => {
    const w = [wp("a"), wp("b", { dayStart: "10:30" })];
    const [d] = planDays(w, line([40]), undefined, NOW);
    expect(d.startMin).toBe(630);
    expect(d.startIsDefault).toBe(false);
  });
  it("drops samples within 8 km of a waypoint; via and pass are kept", () => {
    const w = [wp("a"), wp("v", { name: "Via" }), wp("b")];
    const pass = { name: "Testpass", lng: 8, lat: 46 + 62 * 0.009 };
    const [d] = planDays(w, line([33, 40]), [pass], NOW);
    const kinds = d.stations.map((s) => `${s.kind}@${Math.round(s.km)}`);
    expect(kinds).toContain("via@33");
    expect(kinds).toContain("pass@62");
    expect(kinds).not.toContain("sample@30"); // 3 km from via
    expect(kinds).not.toContain("sample@60"); // 2 km from pass
    expect(d.stations.find((s) => s.kind === "pass")?.name).toBe("Testpass");
  });
  it("multi-day: each day restarts km and uses its own date", () => {
    const w = [wp("a"), wp("b", { dayEnd: true }), wp("c")];
    const ds = planDays(w, line([50, 50]), undefined, NOW);
    expect(ds.map((d) => d.date)).toEqual(["2026-10-10", "2026-10-11"]);
    expect(ds[1].startMin).toBe(540);
    expect(ds[1].daysAhead).toBe(1);
    expect(ds[1].stations[0].km).toBe(0);
    expect(ds[1].stations[0].wpId).toBe("b");
  });
  it("caps the number of stations", () => {
    const w = [wp("a"), wp("b")];
    const [d] = planDays(w, line([1200]), undefined, NOW);
    expect(d.stations.length).toBeLessThanOrEqual(MAX_STATIONS);
    expect(d.stations.at(-1)?.kind).toBe("end");
  });
  it("works without elevation in the coordinates", () => {
    const [d] = planDays([wp("a"), wp("b")], line([40], false), undefined, NOW);
    expect(d.stations.every((s) => s.ele === undefined)).toBe(true);
  });
});
