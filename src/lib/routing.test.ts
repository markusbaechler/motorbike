import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearLegCache, fetchRoute } from "./routing";
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

beforeEach(() => clearLegCache());
afterEach(() => vi.unstubAllGlobals());

describe("routing against the public BRouter", () => {
  it("retries a 403 with backoff and never falls back to another profile", async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(403, "Please, retry later!")).mockResolvedValue(resp(200));
    vi.stubGlobal("fetch", f);
    const [a, b] = fresh();
    const r = await fetchRoute([a, b]);
    expect(r.distanceKm).toBeCloseTo(12);
    expect(calls().map(profileOf)).toEqual(["car-fast", "car-fast"]);
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
