import { describe, it, expect } from "vitest";
import {
  pointLabel,
  isClosedLoop,
  appendWaypoint,
  insertWaypoint,
  replaceEnd,
  prependWaypoint,
  addDayEnd,
  reorderWaypoint,
  canReorder,
  closeLoop,
  reverseWaypoints,
} from "./waypoints";
import type { Waypoint } from "../types";

// Open tour S → A → B (three distinct places).
const open = (): Waypoint[] => [
  { id: "s", lng: 8.0, lat: 46.0, name: "Start", legProfile: "kurvig" },
  { id: "a", lng: 8.1, lat: 46.1, name: "A", legProfile: "schnell" },
  { id: "b", lng: 8.2, lat: 46.2, name: "B", legProfile: "kurvig_plus" },
];

// Closed round trip S → A → B → S' (S' is a copy of S with its own id).
const loop = (): Waypoint[] => [
  ...open(),
  { id: "s2", lng: 8.0, lat: 46.0, name: "Start", legProfile: "kurvig" },
];

const NEW = { id: "n", lng: 9.0, lat: 47.0, name: "Neu" };

describe("isClosedLoop", () => {
  it("is false for an open tour", () => {
    expect(isClosedLoop(open())).toBe(false);
  });

  it("is true when first and last share the same coordinates", () => {
    expect(isClosedLoop(loop())).toBe(true);
  });

  it("is false for two identical points (needs at least three)", () => {
    const s = open()[0];
    expect(isClosedLoop([s, { ...s, id: "s2" }])).toBe(false);
  });

  it("is false for empty and single-point lists", () => {
    expect(isClosedLoop([])).toBe(false);
    expect(isClosedLoop([open()[0]])).toBe(false);
  });
});

describe("appendWaypoint", () => {
  it("appends at the end of an open tour with the default profile", () => {
    const out = appendWaypoint(open(), NEW, "schnell");
    expect(out.map((w) => w.id)).toEqual(["s", "a", "b", "n"]);
    expect(out[3].legProfile).toBe("schnell");
  });

  it("inserts before the closing point of a round trip", () => {
    const out = appendWaypoint(loop(), NEW, "schnell");
    expect(out.map((w) => w.id)).toEqual(["s", "a", "b", "n", "s2"]);
    expect(isClosedLoop(out)).toBe(true);
  });

  it("gives the new point the default profile and leaves the closing leg profile alone", () => {
    const out = appendWaypoint(loop(), NEW, "schnell");
    expect(out[3].legProfile).toBe("schnell"); // B → NEU
    expect(out[4].legProfile).toBe("kurvig"); // NEU → Start (unchanged)
  });

  it("keeps dayEnd flags where they are", () => {
    const wps = loop();
    wps[2].dayEnd = true;
    const out = appendWaypoint(wps, NEW, "schnell");
    expect(out[2].dayEnd).toBe(true);
    expect(out[3].dayEnd).toBeUndefined();
    expect(out[4].dayEnd).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const wps = loop();
    appendWaypoint(wps, NEW, "schnell");
    expect(wps.map((w) => w.id)).toEqual(["s", "a", "b", "s2"]);
  });
});

describe("insertWaypoint", () => {
  it("inserts after legIndex and takes that leg's profile", () => {
    const out = insertWaypoint(open(), 0, NEW, "kurvig");
    expect(out.map((w) => w.id)).toEqual(["s", "n", "a", "b"]);
    expect(out[1].legProfile).toBe("schnell"); // profile of leg S → A
  });

  it("falls back to the default profile when there is no destination", () => {
    const out = insertWaypoint(open(), 2, NEW, "kurvig");
    expect(out.map((w) => w.id)).toEqual(["s", "a", "b", "n"]);
    expect(out[3].legProfile).toBe("kurvig");
  });
});

describe("replaceEnd", () => {
  it("appends on an open tour (old end becomes a via)", () => {
    const out = replaceEnd(open(), NEW, "schnell");
    expect(out.map((w) => w.id)).toEqual(["s", "a", "b", "n"]);
    expect(out[3].legProfile).toBe("schnell");
  });

  it("replaces the closing point of a round trip and opens the loop", () => {
    const out = replaceEnd(loop(), NEW, "schnell");
    expect(out.map((w) => w.id)).toEqual(["s", "a", "b", "n"]);
    expect(out[3].legProfile).toBe("schnell");
    expect(isClosedLoop(out)).toBe(false);
  });

  it("starts a tour from nothing", () => {
    expect(replaceEnd([], NEW, "kurvig").map((w) => w.id)).toEqual(["n"]);
  });
});

describe("prependWaypoint", () => {
  it("puts the point first and gives the old start the default profile", () => {
    const out = prependWaypoint(open(), NEW, "schnell");
    expect(out.map((w) => w.id)).toEqual(["n", "s", "a", "b"]);
    expect(out[1].legProfile).toBe("schnell");
  });

  it("keeps a round trip closed by moving the closing point too", () => {
    const out = prependWaypoint(loop(), NEW, "schnell");
    expect(out.map((w) => w.id)).toEqual(["n", "s", "a", "b", "s2"]);
    expect(isClosedLoop(out)).toBe(true);
    expect(out[4]).toMatchObject({ lng: 9.0, lat: 47.0 });
    expect(out[4].legProfile).toBe("kurvig"); // leg B → new start keeps its profile
  });
});

