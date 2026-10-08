import { describe, it, expect } from "vitest";
import { sanitizeWaypoint, sanitizeWaypoints } from "./validate";

const good = { lng: 8.5, lat: 46.5, legProfile: "schnell", name: "Start", dayEnd: true, dayDate: "2026-10-15" };

describe("sanitizeWaypoint", () => {
  it("keeps valid fields and assigns an id when missing", () => {
    const w = sanitizeWaypoint(good, "t")!;
    expect(w).toMatchObject({ lng: 8.5, lat: 46.5, legProfile: "schnell", name: "Start", dayEnd: true, dayDate: "2026-10-15" });
    expect(w.id.startsWith("t-")).toBe(true);
  });

  it("rejects NaN, strings and out-of-range coordinates", () => {
    expect(sanitizeWaypoint({ ...good, lng: Number.NaN })).toBeNull();
    expect(sanitizeWaypoint({ ...good, lat: "46.5" })).toBeNull();
    expect(sanitizeWaypoint({ ...good, lat: 91 })).toBeNull();
    expect(sanitizeWaypoint({ ...good, lng: -181 })).toBeNull();
    expect(sanitizeWaypoint(null)).toBeNull();
    expect(sanitizeWaypoint("x")).toBeNull();
  });

  it("falls back for unknown profiles, bad dates and non-string names", () => {
    const w = sanitizeWaypoint({ lng: 1, lat: 2, legProfile: "warp", dayDate: "15.10.2026", name: 42, dayEnd: "yes" })!;
    expect(w.legProfile).toBe("kurvig");
    expect(w.dayDate).toBeUndefined();
    expect(w.name).toBeUndefined();
    expect(w.dayEnd).toBeUndefined();
  });

  it("trims and caps long names", () => {
    const w = sanitizeWaypoint({ lng: 1, lat: 2, name: "  " + "x".repeat(500) })!;
    expect(w.name).toHaveLength(200);
  });
});

describe("sanitizeWaypoints", () => {
  it("returns null for non-arrays and for lists with one broken entry", () => {
    expect(sanitizeWaypoints({})).toBeNull();
    expect(sanitizeWaypoints([good, { lng: 1 }])).toBeNull();
  });

  it("returns a clean copy for valid lists", () => {
    const out = sanitizeWaypoints([good, { lng: 9, lat: 47 }])!;
    expect(out).toHaveLength(2);
    expect(out[1].legProfile).toBe("kurvig");
  });
});
