import { describe, it, expect, vi, afterEach } from "vitest";
import { clearWeatherCache, fetchDayWeather, hourlyUrl, parseHourly, summarize, valueAt } from "./weather";
import type { Station } from "./schedule";

const hours = (f: (h: number) => number | null) => Array.from({ length: 24 }, (_, h) => f(h));
const loc = (base: number) => ({
  hourly: {
    time: hours(() => 0).map((_, h) => `2026-10-10T${String(h).padStart(2, "0")}:00`),
    temperature_2m: hours((h) => base + h),
    precipitation_probability: hours((h) => (h < 12 ? 10 : null)),
    precipitation: hours((h) => (h === 14 ? 2.4 : 0)),
    weather_code: hours((h) => (h === 14 ? 61 : 2)),
    wind_speed_10m: hours(() => 12),
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  clearWeatherCache();
});

describe("hourlyUrl", () => {
  it("lists all points, elevation only when every point has one", () => {
    const u = hourlyUrl([{ lat: 46.12346, lng: 8.5, ele: 2165 }, { lat: 46.2, lng: 8.6, ele: 500 }], "2026-10-10");
    expect(u).toContain("latitude=46.1235,46.2000");
    expect(u).toContain("elevation=2165,500");
    expect(u).toContain("start_date=2026-10-10&end_date=2026-10-10");
    expect(u).toContain("timezone=Europe%2FZurich");
    expect(hourlyUrl([{ lat: 46, lng: 8 }, { lat: 46, lng: 8, ele: 1 }], "2026-10-10")).not.toContain("elevation=");
  });
});

describe("parseHourly / valueAt", () => {
  it("parses an array and a single object", () => {
    expect(parseHourly([loc(5), loc(10)])?.length).toBe(2);
    expect(parseHourly(loc(5))?.length).toBe(1);
    expect(parseHourly({ error: true })).toBeNull();
  });
  it("interpolates temperature between hours, takes the hour's rain", () => {
    const [s] = parseHourly([loc(5)])!;
    const v = valueAt(s, 14 * 60 + 30)!;
    expect(v.temp).toBeCloseTo(19.5, 5);
    expect(v.precip).toBe(2.4);
    expect(v.code).toBe(61);
    expect(v.precipProb).toBeNull(); // null in the data → null, not 0
    expect(valueAt(s, 9 * 60)!.precipProb).toBe(10);
  });
  it("clamps arrivals after midnight to the last hour", () => {
    const [s] = parseHourly([loc(5)])!;
    expect(valueAt(s, 25 * 60)!.temp).toBe(28);
  });
});

describe("fetchDayWeather", () => {
  const st = (lat: number, arriveMin: number): Station => ({ lat, lng: 8, km: 0, arriveMin, kind: "sample" });
  it("one request for all stations, cached afterwards", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([loc(5), loc(10)]), { status: 200 }),
    );
    const r = await fetchDayWeather([st(46, 600), st(46.5, 660)], "2026-10-10");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r[0]!.temp).toBe(15);
    expect(r[1]!.temp).toBe(21);
    await fetchDayWeather([st(46, 600)], "2026-10-10");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("throws on HTTP errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(fetchDayWeather([st(46, 600)], "2026-10-10")).rejects.toThrow();
  });
});

describe("summarize", () => {
  it("min/max over the day, ignoring missing values", () => {
    const s = summarize([
      { code: 2, temp: 6, precipProb: 10, precip: 0, wind: 5 },
      null,
      { code: 61, temp: 21, precipProb: 70, precip: 4, wind: 9 },
    ])!;
    expect(s).toEqual({ tMin: 6, tMax: 21, maxProb: 70, maxPrecip: 4, worstCode: 61 });
    expect(summarize([null])).toBeNull();
  });
});