describe("addDayEnd", () => {
  it("flags the last point on an open tour", () => {
    const out = addDayEnd(open());
    expect(out[2].dayEnd).toBe(true);
    expect(out[1].dayEnd).toBeUndefined();
  });

  it("flags the point before the closing point on a round trip", () => {
    const out = addDayEnd(loop());
    expect(out[2].dayEnd).toBe(true); // len-2
    expect(out[3].dayEnd).toBeUndefined(); // closing point untouched
  });

  it("returns the same list when nothing can change", () => {
    const single = [open()[0]];
    expect(addDayEnd(single)).toBe(single);
    const flagged = loop();
    flagged[2].dayEnd = true;
    expect(addDayEnd(flagged)).toBe(flagged);
  });
});

describe("reorderWaypoint", () => {
  it("swaps places but keeps legProfile and dayEnd at their list position", () => {
    const wps = open();
    wps[1].dayEnd = true;
    const out = reorderWaypoint(wps, "a", 1);
    expect(out.map((w) => w.id)).toEqual(["s", "b", "a"]);
    expect(out.map((w) => w.name)).toEqual(["Start", "B", "A"]);
    expect(out.map((w) => w.legProfile)).toEqual(["kurvig", "schnell", "kurvig_plus"]);
    expect(out[1].dayEnd).toBe(true);
    expect(out[2].dayEnd).toBeUndefined();
  });

  it("keeps day labels with the position as well", () => {
    const wps = open();
    wps[1].dayEnd = true;
    wps[1].dayName = "Tag 1";
    wps[1].dayDate = "2026-07-01";
    const out = reorderWaypoint(wps, "a", 1);
    expect(out[1]).toMatchObject({ id: "b", dayName: "Tag 1", dayDate: "2026-07-01" });
    expect(out[2].dayName).toBeUndefined();
  });

  it("refuses to move past the ends", () => {
    const wps = open();
    expect(reorderWaypoint(wps, "s", -1)).toBe(wps);
    expect(reorderWaypoint(wps, "b", 1)).toBe(wps);
  });

  it("never moves the start or the closing point of a round trip", () => {
    const wps = loop();
    expect(reorderWaypoint(wps, "a", -1)).toBe(wps); // would swap with start
    expect(reorderWaypoint(wps, "b", 1)).toBe(wps); // would swap with closing point
    expect(reorderWaypoint(wps, "s", 1)).toBe(wps);
    expect(reorderWaypoint(wps, "s2", -1)).toBe(wps);
    expect(reorderWaypoint(wps, "a", 1).map((w) => w.id)).toEqual(["s", "b", "a", "s2"]);
  });
});

describe("canReorder", () => {
  it("mirrors the open-tour limits", () => {
    const wps = open();
    expect(canReorder(wps, 0, -1)).toBe(false);
    expect(canReorder(wps, 0, 1)).toBe(true);
    expect(canReorder(wps, 2, 1)).toBe(false);
  });

  it("locks both ends of a round trip", () => {
    const wps = loop();
    expect(canReorder(wps, 0, 1)).toBe(false);
    expect(canReorder(wps, 1, -1)).toBe(false);
    expect(canReorder(wps, 1, 1)).toBe(true);
    expect(canReorder(wps, 2, 1)).toBe(false);
    expect(canReorder(wps, 3, -1)).toBe(false);
  });
});

describe("closeLoop", () => {
  it("appends a copy of the start with the default profile", () => {
    const out = closeLoop(open(), "s2", "schnell");
    expect(out.map((w) => w.id)).toEqual(["s", "a", "b", "s2"]);
    expect(out[3]).toMatchObject({ lng: 8.0, lat: 46.0, name: "Start", legProfile: "schnell" });
    expect(isClosedLoop(out)).toBe(true);
  });

  it("is a no-op when already closed or too short", () => {
    const l = loop();
    expect(closeLoop(l, "x", "schnell")).toBe(l);
    const single = [open()[0]];
    expect(closeLoop(single, "x", "schnell")).toBe(single);
  });
});

describe("reverseWaypoints", () => {
  it("reverses order and flips leg profiles", () => {
    const out = reverseWaypoints(open());
    expect(out.map((w) => w.id)).toEqual(["b", "a", "s"]);
    expect(out[1].legProfile).toBe("kurvig_plus"); // leg B → A was A → B
    expect(out[2].legProfile).toBe("schnell"); // leg A → S was S → A
  });

  it("keeps a round trip closed", () => {
    expect(isClosedLoop(reverseWaypoints(loop()))).toBe(true);
  });
});

describe("pointLabel", () => {
  const at = { lat: 46.6342, lng: 8.5943 };
  it("shortens looked-up names, keeps typed ones, falls back to coordinates", () => {
    expect(pointLabel({ ...at, name: "Andermatt, Uri, Schweiz" })).toBe("Andermatt");
    expect(pointLabel({ ...at, name: "Kaffee, Löwen", nameEdited: true })).toBe("Kaffee, Löwen");
    expect(pointLabel(at)).toBe("46.634, 8.594");
    expect(pointLabel(at, "Punkt 2")).toBe("Punkt 2");
  });
});
