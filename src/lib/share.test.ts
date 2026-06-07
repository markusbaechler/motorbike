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

  it("returns null for garbage input", () => {
    expect(decodeRoute("§§not-valid§§")).toBeNull();
  });
});
