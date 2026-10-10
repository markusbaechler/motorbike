import { describe, it, expect } from "vitest";
import { carryOver, routeKeyOf } from "./useRouteWeather";
import type { DayPlan, Station } from "./schedule";
import type { HourWx } from "./weather";

const st = (lat: number, arriveMin: number): Station => ({ lat, lng: 8, km: 0, arriveMin, kind: "sample" });
const plan = (date: string, stations: Station[]): DayPlan => ({
  day: 1, date, dateIsDefault: true, startMin: 540, startIsDefault: true, daysAhead: 0, stations,
});
const v: HourWx = { code: 1, temp: 10, precipProb: 5, precip: 0, wind: 3 };

describe("carryOver", () => {
  it("keeps values when the day's stations are unchanged (rename, clock tick)", () => {
    const prev = { plans: [plan("2026-10-10", [st(46, 600)])], wx: [{ status: "ok" as const, values: [v] }] };
    const next = carryOver(prev, [plan("2026-10-10", [st(46, 600)])]);
    expect(next[0]).toEqual({ status: "ok", values: [v] });
  });
  it("reloads when stations, times or date change", () => {
    const prev = { plans: [plan("2026-10-10", [st(46, 600)])], wx: [{ status: "ok" as const, values: [v] }] };
    expect(carryOver(prev, [plan("2026-10-10", [st(46, 630)])])[0].status).toBe("loading");
    expect(carryOver(prev, [plan("2026-10-11", [st(46, 600)])])[0].status).toBe("loading");
  });
  it("outside the forecast window → none", () => {
    const far = { ...plan("2026-12-24", [st(46, 600)]), daysAhead: 75 };
    expect(carryOver({ plans: [], wx: [] }, [far])[0].status).toBe("none");
  });
});

describe("routeKeyOf", () => {
  it("changes with positions and riding style, not with names", () => {
    const a = [{ id: "a", lng: 8, lat: 46, legProfile: "kurvig" as const }];
    expect(routeKeyOf(a)).toBe(routeKeyOf([{ ...a[0], name: "X" }]));
    expect(routeKeyOf(a)).not.toBe(routeKeyOf([{ ...a[0], lat: 46.1 }]));
    expect(routeKeyOf(a)).not.toBe(routeKeyOf([{ ...a[0], legProfile: "schnell" }]));
  });
});
