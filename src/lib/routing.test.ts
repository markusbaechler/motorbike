import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearLegCache, CURVY_PROFILE, fetchRoute, primeLegs, splitAtStops } from "./routing";
import { configureQueue, QUEUE_DEFAULTS, resetQueue } from "./queue";
import type { Waypoint } from "../types";

// "schnell" uses stock profiles only, so no profile upload gets in the way.
const wp = (id: string, lng: number, lat: number): Waypoint => ({ id, lng, lat, legProfile: "schnell" });
const GEOJSON = JSON.stringify({
  features: [{ type: "Feature", properties: { "track-length": "12000" }, geometry: { type: "LineString", coordinates: [] } }],
});
const resp = (status: number, body = GEOJSON) => ({
  ok: status < 400,
  status,
  text: async () => body,
  json: async () => JSON.parse(body),
});
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
const profileOf = (url: string) => new URL(url).searchParams.get("profile");

let counter = 0;
// Fresh coordinates per test so the module-level cache never leaks between tests.
const fresh = () => {
  counter++;
  return [wp("a", 8 + counter, 46), wp("b", 8.1 + counter, 46.1), wp("c", 8.2 + counter, 46.2)];
};

// Real pacing (15/min, 30 s pause) would make these tests wait for minutes.
const PAUSE_MS = 60;
beforeEach(() => {
  clearLegCache();
  resetQueue();
  configureQueue({ limit: 1000, windowMs: 60_000, pauseMs: PAUSE_MS });
});
afterEach(() => {
  vi.unstubAllGlobals();
  configureQueue(QUEUE_DEFAULTS);
  resetQueue();
});

describe("routing against the public BRouter", () => {
  it("waits out a 403 in the shared pause, then succeeds without a fallback profile", async () => {
    const at: number[] = [];
    const f = vi.fn().mockImplementation(() => {
      at.push(Date.now());
      return Promise.resolve(at.length === 1 ? resp(403, "Please, retry later!") : resp(200));
    });
    vi.stubGlobal("fetch", f);
    // Longer than the old private backoff (700 ms), so only the shared
    // pause can explain the gap.
    configureQueue({ limit: 1000, windowMs: 60_000, pauseMs: 1200 });
    const [a, b] = fresh();
    const r = await fetchRoute([a, b]);
    expect(r.distanceKm).toBeCloseTo(12);
    expect(calls().map(profileOf)).toEqual(["car-fast", "car-fast"]);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(1150);
  }, 10000);

  it("gives up on persistent throttling with a clear message, without a fallback request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp(403, "Please, retry later!")));
    const [a, b] = fresh();
    await expect(fetchRoute([a, b])).rejects.toThrow(/Etappe 1: Routing-Dienst ist gerade ausgelastet \(HTTP 403\)/);
    expect(new Set(calls().map(profileOf))).toEqual(new Set(["car-fast"]));
  }, 15000);

  it("still tries the fallback profile on a 400", async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(400, "no track found")).mockResolvedValue(resp(200));
    vi.stubGlobal("fetch", f);
    const [a, b] = fresh();
    await fetchRoute([a, b]);
    expect(calls().map(profileOf)).toEqual(["car-fast", "car-eco"]);
  });

  it("serves unchanged legs from the cache after an edit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp(200)));
    const [a, b, c] = fresh();
    await fetchRoute([a, b, c]);
    expect(calls()).toHaveLength(2);
    // Move the last point: only the leg into it is new.
    await fetchRoute([a, b, { ...c, lat: c.lat + 0.01 }]);
    expect(calls()).toHaveLength(3);
    // Names and day ends do not matter for routing.
    await fetchRoute([{ ...a, name: "Start" }, { ...b, dayEnd: true }, { ...c, lat: c.lat + 0.01 }]);
    expect(calls()).toHaveLength(3);
  });

  it("keeps the good legs when one fails, so the retry only fetches the broken one", async () => {
    // Leg 2 ends at lat 46.2 and fails on both profiles; leg 1 succeeds.
    const f = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url.includes(",46.200000") ? resp(400, "target island") : resp(200)),
    );
    vi.stubGlobal("fetch", f);
    const [a, b, c] = fresh();
    await expect(fetchRoute([a, b, c])).rejects.toThrow(/Etappe 2: HTTP 400 – target island/);
    const before = calls().length;
    expect(before).toBe(3); // leg 1 once, leg 2 with both profiles
    f.mockResolvedValue(resp(200));
    await fetchRoute([a, b, c]);
    expect(calls().length - before).toBe(1);
  });

  it("shares an in-flight leg and only cancels it when every caller let go", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const f = vi.fn().mockImplementation(() => new Promise((r) => (resolveFetch = r)));
    vi.stubGlobal("fetch", f);
    const [a, b] = fresh();
    const first = new AbortController();
    const second = new AbortController();
    const p1 = fetchRoute([a, b], first.signal);
    const p2 = fetchRoute([a, b], second.signal);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls()).toHaveLength(1);
    first.abort();
    await expect(p1).rejects.toMatchObject({ name: "AbortError" });
    resolveFetch(resp(200));
    expect((await p2).distanceKm).toBeCloseTo(12);
  });

  it("drops a leg that every caller abandoned", async () => {
    const f = vi.fn().mockImplementation((_u: string, init: { signal: AbortSignal }) =>
      new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
    );
    vi.stubGlobal("fetch", f);
    const [a, b] = fresh();
    const ctrl = new AbortController();
    const p = fetchRoute([a, b], ctrl.signal);
    await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    // A new caller starts a new request instead of inheriting the dead one.
    f.mockResolvedValue(resp(200));
    await fetchRoute([a, b]);
    expect(calls()).toHaveLength(2);
  });
});

