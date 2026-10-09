import { describe, it, expect } from "vitest";
import { enterAction, reverseLabel, toResults } from "./geocoding";

describe("enterAction (Enter in a place field)", () => {
  it("takes the highlighted hit the rider chose with the arrow keys", () => {
    expect(enterAction({ active: 2, count: 5, resultsFor: "Monte Ce", query: "Monte Ceneri" })).toBe("pick-active");
  });

  it("takes the first hit when the list belongs to what is typed", () => {
    expect(enterAction({ active: -1, count: 5, resultsFor: "Monte Ceneri", query: "Monte Ceneri " })).toBe("pick-first");
  });

  it("searches again instead of taking a hit for an older, shorter input", () => {
    // "Monte Ce" → first hit "Monte Cerignone, Marken, Italien".
    expect(enterAction({ active: -1, count: 5, resultsFor: "Monte Ce", query: "Monte Ceneri" })).toBe("search-now");
  });

  it("searches when typed text has no list yet", () => {
    expect(enterAction({ active: -1, count: 0, resultsFor: "", query: "Insone" })).toBe("search-now");
  });

  it("does nothing for less than three characters", () => {
    expect(enterAction({ active: -1, count: 0, resultsFor: "", query: "In" })).toBe("none");
  });
});

describe("reverse geocoding label", () => {
  it("names a point next to a house after the village", () => {
    expect(
      reverseLabel({ osm_key: "building", type: "house", housenumber: "32", street: "Gotthardstrasse", city: "Wassen UR", state: "Uri", country: "Schweiz" }),
    ).toBe("Wassen UR, Uri, Schweiz");
  });

  it("keeps a named place such as a pass", () => {
    expect(reverseLabel({ osm_key: "mountain_pass", type: "other", name: "Furkapass", state: "Uri", country: "Schweiz" })).toBe(
      "Furkapass, Uri, Schweiz",
    );
  });

  it("returns null when nothing usable comes back", () => {
    expect(reverseLabel({})).toBeNull();
    expect(reverseLabel({ osm_key: "building", housenumber: "3" })).toBeNull();
  });
});

// Photon's answer for "Monte Ceneri" near Lugano (2026-10-09), trimmed.
const f = (lng: number, lat: number, props: Record<string, string>) => ({
  geometry: { coordinates: [lng, lat] as [number, number] },
  properties: { city: "Monteceneri", state: "Tessin", country: "Schweiz", ...props },
});
const MONTE_CENERI = [
  f(8.90709, 46.13918, { name: "Monte Ceneri", osm_key: "mountain_pass", osm_value: "yes" }),
  f(8.90724, 46.1384, { name: "Monte Ceneri", osm_key: "tourism", osm_value: "caravan_site" }),
  f(8.92369, 46.13923, { name: "Monte Ceneri", osm_key: "tunnel", osm_value: "yes" }),
  f(8.92318, 46.13941, { name: "Monte Ceneri", osm_key: "tunnel", osm_value: "yes" }),
  f(8.90587, 46.13924, { name: "Monte Ceneri", osm_key: "information", osm_value: "guidepost" }),
  f(8.96903, 46.11519, { name: "Monte Ceneri", osm_key: "information", osm_value: "map" }),
  f(8.9, 46.14, { name: "Caserma del Monte Ceneri", osm_key: "landuse", osm_value: "military" }),
  f(9.19, 45.49, { name: "Viale Monte Ceneri", osm_key: "highway", osm_value: "primary", city: "Mailand", state: "Lombardei", country: "Italien" }),
];

describe("toResults", () => {
  const results = toResults(MONTE_CENERI);

  it("says what each hit is, so identical names can be told apart", () => {
    expect(results.map((r) => [r.name, r.kind])).toEqual([
      ["Monte Ceneri, Monteceneri, Tessin, Schweiz", "Pass"],
      ["Monte Ceneri, Monteceneri, Tessin, Schweiz", "Camping"],
      ["Monte Ceneri, Monteceneri, Tessin, Schweiz", "Tunnel"],
      ["Viale Monte Ceneri, Mailand, Lombardei, Italien", "Strasse"],
    ]);
  });

  it("drops info boards, guideposts and land use – nothing to ride to", () => {
    expect(results.some((r) => r.name.startsWith("Caserma"))).toBe(false);
    expect(results).toHaveLength(4);
  });

  it("keeps one of two hits with the same name and kind close together", () => {
    expect(results.filter((r) => r.kind === "Tunnel")).toHaveLength(1);
  });

  it("keeps the coordinates of the hit", () => {
    expect(results[0]).toMatchObject({ lng: 8.90709, lat: 46.13918 });
  });

  it("labels villages and streets of the same name differently", () => {
    const r = toResults([
      f(9.03, 46.0866, { name: "Insone", osm_key: "place", osm_value: "village", city: undefined as unknown as string }),
      f(9.03, 46.07, { name: "Insone", osm_key: "highway", osm_value: "residential", city: "Lugano" }),
    ]);
    expect(r.map((x) => x.kind)).toEqual(["Ort", "Strasse"]);
  });

  it("tells a city from the canton of the same name", () => {
    const r = toResults([
      f(7.452, 46.948, { name: "Bern", osm_key: "place", osm_value: "city", city: undefined as unknown as string, state: "Bern" }),
      f(7.6, 46.838, { name: "Bern", osm_key: "place", osm_value: "state", city: undefined as unknown as string, state: "Bern" }),
    ]);
    expect(r.map((x) => x.kind)).toEqual(["Stadt", "Region"]);
  });

  it("stops after the given number of hits", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      f(8 + i, 46, { name: `Dorf ${i}`, osm_key: "place", osm_value: "village" }),
    );
    expect(toResults(many, 6)).toHaveLength(6);
  });
});
