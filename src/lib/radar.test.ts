import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRadarFrames, nextFrame, parseFrames, RADAR_MAX_ZOOM } from "./radar";

const sample = {
  host: "https://tilecache.rainviewer.com",
  radar: {
    past: [
      { time: 1791647400, path: "/v2/radar/aaa" },
      { time: 1791648000, path: "/v2/radar/bbb" },
    ],
    nowcast: [],
  },
};

afterEach(() => vi.restoreAllMocks());

describe("parseFrames", () => {
  it("builds one tile URL per past frame, oldest first", () => {
    const f = parseFrames(sample);
    expect(f.map((x) => x.time)).toEqual([1791647400, 1791648000]);
    expect(f[1].tiles).toBe("https://tilecache.rainviewer.com/v2/radar/bbb/256/{z}/{x}/{y}/2/1_1.png");
  });
  it("sorts by time and ignores broken entries", () => {
    const f = parseFrames({
      host: "https://h",
      radar: { past: [{ time: 2, path: "/b" }, { time: "x", path: "/c" }, { time: 1, path: "/a" }, null] },
    });
    expect(f.map((x) => x.time)).toEqual([1, 2]);
  });
  it("returns [] for an unexpected answer", () => {
    expect(parseFrames(null)).toEqual([]);
    expect(parseFrames({ radar: {} })).toEqual([]);
    expect(parseFrames({ host: 5, radar: { past: [{ time: 1, path: "/a" }] } })).toEqual([]);
  });
  it("max zoom matches what the free API serves", () => {
    expect(RADAR_MAX_ZOOM).toBe(7);
  });
});

describe("nextFrame", () => {
  it("steps forward and wraps around", () => {
    expect(nextFrame(0, 3)).toBe(1);
    expect(nextFrame(2, 3)).toBe(0);
    expect(nextFrame(0, 0)).toBe(0);
  });
});

describe("fetchRadarFrames", () => {
  it("fetches the public list", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(sample)));
    const f = await fetchRadarFrames();
    expect(spy.mock.calls[0][0]).toBe("https://api.rainviewer.com/public/weather-maps.json");
    expect(f).toHaveLength(2);
  });
  it("throws on HTTP errors and empty lists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 503 }));
    await expect(fetchRadarFrames()).rejects.toThrow();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ radar: { past: [] } })));
    await expect(fetchRadarFrames()).rejects.toThrow();
  });
});
