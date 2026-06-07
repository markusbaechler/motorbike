import { describe, it, expect } from "vitest";
import { buildGpx } from "./gpx";
import type { Waypoint } from "../types";

const wps: Waypoint[] = [
  { id: "a", lng: 8.5, lat: 46.5, legProfile: "kurvig", name: "Start" },
  { id: "b", lng: 9.0, lat: 46.8, legProfile: "kurvig", name: "Ziel" },
];
const feats: GeoJSON.Feature[] = [
  {
    type: "Feature",
    properties: { legIndex: 0 },
    geometry: { type: "LineString", coordinates: [[8.5, 46.5], [8.75, 46.65], [9.0, 46.8]] },
  },
];

describe("buildGpx", () => {
  it("produces a GPX document containing the geometry", () => {
    const gpx = buildGpx("Test", wps, feats, "route");
    expect(gpx).toContain("<gpx");
    expect(gpx).toContain("</gpx>");
    expect(gpx).toContain("46.5");
  });

  it("waypoints mode omits standalone <wpt> pins", () => {
    const gpx = buildGpx("Test", wps, feats, "waypoints");
    expect(gpx).not.toContain("<wpt ");
  });
});
