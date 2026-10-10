import { describe, it, expect, vi, afterEach } from "vitest";
import { bestWindow, windowLabel, clearOutlookCache, fetchOutlook, outlookUrl, parseOutlook, type Hour } from "./outlook";

const dry: Hour = { prob: 10, precip: 0 };
const wet: Hour = { prob: 80, precip: 1.5 };
const day = (wetHours: number[]): Hour[] => Array.from({ length: 24 }, (_, h) => (wetHours.includes(h) ? wet : dry));

describe("bestWindow", () => {
  it("whole riding day dry → 8–19", () => {
    expect(bestWindow(day([]))).toEqual({ from: 8, to: 19 });
  });
  it("longest dry run between 8 and 19", () => {
    // wet 8–9 and 17–23: dry 10–16 (to = 17)
    expect(bestWindow(day([8, 9, 17, 18, 19, 20]))).toEqual({ from: 10, to: 17 });
  });
  it("short gaps (< 2 h) don't count", () => {
    expect(bestWindow(day([8, 9, 11, 12, 14, 15, 17, 18]))).toBeNull();
  });
  it("starts no earlier than fromHour (today: now)", () => {
    expect(bestWindow(day([]), 14)).toEqual({ from: 14, to: 19 });
    expect(bestWindow(day([]), 18)).toBeNull(); // only 1 h left
  });
  it("high probability counts as wet even without amount; missing probability uses the amount", () => {
    const h = day([]);
    for (let i = 8; i < 12; i++) h[i] = { prob: 60, precip: 0 };
    h[15] = { prob: null, precip: 0 };
    expect(bestWindow(h)).toEqual({ from: 12, to: 19 });
  });
});

const hours = (f: (i: number) => number | null) => Array.from({ length: 72 }, (_, i) => f(i));
const sample = {
  daily: {
    time: ["2026-10-10", "2026-10-11", "2026-10-12"],
    weather_code: [3, 61, 0],
    temperature_2m_max: [18.4, 12.6, 20.2],
    temperature_2m_min: [7.6, 6.1, 8.0],
    precipitation_probability_max: [20, 90, null],
    precipitation_sum: [0, 7.25, 0],
  },
  hourly: {
    precipitation_probability: hours((i) => (i >= 24 && i < 48 ? 90 : 5)),
    precipitation: hours((i) => (i >= 24 && i < 48 ? 0.5 : 0)),
  },
};

describe("parseOutlook", () => {
  it("three days with rounded values and 24 hours each", () => {
    const d = parseOutlook(sample)!;
    expect(d).toHaveLength(3);
    expect(d[0]).toMatchObject({ date: "2026-10-10", code: 3, tMax: 18, tMin: 8, probMax: 20, precipSum: 0 });
    expect(d[1].precipSum).toBe(7.3);
    expect(d[2].probMax).toBeNull();
    expect(d[1].hours).toHaveLength(24);
    expect(d[1].hours[0]).toEqual({ prob: 90, precip: 0.5 });
  });
  it("null for an unexpected answer", () => {
    expect(parseOutlook({})).toBeNull();
    expect(parseOutlook(null)).toBeNull();
  });
});

describe("fetchOutlook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearOutlookCache();
  });
  it("url asks 3 days in Swiss time", () => {
    const u = outlookUrl(46.0037, 8.9511);
    expect(u).toContain("latitude=46.004&longitude=8.951");
    expect(u).toContain("forecast_days=3");
    expect(u).toContain("timezone=Europe%2FZurich");
  });
  it("caches nearby points (same ~5 km cell)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(sample)));
    await fetchOutlook(46.0, 8.95);
    await fetchOutlook(46.01, 8.96);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("throws on HTTP errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(fetchOutlook(46, 8)).rejects.toThrow();
  });
});

describe("windowLabel", () => {
  it("names the window, says when nothing fits, and when today's riding day is over", () => {
    expect(windowLabel(day([]))).toBe("trocken 8–19 Uhr");
    expect(windowLabel(day([8, 9, 11, 12, 14, 15, 17, 18]))).toBe("kaum trocken");
    expect(windowLabel(day([]), 18)).toBe("Fahrtag vorbei");
    expect(windowLabel(day([]), 21)).toBe("Fahrtag vorbei");
  });
});