// The Fun profiles route motorcycles, not mopeds. Reported: Wolfgangpass →
// Klosters Dorf was 121.7 km (via Chur and Landquart) instead of 9.8 km,
// because the curvy profile, derived from BRouter's moped profile, refused
// the Klosters bypass – an Autostrasse (motorroad=yes) motorcycles may use.
describe("curvy profile for motorcycles", () => {
  it("lets motorcycles use an Autostrasse (motorroad=yes)", () => {
    expect(CURVY_PROFILE).not.toMatch(/motorroad=yes\s+10000/);
  });

  it("allows motorways, but at a cost that keeps Fun routes off them", () => {
    const access = CURVY_PROFILE.split("assign caraccess")[0];
    expect(access).toMatch(/highway=motorway highway=motorway_link\s+1/);
    expect(CURVY_PROFILE).toMatch(/highway=motorway highway=motorway_link\s+20/);
  });

  it("never falls back to the moped profile for Fun 2", async () => {
    // Profile upload fails → stock fallback chain only.
    const f = vi.fn().mockImplementation((_url: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === "POST" ? resp(500, "down") : resp(200)),
    );
    vi.stubGlobal("fetch", f);
    const [a, b] = fresh().map((w) => ({ ...w, legProfile: "kurvig_plus" as const }));
    await fetchRoute([a, b]);
    const routed = calls().filter((u) => u.includes("lonlats="));
    expect(routed.map(profileOf)).not.toContain("moped");
  });
});

// The Tour-Genius already routed each candidate in one request. Showing it
// must not route it again – that request came right after the Genius burst
// and ran into the server's 403 ("Etappe 1: … ausgelastet").
describe("taking over a route the Tour-Genius already computed", () => {
  // A line north along lng 9.5, ~111 m per 0.001°; elevation as 3rd value.
  const line = Array.from({ length: 11 }, (_, i) => [9.5, 46 + i * 0.001, 500 + i]);

  it("splits the line at each via stop, the stop point belonging to both legs", () => {
    const stops = [
      { lng: 9.5, lat: 46 },
      { lng: 9.5003, lat: 46.004 }, // ~23 m beside the line (snapped)
      { lng: 9.5, lat: 46.01 },
    ];
    const legs = splitAtStops(line, stops);
    expect(legs.map((l) => l.length)).toEqual([5, 7]);
    expect(legs[0][legs[0].length - 1]).toEqual(legs[1][0]);
    expect(legs[1][legs[1].length - 1]).toEqual(line[line.length - 1]);
  });

  it("takes the first pass by a stop on a loop that comes by twice", () => {
    // Out north to 46.006, back south to the start.
    const loop = [...line.slice(0, 7), ...line.slice(0, 6).reverse()];
    const stops = [
      { lng: 9.5, lat: 46 },
      { lng: 9.5, lat: 46.003 }, // passed on the way out AND back
      { lng: 9.5, lat: 46.006 },
      { lng: 9.5, lat: 46 },
    ];
    const legs = splitAtStops(loop, stops);
    expect(legs.map((l) => l.length)).toEqual([4, 4, 7]);
  });

  it("hands each row of BRouter's segment table to its own leg", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp(200)));
    counter++;
    const coords = line.map((c) => [c[0] + counter, c[1], c[2]]);
    const micro = (c: number[]) => [String(Math.round(c[0] * 1e6)), String(Math.round(c[1] * 1e6))];
    const header = ["Longitude", "Latitude", "Elevation", "Distance", "WayTags"];
    // Segments end at points 2, 4 (= the via stop), 7 and 10.
    const rows = [2, 4, 7, 10].map((i, n) => [...micro(coords[i]), "500", String(100 + n), `highway=road${n}`]);
    const stops = [coords[0], coords[4], coords[10]].map((c) => ({ lng: c[0], lat: c[1] }));
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: { messages: [header, ...rows] },
      geometry: { type: "LineString", coordinates: coords },
    };
    primeLegs(stops, feature, "kurvig");
    const r = await fetchRoute(stops.map((s, i) => ({ id: `m${i}`, ...s, legProfile: "kurvig" as const })));
    const tagsOf = (f: GeoJSON.Feature) =>
      ((f.properties as { messages: string[][] }).messages.slice(1)).map((row) => row[4]);
    expect(tagsOf(r.geojson.features[0])).toEqual(["highway=road0", "highway=road1"]);
    expect(tagsOf(r.geojson.features[1])).toEqual(["highway=road2", "highway=road3"]);
  });

  it("primes the leg cache so showing the tour needs no request at all", async () => {
    const f = vi.fn().mockResolvedValue(resp(200));
    vi.stubGlobal("fetch", f);
    counter++;
    const base = 9.5 + counter; // fresh coordinates → no cache leftovers
    const coords = line.map((c) => [c[0] + counter, c[1], c[2]]);
    const stops = [
      { lng: base, lat: 46 },
      { lng: base, lat: 46.004 },
      { lng: base, lat: 46.01 },
    ];
    const feature: GeoJSON.Feature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
    primeLegs(stops, feature, "kurvig_plus");
    const r = await fetchRoute(stops.map((s, i) => ({ id: `g${i}`, ...s, legProfile: "kurvig_plus" as const })));
    expect(f).not.toHaveBeenCalled();
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].distanceKm).toBeCloseTo(0.445, 2);
    expect(r.distanceKm).toBeCloseTo(1.112, 2);
  });
});
