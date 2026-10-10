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
