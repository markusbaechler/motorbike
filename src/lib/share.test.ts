import { describe, it, expect } from "vitest";
import { encodeRoute, decodeRoute } from "./share";
import type { Waypoint } from "../types";

const wps: Waypoint[] = [
  { id: "a", lng: 8.5, lat: 46.5, legProfile: "kurvig", name: "Start" },
  { id: "b", lng: 9.1, lat: 46.9, legProfile: "schnell", dayEnd: true, name: "Ziel" },
];

describe("share encode/decode", () => {
  it("roundtrips coords, profile, flags and names", () => {
    const out = decodeRoute(encodeRoute(wps));
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(2);
    expect(out![0].lng).toBeCloseTo(8.5, 4);
    expect(out![0].lat).toBeCloseTo(46.5, 4);
    expect(out![1].legProfile).toBe("schnell");
    expect(out![1].dayEnd).toBe(true);
    expect(out![1].name).toBe("Ziel");
  });

  it("keeps a typed name whole and marked as typed", () => {
    const typed: Waypoint[] = [wps[0], { ...wps[1], name: "Kaffee, Löwen", nameEdited: true }];
    const out = decodeRoute(encodeRoute(typed))!;
    expect(out[1]).toMatchObject({ name: "Kaffee, Löwen", nameEdited: true });
    expect(out[0].nameEdited).toBeUndefined();
  });

  it("returns null for garbage input", () => {
    expect(decodeRoute("§§not-valid§§")).toBeNull();
  });

  it("rejects well-formed links with unusable coordinates", () => {
    const rows = [
      [8.5, 46.5, "k", 0, "A", "", ""],
      ["8.9", 46.9, "s", 0, "B", "", ""],
    ];
    expect(decodeRoute(btoa(JSON.stringify({ v: 1, w: rows })))).toBeNull();
    const outOfRange = [[8.5, 46.5, "k", 0, "", "", ""], [200, 46.9, "k", 0, "", "", ""]];
    expect(decodeRoute(btoa(JSON.stringify({ v: 1, w: outOfRange })))).toBeNull();
  });

  it("rejects payloads whose waypoint list is not an array", () => {
    expect(decodeRoute(btoa(JSON.stringify({ v: 1, w: "nope" })))).toBeNull();
    expect(decodeRoute(btoa(JSON.stringify({ v: 1, w: [[1, 2], "x"] })))).toBeNull();
  });

  it("falls back to a known profile and drops invalid dates", () => {
    const rows = [[8.5, 46.5, "zz", 1, "A", "Tag", "15.10.2026"], [9, 47, "p", 0, "", "", ""]];
    const out = decodeRoute(btoa(JSON.stringify({ v: 1, w: rows })))!;
    expect(out[0].legProfile).toBe("kurvig");
    expect(out[0].dayEnd).toBe(true);
    expect(out[0].dayDate).toBeUndefined();
    expect(out[1].legProfile).toBe("kurvig_plus");
  });
});
