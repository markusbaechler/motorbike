import { describe, it, expect } from "vitest";
import { decodeMigration, encodeMigration, hasAnythingToMigrate, type MigrationPayload } from "./migrate";

const payload: MigrationPayload = {
  v: 1,
  routes: [
    {
      id: "r-1",
      name: "Alpentour",
      createdAt: 1,
      updatedAt: 2,
      waypoints: [
        { id: "a", lng: 8.5, lat: 46.5, legProfile: "kurvig", name: "Wassen" },
        { id: "b", lng: 8.6, lat: 46.6, legProfile: "schnell", dayEnd: true, dayDate: "2026-10-15" },
      ],
    },
  ],
  draft: {
    waypoints: [{ id: "d", lng: 9, lat: 47, legProfile: "kurvig_plus" }],
    defaultProfile: "kurvig_plus",
    savedAt: 3,
  },
  booking: { adults: 3, children: 1, rooms: 2 },
  recent: [{ name: "Andermatt", lat: 46.63, lng: 8.59 }],
};

describe("migration payload", () => {
  it("round-trips routes, draft, booking and recents", () => {
    const out = decodeMigration(encodeMigration(payload))!;
    expect(out).not.toBeNull();
    expect(out.routes).toHaveLength(1);
    expect(out.routes[0].name).toBe("Alpentour");
    expect(out.routes[0].waypoints[1]).toMatchObject({ legProfile: "schnell", dayEnd: true, dayDate: "2026-10-15" });
    expect(out.draft?.defaultProfile).toBe("kurvig_plus");
    expect(out.booking).toEqual({ adults: 3, children: 1, rooms: 2, affiliateId: undefined });
    expect(out.recent[0].name).toBe("Andermatt");
    expect(hasAnythingToMigrate(out)).toBe(true);
  });

  it("drops broken tours and recents but keeps the rest", () => {
    const dirty = {
      ...payload,
      routes: [...payload.routes, { id: "x", name: "Kaputt", waypoints: [{ lng: "a", lat: 1 }] }],
      recent: [...payload.recent, { name: "", lat: 1, lng: 2 }, { name: "NaN", lat: Number.NaN, lng: 2 }],
      booking: { adults: -5, children: "x", rooms: 0 },
    };
    const out = decodeMigration(btoa(JSON.stringify(dirty)))!;
    expect(out.routes.map((r) => r.name)).toEqual(["Alpentour"]);
    expect(out.recent).toHaveLength(1);
    expect(out.booking).toEqual({ adults: 2, children: 0, rooms: 1, affiliateId: undefined });
  });

  it("rejects garbage and unknown versions", () => {
    expect(decodeMigration("%%%")).toBeNull();
    expect(decodeMigration(btoa(JSON.stringify({ v: 2, routes: [] })))).toBeNull();
    expect(decodeMigration(btoa("null"))).toBeNull();
  });

  it("reports nothing to migrate for an empty device", () => {
    const out = decodeMigration(btoa(JSON.stringify({ v: 1, routes: [], draft: null, booking: {}, recent: [] })))!;
    expect(hasAnythingToMigrate(out)).toBe(false);
  });
});
