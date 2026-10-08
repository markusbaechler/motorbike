import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchClubTours, parseClubTours } from "./clubtours";
import { encodeRoute } from "./share";
import type { Waypoint } from "../types";

const wps: Waypoint[] = [
  { id: "a", lng: 8.5996, lat: 46.7068, legProfile: "kurvig", name: "Wassen" },
  { id: "b", lng: 8.594, lat: 46.6353, legProfile: "kurvig", name: "Andermatt", dayEnd: true },
  { id: "c", lng: 8.6, lat: 46.53, legProfile: "schnell", name: "Airolo" },
];
const code = encodeRoute(wps, { distanceKm: 123.4, durationMin: 200.6 });

describe("club tours", () => {
  it("keeps the share link decodable when stats are embedded", () => {
    const json = JSON.parse(Buffer.from(code, "base64url").toString("utf8"));
    expect(json.s).toEqual([123, 201]);
    expect(json.w).toHaveLength(3);
  });

  it("parses a tour list and derives days from the route", () => {
    const tours = parseClubTours({
      v: 1,
      tours: [
        {
          slug: "gotthard",
          title: "Gotthard Runde",
          region: "Uri",
          level: "mittel",
          highlights: ["Gotthard", "", 5, "Furka"],
          distanceKm: 123,
          durationMin: 201,
          code,
          next: { date: "2027-07-03", label: "Sa 3. Juli" },
        },
      ],
    });
    expect(tours).toHaveLength(1);
    expect(tours[0]).toMatchObject({
      slug: "gotthard",
      days: 2,
      highlights: ["Gotthard", "Furka"],
      distanceKm: 123,
      next: { date: "2027-07-03", label: "Sa 3. Juli" },
    });
    expect(tours[0].waypoints.map((w) => w.name)).toEqual(["Wassen", "Andermatt", "Airolo"]);
  });

  it("drops entries without a usable route, title or slug and duplicates", () => {
    const tours = parseClubTours([
      { slug: "ok", title: "OK", code },
      { slug: "ok", title: "Doppelt", code },
      { slug: "broken", title: "Kaputt", code: "%%%" },
      { slug: "notitle", code },
      { title: "noslug", code },
      null,
      "text",
    ]);
    expect(tours.map((t) => t.title)).toEqual(["OK"]);
    expect(tours[0].distanceKm).toBeUndefined();
    expect(tours[0].days).toBe(2);
  });

  it("returns nothing for garbage", () => {
    expect(parseClubTours(null)).toEqual([]);
    expect(parseClubTours({ tours: "x" })).toEqual([]);
    expect(parseClubTours(42)).toEqual([]);
  });
});

describe("club tours feed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats a missing feed (404) as an empty list, other failures as errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchClubTours(true)).toEqual([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchClubTours(true)).rejects.toThrow("HTTP 500");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ v: 1, tours: [{ slug: "x", title: "X", code }] }) }));
    expect((await fetchClubTours(true)).map((t) => t.slug)).toEqual(["x"]);
  });
});
