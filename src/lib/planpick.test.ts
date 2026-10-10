import { describe, expect, it } from "vitest";
import { pickAction, type PickForm } from "./planpick";

const form = (startFilled: boolean, ...days: boolean[][]): PickForm => {
  let id = 10;
  return {
    startId: 1,
    startFilled,
    days: days.map((stops, i) => ({ id: 100 + i, stops: stops.map((filled) => ({ id: id++, filled })) })),
  };
};

describe("pickAction", () => {
  it("fills Start first, then the destination", () => {
    expect(pickAction(form(false, [false]), null)).toEqual({ kind: "fill", id: 1 });
    expect(pickAction(form(true, [false]), null)).toEqual({ kind: "fill", id: 10 });
  });

  it("fills the first empty stop across days", () => {
    expect(pickAction(form(true, [true, true], [true, false]), null)).toEqual({ kind: "fill", id: 13 });
  });

  it("adds a Zwischenziel before the final destination when everything is filled", () => {
    expect(pickAction(form(true, [true], [true]), null)).toEqual({ kind: "insertVia", dayIndex: 1 });
  });

  it("prefers the field the rider was just in, even if filled", () => {
    expect(pickAction(form(true, [true]), 1)).toEqual({ kind: "fill", id: 1 });
    expect(pickAction(form(false, [false]), 10)).toEqual({ kind: "fill", id: 10 });
  });

  it("ignores a focused field that no longer exists", () => {
    expect(pickAction(form(false, [false]), 999)).toEqual({ kind: "fill", id: 1 });
  });

  it("follows explicit targets from the context menu", () => {
    const f = form(true, [true], [false, true]);
    expect(pickAction(f, 12, "start")).toEqual({ kind: "fill", id: 1 });
    expect(pickAction(f, null, "end")).toEqual({ kind: "fill", id: 12 });
    expect(pickAction(f, null, "via")).toEqual({ kind: "fill", id: 11 });
    expect(pickAction(form(true, [true]), null, "via")).toEqual({ kind: "insertVia", dayIndex: 0 });
  });
});
