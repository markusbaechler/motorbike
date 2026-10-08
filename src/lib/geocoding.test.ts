import { describe, it, expect } from "vitest";
import { reverseLabel } from "./geocoding";

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
