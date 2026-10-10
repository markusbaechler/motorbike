# Wetter entlang der Route – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the forecast at the rider's estimated passing time along the whole route (list + map), with today as the default date and a per-day start time.

**Architecture:** A pure scheduling module (`lib/schedule.ts`) turns route + days + start times into timed stations. `lib/weather.ts` fetches hourly Open-Meteo data for all stations of a day in one request and interpolates to the arrival time. A hook (`lib/useRouteWeather.ts`) ties both to React state in `App.tsx`; `RoutePanel`, `WeatherStrip`, `MapView`, `RouteModal` and the roadbook only render.

**Tech Stack:** React 18, TypeScript, MapLibre GL 4, Vitest 2, Open-Meteo forecast API (no key).

**Spec:** `docs/superpowers/specs/2026-10-10-wetter-entlang-route-design.md`

## Global Constraints

- UI copy in German (Swiss spelling, no «ß»), e.g. «Noch keine Prognose», «Trend, unsicher», «Wetter gerade nicht verfügbar».
- Default date: day without `dayDate` → day 1 = today, day n = previous day's date + 1. A set date wins; following days without a date count on from it.
- Default start: date = today → now rounded up to the next quarter hour; else 09:00.
- Breaks: +15 min after each full 150 km driven (150, 300, …) and +60 min lunch once the clock reaches 12:00; no lunch if the day starts at/after 12:00.
- Stations: day start, every ~30 km, each known pass on the route, each waypoint, day end; samples closer than 8 km to a waypoint/pass are dropped; max 25 stations per day.
- Forecast window: 0–14 days ahead of today; outside → «Noch keine Prognose», no numbers. Day ≥ 2 days ahead (3rd day from today on) → «Trend, unsicher».
- One Open-Meteo request per day (all missing stations), `timezone=Europe/Zurich`, station elevation passed; cache per (lat/lng rounded to 0.01°, date) for 30 min.
- Weather fetch starts after the route has been stable 1 s; abort on change. Do not route weather requests through `lib/queue.ts` (BRouter only).
- Weather failure must never break planning.
- `Waypoint.dayStart?: "HH:MM"` lives on the day's end waypoint (like `dayDate`); persisted via `sanitizeWaypoint`; share links gain an optional column, old links stay valid.
- No new npm dependencies.

## Review Focus

1. Route without elevation in coordinates (2-element coords) → stations get no `ele`, request omits elevation for them (Open-Meteo then uses its DEM); nothing crashes. Test in Task 3.
2. Open-Meteo returns a single object (not an array) when only one location is requested → still parsed. Test in Task 4.
3. Day so long that arrivals pass midnight (start 20:00, 400 km) → arrival hour clamped to 23 for lookup, no index-out-of-range. Test in Task 4.
4. Open-Meteo `null` entries in hourly arrays (e.g. precipitation_probability for far days) → treated as missing, shown as «–», not 0 or NaN. Test in Task 4.
5. Share link with `dayStart` but no `nameEdited` → column 7 is written as 0 so column 8 lands in the right place; old 7-/8-column links decode with `dayStart` undefined. Test in Task 1.

---

### Task 1: `dayStart` field – type, validation, share link

**Files:**
- Modify: `src/types.ts` (Waypoint, after `dayDate`)
- Modify: `src/lib/validate.ts` (sanitizeWaypoint)
- Modify: `src/lib/share.ts` (encodeRoute / decodeRoute)
- Modify: `src/App.tsx:326` (setDayMeta patch type)
- Test: `src/lib/validate.test.ts`, `src/lib/share.test.ts`

**Interfaces:**
- Produces: `Waypoint.dayStart?: string` ("HH:MM", 00:00–23:59); `isHhMm(v: unknown): v is string` exported from `validate.ts`; `setDayMeta(id, { dayName?, dayDate?, dayStart? })` in App (pass `dayStart: undefined` to reset).

- [ ] **Step 1: Write failing tests**

Append to `src/lib/validate.test.ts`:
```ts
import { isHhMm } from "./validate";

describe("dayStart", () => {
  it("accepts HH:MM and rejects junk", () => {
    expect(isHhMm("09:00")).toBe(true);
    expect(isHhMm("23:59")).toBe(true);
    expect(isHhMm("24:00")).toBe(false);
    expect(isHhMm("9:00")).toBe(false);
    expect(isHhMm(900)).toBe(false);
  });
  it("keeps a valid dayStart and drops an invalid one", () => {
    expect(sanitizeWaypoint({ lng: 8, lat: 46, dayStart: "08:30" })?.dayStart).toBe("08:30");
    expect(sanitizeWaypoint({ lng: 8, lat: 46, dayStart: "8h" })?.dayStart).toBeUndefined();
  });
});
```
(If `sanitizeWaypoint` / `describe` / `expect` are not yet imported in that file, add them to the existing import lines.)

Append to `src/lib/share.test.ts`:
```ts
describe("share dayStart", () => {
  it("roundtrips dayStart without nameEdited", () => {
    const w: Waypoint[] = [
      { id: "a", lng: 8.5, lat: 46.5, legProfile: "kurvig" },
      { id: "b", lng: 9.1, lat: 46.9, legProfile: "kurvig", dayStart: "08:15" },
    ];
    const out = decodeRoute(encodeRoute(w))!;
    expect(out[1].dayStart).toBe("08:15");
    expect(out[1].nameEdited).toBeFalsy();
    expect(out[0].dayStart).toBeUndefined();
  });
  it("old links without the column decode with dayStart undefined", () => {
    const out = decodeRoute(encodeRoute(wps))!;
    expect(out.every((p) => p.dayStart === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests – expect FAIL**

Run: `npx vitest run src/lib/validate.test.ts src/lib/share.test.ts`
Expected: FAIL (`isHhMm` not exported, `dayStart` undefined).

- [ ] **Step 3: Implement**

`src/types.ts`, below `dayDate?: string;`:
```ts
  // Start time of the day that ENDS at this waypoint ("HH:MM"). Unset = default
  // (today: now, else 09:00 – see lib/schedule.ts).
  dayStart?: string;
```

`src/lib/validate.ts`, below `isIsoDate`:
```ts
export const isHhMm = (v: unknown): v is string =>
  typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
```
and in the returned object of `sanitizeWaypoint`, after `dayDate`:
```ts
    dayStart: isHhMm(o.dayStart) ? o.dayStart : undefined,
```

`src/lib/share.ts` encode – replace `if (p.nameEdited && p.name) row.push(1);` with:
```ts
    const edited = p.nameEdited && p.name ? 1 : 0;
    if (edited || p.dayStart) row.push(edited);
    if (p.dayStart) row.push(p.dayStart);
```
decode – add after `nameEdited: r[7] === 1,`:
```ts
            dayStart: typeof r[8] === "string" ? r[8] : undefined,
```
(`sanitizeWaypoints` validates the format.)

`src/App.tsx:326` – widen the patch type:
```ts
  const setDayMeta = (id: string, patch: { dayName?: string; dayDate?: string; dayStart?: string }) =>
```

- [ ] **Step 4: Run tests – expect PASS**

Run: `npx vitest run src/lib/validate.test.ts src/lib/share.test.ts` → PASS. Then `npm run lint` → no errors.

- [ ] **Step 5: Commit**
```bash
git add src/types.ts src/lib/validate.ts src/lib/share.ts src/App.tsx src/lib/validate.test.ts src/lib/share.test.ts
git commit -m "Startzeit pro Tag (dayStart) speichern und teilen"
```

---

### Task 2: Schedule – default date, default start, arrival time

**Files:**
- Create: `src/lib/schedule.ts`
- Test: `src/lib/schedule.test.ts`

**Interfaces:**
- Consumes: `DaySpan`, `computeDays` from `lib/days.ts`; `Waypoint` from `types.ts`.
- Produces:
  - `isoDate(d: Date): string` – local date `yyyy-mm-dd`.
  - `addDays(iso: string, n: number): string`
  - `daysBetween(fromIso: string, toIso: string): number`
  - `dayDates(waypoints: Waypoint[], days: DaySpan[], today: string): { date: string; isDefault: boolean }[]`
  - `defaultStartMin(date: string, now: Date): number` – minutes after local midnight.
  - `parseHhMm(s: string): number`, `fmtHhMm(min: number): string`
  - `arrivalMin(startMin: number, driveMin: number, km: number): number`
  - constants `BREAK_EVERY_KM = 150`, `BREAK_MIN = 15`, `LUNCH_AT_MIN = 720`, `LUNCH_MIN = 60`, `DEFAULT_START_MIN = 540`.

- [ ] **Step 1: Write failing tests** – `src/lib/schedule.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  addDays, arrivalMin, dayDates, daysBetween, defaultStartMin, fmtHhMm, isoDate, parseHhMm,
} from "./schedule";
import { computeDays } from "./days";
import type { Waypoint } from "../types";

const wp = (id: string, extra: Partial<Waypoint> = {}): Waypoint => ({
  id, lng: 8, lat: 46, legProfile: "kurvig", ...extra,
});

describe("dates", () => {
  it("isoDate / addDays / daysBetween", () => {
    expect(isoDate(new Date(2026, 9, 10, 23, 30))).toBe("2026-10-10");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-10", "2026-10-13")).toBe(3);
    expect(daysBetween("2026-10-10", "2026-10-09")).toBe(-1);
  });
  it("days without date default to today, today+1 …", () => {
    const w = [wp("a"), wp("b", { dayEnd: true }), wp("c", { dayEnd: true }), wp("d")];
    expect(dayDates(w, computeDays(w), "2026-10-10")).toEqual([
      { date: "2026-10-10", isDefault: true },
      { date: "2026-10-11", isDefault: true },
      { date: "2026-10-12", isDefault: true },
    ]);
  });
  it("a set date wins and later days count on from it", () => {
    const w = [wp("a"), wp("b", { dayEnd: true, dayDate: "2026-11-02" }), wp("c", { dayEnd: true }), wp("d")];
    expect(dayDates(w, computeDays(w), "2026-10-10").map((d) => d.date)).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04",
    ]);
  });
});

describe("start time", () => {
  it("today: now rounded up to the quarter hour", () => {
    expect(defaultStartMin("2026-10-10", new Date(2026, 9, 10, 10, 7))).toBe(10 * 60 + 15);
    expect(defaultStartMin("2026-10-10", new Date(2026, 9, 10, 10, 15))).toBe(10 * 60 + 15);
  });
  it("other days: 09:00", () => {
    expect(defaultStartMin("2026-10-11", new Date(2026, 9, 10, 10, 7))).toBe(540);
  });
  it("parse / format", () => {
    expect(parseHhMm("08:30")).toBe(510);
    expect(fmtHhMm(510)).toBe("08:30");
    expect(fmtHhMm(1500)).toBe("01:00"); // after midnight wraps for display
  });
});

describe("arrival with breaks", () => {
  it("no breaks below 150 km and before noon", () => {
    expect(arrivalMin(540, 60, 80)).toBe(600);
  });
  it("15 min per full 150 km", () => {
    expect(arrivalMin(480, 120, 150)).toBe(615);
    expect(arrivalMin(480, 150, 310)).toBe(480 + 150 + 30); // 2 breaks → 11:00, before noon
    expect(arrivalMin(480, 240, 310)).toBe(480 + 240 + 30 + 60); // 2 breaks → 12:30 → lunch
  });
  it("lunch once the clock reaches 12:00", () => {
    expect(arrivalMin(540, 170, 100)).toBe(540 + 170); // 11:50 → no lunch yet
    expect(arrivalMin(540, 180, 100)).toBe(540 + 180 + 60); // 12:00 → lunch
  });
  it("no lunch when starting at/after noon", () => {
    expect(arrivalMin(720, 60, 50)).toBe(780);
    expect(arrivalMin(800, 60, 50)).toBe(860);
  });
});
```

- [ ] **Step 2: Run – expect FAIL**

Run: `npx vitest run src/lib/schedule.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** – `src/lib/schedule.ts`:
```ts
// When is the rider where? Pure timing for the weather along the route:
// default dates/start times, break rules, timed stations. No network access.
import type { DaySpan } from "./days";
import type { Waypoint } from "../types";

export const DEFAULT_START_MIN = 9 * 60;
export const BREAK_EVERY_KM = 150;
export const BREAK_MIN = 15;
export const LUNCH_AT_MIN = 12 * 60;
export const LUNCH_MIN = 60;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as yyyy-mm-dd. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(iso: string, n: number): string {
  const d = new Date(toUtc(iso) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86_400_000);
}

/** Date per day: the day's own dayDate, else the previous day + 1 (day 1: today). */
export function dayDates(
  waypoints: Waypoint[],
  days: DaySpan[],
  today: string,
): { date: string; isDefault: boolean }[] {
  const out: { date: string; isDefault: boolean }[] = [];
  let prev: string | null = null;
  for (const span of days) {
    const own = waypoints[span.endIdx]?.dayDate;
    const date = own ?? (prev ? addDays(prev, 1) : today);
    out.push({ date, isDefault: !own });
    prev = date;
  }
  return out;
}

/** Today: now, rounded up to the next quarter hour. Other days: 09:00. */
export function defaultStartMin(date: string, now: Date): number {
  if (date !== isoDate(now)) return DEFAULT_START_MIN;
  const m = now.getHours() * 60 + now.getMinutes();
  return Math.ceil(m / 15) * 15;
}

export function parseHhMm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function fmtHhMm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * Clock time (minutes after midnight, may exceed 1440) after `driveMin` of
 * riding and `km` of distance since the day's start, including breaks:
 * 15 min per full 150 km, and a 1 h lunch once the clock reaches 12:00
 * (only when the day started before noon).
 */
export function arrivalMin(startMin: number, driveMin: number, km: number): number {
  let t = startMin + driveMin + Math.floor(km / BREAK_EVERY_KM) * BREAK_MIN;
  if (startMin < LUNCH_AT_MIN && t >= LUNCH_AT_MIN) t += LUNCH_MIN;
  return t;
}
```

- [ ] **Step 4: Run – expect PASS**

Run: `npx vitest run src/lib/schedule.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/schedule.ts src/lib/schedule.test.ts
git commit -m "Zeitplan: Standard-Datum, Startzeit und Pausenregeln"
```

---

### Task 3: Schedule – timed stations per day (`planDays`)

**Files:**
- Modify: `src/lib/schedule.ts`
- Test: `src/lib/schedule.test.ts`

**Interfaces:**
- Consumes: Task 2 exports; `haversine`, `Coord` from `lib/geo.ts` (metres); `KnownPass` from `lib/analysis.ts`; `RouteResult` from `types.ts` (features carry `properties.legIndex`, LineString coords `[lng, lat, ele?]`; `legs[i].distanceKm/durationMin`).
- Produces:
```ts
export type StationKind = "start" | "via" | "end" | "pass" | "sample";
export interface Station {
  lat: number; lng: number; ele?: number;
  km: number;            // from the day's start
  arriveMin: number;     // clock minutes, may exceed 1440
  kind: StationKind;
  name?: string;         // waypoint / pass name
  wpId?: string;         // set for start/via/end
}
export interface DayPlan {
  day: number;
  date: string; dateIsDefault: boolean;
  startMin: number; startIsDefault: boolean;
  daysAhead: number;     // date − today
  stations: Station[];   // sorted by km
}
export const SAMPLE_KM = 30, MIN_GAP_KM = 8, MAX_STATIONS = 25;
export function planDays(
  waypoints: Waypoint[], route: RouteResult, passes: KnownPass[] | undefined, now: Date,
): DayPlan[];
```

- [ ] **Step 1: Write failing tests** – append to `src/lib/schedule.test.ts`:
```ts
import { planDays, MAX_STATIONS } from "./schedule";
import type { RouteResult } from "../types";

// Straight line north from (8, 46): 0.009° lat ≈ 1 km. `kmPerLeg` per leg.
function line(kmPerLeg: number[], withEle = true): RouteResult {
  let lat = 46;
  const features: GeoJSON.Feature[] = kmPerLeg.map((km, legIndex) => {
    const coords: number[][] = [];
    for (let k = 0; k <= km; k++) {
      coords.push(withEle ? [8, lat + k * 0.009, 500 + k] : [8, lat + k * 0.009]);
    }
    lat += km * 0.009;
    return { type: "Feature", properties: { legIndex }, geometry: { type: "LineString", coordinates: coords } };
  });
  return {
    geojson: { type: "FeatureCollection", features },
    distanceKm: kmPerLeg.reduce((a, b) => a + b, 0),
    durationMin: kmPerLeg.reduce((a, b) => a + b, 0),
    legs: kmPerLeg.map((km) => ({ profile: "kurvig", distanceKm: km, durationMin: km })), // 60 km/h
  };
}
const NOW = new Date(2026, 9, 10, 7, 0); // today 07:00 → default start 07:00

describe("planDays", () => {
  it("one day: start, samples every ~30 km, end; times from 60 km/h", () => {
    const w = [wp("a", { name: "A" }), wp("b", { name: "B" })];
    const [d] = planDays(w, line([100]), undefined, NOW);
    expect(d.date).toBe("2026-10-10");
    expect(d.startMin).toBe(420);
    expect(d.startIsDefault).toBe(true);
    expect(d.stations.map((s) => s.kind)).toEqual(["start", "sample", "sample", "sample", "end"]);
    expect(d.stations[0].arriveMin).toBe(420);
    expect(d.stations[1].km).toBeCloseTo(30, 0);
    expect(d.stations[1].arriveMin).toBeCloseTo(450, 0);
    expect(d.stations[4].wpId).toBe("b");
    expect(d.stations[4].ele).toBe(600);
  });
  it("uses dayStart when set", () => {
    const w = [wp("a"), wp("b", { dayStart: "10:30" })];
    const [d] = planDays(w, line([40]), undefined, NOW);
    expect(d.startMin).toBe(630);
    expect(d.startIsDefault).toBe(false);
  });
  it("drops samples within 8 km of a waypoint; via and pass are kept", () => {
    const w = [wp("a"), wp("v", { name: "Via" }), wp("b")];
    const pass = { name: "Testpass", lng: 8, lat: 46 + 62 * 0.009 };
    const [d] = planDays(w, line([33, 40]), [pass], NOW);
    const kinds = d.stations.map((s) => `${s.kind}@${Math.round(s.km)}`);
    expect(kinds).toContain("via@33");
    expect(kinds).toContain("pass@62");
    expect(kinds).not.toContain("sample@30"); // 3 km from via
    expect(kinds).not.toContain("sample@60"); // 2 km from pass
    expect(d.stations.find((s) => s.kind === "pass")?.name).toBe("Testpass");
  });
  it("multi-day: each day restarts km and uses its own date", () => {
    const w = [wp("a"), wp("b", { dayEnd: true }), wp("c")];
    const ds = planDays(w, line([50, 50]), undefined, NOW);
    expect(ds.map((d) => d.date)).toEqual(["2026-10-10", "2026-10-11"]);
    expect(ds[1].startMin).toBe(540);
    expect(ds[1].daysAhead).toBe(1);
    expect(ds[1].stations[0].km).toBe(0);
    expect(ds[1].stations[0].wpId).toBe("b");
  });
  it("caps the number of stations", () => {
    const w = [wp("a"), wp("b")];
    const [d] = planDays(w, line([1200]), undefined, NOW);
    expect(d.stations.length).toBeLessThanOrEqual(MAX_STATIONS);
    expect(d.stations.at(-1)?.kind).toBe("end");
  });
  it("works without elevation in the coordinates", () => {
    const [d] = planDays([wp("a"), wp("b")], line([40], false), undefined, NOW);
    expect(d.stations.every((s) => s.ele === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run – expect FAIL**

Run: `npx vitest run src/lib/schedule.test.ts` → FAIL (`planDays` not exported).

- [ ] **Step 3: Implement** – append to `src/lib/schedule.ts` (add the imports to the top of the file):
```ts
import { computeDays } from "./days";
import { haversine, type Coord } from "./geo";
import type { KnownPass } from "./analysis";
import type { RouteResult } from "../types";

export type StationKind = "start" | "via" | "end" | "pass" | "sample";
export interface Station {
  lat: number;
  lng: number;
  ele?: number;
  km: number;
  arriveMin: number;
  kind: StationKind;
  name?: string;
  wpId?: string;
}
export interface DayPlan {
  day: number;
  date: string;
  dateIsDefault: boolean;
  startMin: number;
  startIsDefault: boolean;
  daysAhead: number;
  stations: Station[];
}

export const SAMPLE_KM = 30;
export const MIN_GAP_KM = 8;
export const MAX_STATIONS = 25;
const PASS_RADIUS_M = 300;

// Track point with distance and riding time since the day's start.
interface TrackPt { c: Coord; km: number; driveMin: number }

function dayTrack(route: RouteResult, startIdx: number, endIdx: number): TrackPt[] {
  const pts: TrackPt[] = [];
  let kmBefore = 0;
  let minBefore = 0;
  for (let leg = startIdx; leg < endIdx; leg++) {
    const f = route.geojson.features.find((x) => x.properties?.legIndex === leg);
    const summary = route.legs[leg];
    if (!f || f.geometry.type !== "LineString" || !summary) continue;
    const coords = f.geometry.coordinates as Coord[];
    // Haversine length of the drawn leg, scaled to the router's distance.
    let len = 0;
    for (let i = 1; i < coords.length; i++) len += haversine(coords[i - 1], coords[i]);
    const scale = len > 0 ? summary.distanceKm / (len / 1000) : 0;
    let run = 0;
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) run += haversine(coords[i - 1], coords[i]) / 1000;
      const km = run * scale;
      const frac = summary.distanceKm > 0 ? km / summary.distanceKm : 0;
      pts.push({ c: coords[i], km: kmBefore + km, driveMin: minBefore + frac * summary.durationMin });
    }
    kmBefore += summary.distanceKm;
    minBefore += summary.durationMin;
  }
  return pts;
}

function nearestAt(track: TrackPt[], km: number): TrackPt {
  let best = track[0];
  for (const p of track) if (Math.abs(p.km - km) < Math.abs(best.km - km)) best = p;
  return best;
}

export function planDays(
  waypoints: Waypoint[],
  route: RouteResult,
  passes: KnownPass[] | undefined,
  now: Date,
): DayPlan[] {
  const days = computeDays(waypoints);
  const today = isoDate(now);
  const dates = dayDates(waypoints, days, today);

  return days.map((span, di) => {
    const { date, isDefault } = dates[di];
    const own = waypoints[span.endIdx]?.dayStart;
    const startMin = own ? parseHhMm(own) : defaultStartMin(date, now);
    const track = dayTrack(route, span.startIdx, span.endIdx);
    const plan: DayPlan = {
      day: span.day, date, dateIsDefault: isDefault, startMin, startIsDefault: !own,
      daysAhead: daysBetween(today, date), stations: [],
    };
    if (track.length === 0) return plan;
    const dayKm = track[track.length - 1].km;

    const at = (p: TrackPt, kind: StationKind, extra: Partial<Station> = {}): Station => ({
      lng: p.c[0], lat: p.c[1], ele: p.c.length > 2 ? p.c[2] : undefined,
      km: p.km, arriveMin: arrivalMin(startMin, p.driveMin, p.km), kind, ...extra,
    });

    // Fixed stations: the day's waypoints (legs are contiguous, so waypoint i
    // sits at the end of leg i-1) and known passes on the track.
    const fixed: Station[] = [];
    let kmAcc = 0;
    for (let i = span.startIdx; i <= span.endIdx; i++) {
      if (i > span.startIdx) kmAcc += route.legs[i - 1]?.distanceKm ?? 0;
      const kind: StationKind = i === span.startIdx ? "start" : i === span.endIdx ? "end" : "via";
      const w = waypoints[i];
      fixed.push(at(nearestAt(track, kmAcc), kind, { wpId: w.id, name: w.name }));
    }
    for (const p of passes ?? []) {
      const pc: Coord = [p.lng, p.lat];
      let hit: TrackPt | null = null;
      for (const t of track) {
        if (Math.abs(t.c[1] - p.lat) > 0.01 || Math.abs(t.c[0] - p.lng) > 0.015) continue;
        if (haversine(t.c, pc) <= PASS_RADIUS_M) { hit = t; break; }
      }
      if (hit && !fixed.some((s) => s.kind === "pass" && s.name === p.name)) {
        fixed.push(at(hit, "pass", { name: p.name }));
      }
    }

    // Samples: every SAMPLE_KM, widened when the day would exceed MAX_STATIONS.
    const room = Math.max(1, MAX_STATIONS - fixed.length);
    const step = Math.max(SAMPLE_KM, dayKm / (room + 1));
    const samples: Station[] = [];
    for (let km = step; km < dayKm - MIN_GAP_KM; km += step) {
      if (fixed.some((s) => Math.abs(s.km - km) < MIN_GAP_KM)) continue;
      samples.push(at(nearestAt(track, km), "sample"));
    }

    plan.stations = [...fixed, ...samples].sort((a, b) => a.km - b.km).slice(0, MAX_STATIONS);
    // Never lose the day's end to the cap.
    if (plan.stations.at(-1)?.kind !== "end") plan.stations[plan.stations.length - 1] = fixed.find((s) => s.kind === "end")!;
    return plan;
  });
}
```
Note: `Waypoint` is already imported (type) from Task 2; merge imports so each module is imported once.

- [ ] **Step 4: Run – expect PASS**

Run: `npx vitest run src/lib/schedule.test.ts` → PASS. If the "drops samples" test fails on exact km positions, check `nearestAt`/scaling – do not loosen the test expectations beyond ±1 km rounding.

- [ ] **Step 5: Commit**
```bash
git add src/lib/schedule.ts src/lib/schedule.test.ts
git commit -m "Zeitplan: Wetter-Messorte mit Durchfahrtszeit pro Tag"
```

---

### Task 4: Hourly weather – request, parse, interpolate, cache, summary

**Files:**
- Modify: `src/lib/weather.ts` (keep `codeLabel`, `isFair`; add the new API; old `fetchWeather`/`WeatherDay` are removed in Task 8)
- Test: `src/lib/weather.test.ts` (new)

**Interfaces:**
- Consumes: `Station` from `lib/schedule.ts`.
- Produces:
```ts
export interface HourWx { code: number; temp: number; precipProb: number | null; precip: number; wind: number }
export interface Series { temp: (number|null)[]; prob: (number|null)[]; precip: (number|null)[]; code: (number|null)[]; wind: (number|null)[] } // 24 entries, hour 0–23 local
export function hourlyUrl(pts: { lat: number; lng: number; ele?: number }[], date: string): string
export function parseHourly(json: unknown): Series[] | null
export function valueAt(s: Series, minute: number): HourWx | null
export async function fetchDayWeather(stations: Station[], date: string, signal?: AbortSignal): Promise<(HourWx | null)[]>
export interface DaySummary { tMin: number; tMax: number; maxProb: number | null; maxPrecip: number; worstCode: number }
export function summarize(values: (HourWx | null)[]): DaySummary | null
export const FORECAST_DAYS = 14;
export function clearWeatherCache(): void   // for tests
```

- [ ] **Step 1: Write failing tests** – `src/lib/weather.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { clearWeatherCache, fetchDayWeather, hourlyUrl, parseHourly, summarize, valueAt } from "./weather";
import type { Station } from "./schedule";

const hours = (f: (h: number) => number | null) => Array.from({ length: 24 }, (_, h) => f(h));
const loc = (base: number) => ({
  hourly: {
    time: hours(() => 0).map((_, h) => `2026-10-10T${String(h).padStart(2, "0")}:00`),
    temperature_2m: hours((h) => base + h),
    precipitation_probability: hours((h) => (h < 12 ? 10 : null)),
    precipitation: hours((h) => (h === 14 ? 2.4 : 0)),
    weather_code: hours((h) => (h === 14 ? 61 : 2)),
    wind_speed_10m: hours(() => 12),
  },
});

afterEach(() => { vi.restoreAllMocks(); clearWeatherCache(); });

describe("hourlyUrl", () => {
  it("lists all points, elevation only when every point has one", () => {
    const u = hourlyUrl([{ lat: 46.12346, lng: 8.5, ele: 2165 }, { lat: 46.2, lng: 8.6, ele: 500 }], "2026-10-10");
    expect(u).toContain("latitude=46.1235,46.2000");
    expect(u).toContain("elevation=2165,500");
    expect(u).toContain("start_date=2026-10-10&end_date=2026-10-10");
    expect(u).toContain("timezone=Europe%2FZurich");
    expect(hourlyUrl([{ lat: 46, lng: 8 }, { lat: 46, lng: 8, ele: 1 }], "2026-10-10")).not.toContain("elevation=");
  });
});

describe("parseHourly / valueAt", () => {
  it("parses an array and a single object", () => {
    expect(parseHourly([loc(5), loc(10)])?.length).toBe(2);
    expect(parseHourly(loc(5))?.length).toBe(1);
    expect(parseHourly({ error: true })).toBeNull();
  });
  it("interpolates temperature between hours, takes the hour's rain", () => {
    const [s] = parseHourly([loc(5)])!;
    const v = valueAt(s, 14 * 60 + 30)!;
    expect(v.temp).toBeCloseTo(19.5, 5);
    expect(v.precip).toBe(2.4);
    expect(v.code).toBe(61);
    expect(v.precipProb).toBeNull(); // null in the data → null, not 0
    expect(valueAt(s, 9 * 60)!.precipProb).toBe(10);
  });
  it("clamps arrivals after midnight to the last hour", () => {
    const [s] = parseHourly([loc(5)])!;
    expect(valueAt(s, 25 * 60)!.temp).toBe(28);
  });
});

describe("fetchDayWeather", () => {
  const st = (lat: number, arriveMin: number): Station => ({ lat, lng: 8, km: 0, arriveMin, kind: "sample" });
  it("one request for all stations, cached afterwards", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([loc(5), loc(10)]), { status: 200 }),
    );
    const r = await fetchDayWeather([st(46, 600), st(46.5, 660)], "2026-10-10");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r[0]!.temp).toBe(15);
    expect(r[1]!.temp).toBe(21);
    await fetchDayWeather([st(46, 600)], "2026-10-10");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("throws on HTTP errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(fetchDayWeather([st(46, 600)], "2026-10-10")).rejects.toThrow();
  });
});

describe("summarize", () => {
  it("min/max over the day, ignoring missing values", () => {
    const s = summarize([
      { code: 2, temp: 6, precipProb: 10, precip: 0, wind: 5 },
      null,
      { code: 61, temp: 21, precipProb: 70, precip: 4, wind: 9 },
    ])!;
    expect(s).toEqual({ tMin: 6, tMax: 21, maxProb: 70, maxPrecip: 4, worstCode: 61 });
    expect(summarize([null])).toBeNull();
  });
});
```

- [ ] **Step 2: Run – expect FAIL**

Run: `npx vitest run src/lib/weather.test.ts` → FAIL.

- [ ] **Step 3: Implement** – append to `src/lib/weather.ts`:
```ts
import type { Station } from "./schedule";

export const FORECAST_DAYS = 14;

export interface HourWx {
  code: number;
  temp: number;
  precipProb: number | null;
  precip: number;
  wind: number;
}
type Arr = (number | null)[];
export interface Series { temp: Arr; prob: Arr; precip: Arr; code: Arr; wind: Arr }

export function hourlyUrl(pts: { lat: number; lng: number; ele?: number }[], date: string): string {
  const lat = pts.map((p) => p.lat.toFixed(4)).join(",");
  const lng = pts.map((p) => p.lng.toFixed(4)).join(",");
  const allEle = pts.every((p) => p.ele != null && Number.isFinite(p.ele));
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    (allEle ? `&elevation=${pts.map((p) => Math.round(p.ele!)).join(",")}` : "") +
    `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m` +
    `&timezone=Europe%2FZurich&start_date=${date}&end_date=${date}`
  );
}

export function parseHourly(json: unknown): Series[] | null {
  const list = Array.isArray(json) ? json : [json];
  const out: Series[] = [];
  for (const item of list) {
    const h = (item as { hourly?: Record<string, Arr> } | null)?.hourly;
    if (!h || !Array.isArray(h.temperature_2m)) return null;
    out.push({
      temp: h.temperature_2m,
      prob: h.precipitation_probability ?? [],
      precip: h.precipitation ?? [],
      code: h.weather_code ?? [],
      wind: h.wind_speed_10m ?? [],
    });
  }
  return out;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function valueAt(s: Series, minute: number): HourWx | null {
  const last = s.temp.length - 1;
  if (last < 0) return null;
  const pos = Math.min(Math.max(minute / 60, 0), last);
  const h0 = Math.floor(pos);
  const h1 = Math.min(h0 + 1, last);
  const f = pos - h0;
  const lerp = (a: Arr) => {
    const x = num(a[h0]);
    const y = num(a[h1]);
    return x == null ? y : y == null ? x : x + (y - x) * f;
  };
  const temp = lerp(s.temp);
  const code = num(s.code[h0]);
  if (temp == null || code == null) return null;
  return {
    code,
    temp,
    precipProb: num(s.prob[h0]),
    precip: num(s.precip[h0]) ?? 0,
    wind: lerp(s.wind) ?? 0,
  };
}

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; s: Series }>();
const keyOf = (lat: number, lng: number, date: string) => `${lat.toFixed(2)},${lng.toFixed(2)}:${date}`;
export function clearWeatherCache(): void { cache.clear(); }

/** Hourly forecast for every station of one day (one request for the uncached ones). */
export async function fetchDayWeather(
  stations: Station[],
  date: string,
  signal?: AbortSignal,
): Promise<(HourWx | null)[]> {
  const now = Date.now();
  const missing = stations.filter((s) => {
    const c = cache.get(keyOf(s.lat, s.lng, date));
    return !c || now - c.at > CACHE_MS;
  });
  if (missing.length > 0) {
    const res = await fetch(hourlyUrl(missing, date), { signal });
    if (!res.ok) throw new Error(`Wetter HTTP ${res.status}`);
    const series = parseHourly(await res.json());
    if (!series || series.length !== missing.length) throw new Error("Wetter: unerwartete Antwort");
    missing.forEach((s, i) => cache.set(keyOf(s.lat, s.lng, date), { at: now, s: series[i] }));
  }
  return stations.map((s) => {
    const c = cache.get(keyOf(s.lat, s.lng, date));
    return c ? valueAt(c.s, s.arriveMin) : null;
  });
}

export interface DaySummary { tMin: number; tMax: number; maxProb: number | null; maxPrecip: number; worstCode: number }

export function summarize(values: (HourWx | null)[]): DaySummary | null {
  const v = values.filter((x): x is HourWx => x != null);
  if (v.length === 0) return null;
  const probs = v.map((x) => x.precipProb).filter((p): p is number => p != null);
  return {
    tMin: Math.round(Math.min(...v.map((x) => x.temp))),
    tMax: Math.round(Math.max(...v.map((x) => x.temp))),
    maxProb: probs.length ? Math.max(...probs) : null,
    maxPrecip: Math.max(...v.map((x) => x.precip)),
    worstCode: Math.max(...v.map((x) => x.code)),
  };
}
```
(Move the new `import type` line to the top of the file.)

- [ ] **Step 4: Run – expect PASS**

Run: `npx vitest run src/lib/weather.test.ts` → PASS. Also check the real API once by hand:
`curl -s "https://api.open-meteo.com/v1/forecast?latitude=46.5614,46.7&longitude=8.3393,8.0&elevation=2165,600&hourly=temperature_2m&timezone=Europe%2FZurich&start_date=<today>&end_date=<today>" | head -c 300` → a JSON **array** with two objects with `hourly.temperature_2m` of 24 values. If the format differs, adapt `parseHourly` and its test.

- [ ] **Step 5: Commit**
```bash
git add src/lib/weather.ts src/lib/weather.test.ts
git commit -m "Wetter: stündliche Prognose für alle Messorte eines Tages"
```

---

### Task 5: Hook `useRouteWeather` and wiring in `App.tsx`

**Files:**
- Create: `src/lib/useRouteWeather.ts`
- Modify: `src/App.tsx` (replace the old weather effect at lines ~207–235; pass the result to `RoutePanel`, `MapView`, `RouteModal`)

**Interfaces:**
- Consumes: `planDays`, `DayPlan`, `Station` (Task 3); `fetchDayWeather`, `HourWx`, `FORECAST_DAYS` (Task 4); `ensureEuroPasses` from `lib/passplanner.ts`.
- Produces:
```ts
export type DayWxState =
  | { status: "none" }                    // outside the forecast window
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; values: (HourWx | null)[] }; // parallel to plan.stations
export interface RouteWeather {
  plans: DayPlan[];
  wx: DayWxState[];                        // parallel to plans
}
export function useRouteWeather(waypoints: Waypoint[], route: RouteResult | null): RouteWeather;
export function stationWx(rw: RouteWeather): Map<string, { st: Station; wx: HourWx | null; plan: DayPlan }>; // keyed by wpId (last day wins for shared overnight points → use the day where it is NOT the start)
```

- [ ] **Step 1: Implement the hook** – `src/lib/useRouteWeather.ts`:
```ts
import { useEffect, useMemo, useState } from "react";
import type { RouteResult, Waypoint } from "../types";
import type { KnownPass } from "./analysis";
import { ensureEuroPasses } from "./passplanner";
import { planDays, type DayPlan, type Station } from "./schedule";
import { fetchDayWeather, FORECAST_DAYS, type HourWx } from "./weather";

export type DayWxState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; values: (HourWx | null)[] };

export interface RouteWeather {
  plans: DayPlan[];
  wx: DayWxState[];
}

const STABLE_MS = 1000;
const TICK_MS = 5 * 60_000; // "jetzt" as default start moves with the clock

export function useRouteWeather(waypoints: Waypoint[], route: RouteResult | null): RouteWeather {
  const [passes, setPasses] = useState<KnownPass[] | undefined>();
  useEffect(() => {
    let alive = true;
    ensureEuroPasses().then((l) => alive && setPasses(l)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const plans = useMemo(
    () => (route && waypoints.length >= 2 ? planDays(waypoints, route, passes, now) : []),
    [waypoints, route, passes, now],
  );

  const [wx, setWx] = useState<DayWxState[]>([]);
  useEffect(() => {
    const inWindow = (p: DayPlan) => p.daysAhead >= 0 && p.daysAhead <= FORECAST_DAYS && p.stations.length > 0;
    setWx(plans.map((p) => (inWindow(p) ? { status: "loading" } : { status: "none" })));
    if (plans.length === 0) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i];
        if (!inWindow(p)) continue;
        try {
          const values = await fetchDayWeather(p.stations, p.date, ctrl.signal);
          setWx((prev) => prev.map((s, j) => (j === i ? { status: "ok", values } : s)));
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          setWx((prev) => prev.map((s, j) => (j === i ? { status: "error" } : s)));
        }
      }
    }, STABLE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [plans]);

  return { plans, wx };
}

/** Weather at each waypoint (by id). A shared overnight point belongs to the day it ends. */
export function stationWx(rw: RouteWeather): Map<string, { st: Station; wx: HourWx | null; plan: DayPlan }> {
  const out = new Map<string, { st: Station; wx: HourWx | null; plan: DayPlan }>();
  rw.plans.forEach((plan, i) => {
    const state = rw.wx[i];
    plan.stations.forEach((st, k) => {
      if (!st.wpId) return;
      if (st.kind === "start" && out.has(st.wpId)) return;
      out.set(st.wpId, { st, wx: state?.status === "ok" ? state.values[k] : null, plan });
    });
  });
  return out;
}
```

- [ ] **Step 2: Wire into App** – in `src/App.tsx`:
  - Delete the block from `// Weather per day (overnight location + date) via Open-Meteo.` through the closing `}, [waypoints]);` of its effect, and the `fetchWeather, type WeatherDay` import.
  - Add `import { useRouteWeather } from "./lib/useRouteWeather";` and, after `route` state exists (below the routing effect is fine, hooks just must not be conditional):
    ```ts
    // Weather at the estimated passing time along the route (lib/schedule.ts).
    const routeWx = useRouteWeather(waypoints, route);
    ```
  - Replace `weather={weather}` on `<RoutePanel>` and `<RouteModal>` with `routeWx={routeWx}`.
  - On `<MapView>` add `routeWx={passSession || sidePlanner ? null : routeWx}`.

- [ ] **Step 3: Temporary prop types so it compiles**

- `RoutePanel.tsx`, `RouteModal.tsx`: replace the prop `weather: Record<string, WeatherDay | null>;` with `routeWx: RouteWeather;` (`import type { RouteWeather } from "../lib/useRouteWeather";`), and rename the destructured `weather` to `routeWx`.
- `MapView.tsx`: add `routeWx?: RouteWeather | null;` to `Props` (used in Task 7).
- `RoutePanel.tsx`: in `renderWaypoint` delete the `const wx = …` line and the `{wx && (…)}` block; delete the `weather[…] === null` paragraph (Task 6 adds the new display).
- `roadbook.ts`: change the parameter `weather: Record<string, WeatherDay | null>` to `routeWx: RouteWeather` (unused until Task 8), delete the `const wx = …` line and the `${wx ? … : ""}` part of the meta line, remove the `WeatherDay` import.
- `RouteModal.tsx:290`: `openRoadbook("Tour", waypoints, route, routeWx, knownPasses)`.

- [ ] **Step 4: Verify**

Run: `npm run lint` → no errors. `npm test` → all PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/useRouteWeather.ts src/App.tsx src/components/RoutePanel.tsx src/components/RouteModal.tsx src/components/MapView.tsx src/lib/roadbook.ts
git commit -m "Wetter entlang der Route: Daten in App verdrahten"
```

---

### Task 6: Routen-Panel – Startzeit, Wetterband, Wetter bei den Punkten

**Files:**
- Create: `src/components/WeatherStrip.tsx`
- Modify: `src/components/RoutePanel.tsx` (day-meta block ~line 610–640; `renderWaypoint` ~line 344–415; move `weatherIcon` out)
- Modify: `src/styles.css` (append)

**Interfaces:**
- Consumes: `RouteWeather`, `DayWxState`, `stationWx` (Task 5); `DayPlan`, `fmtHhMm` (Tasks 2/3); `summarize`, `codeLabel`, `isFair` (Task 4); `Icon`, `IconName` from `components/Icon`.
- Produces: `weatherIcon(code: number): IconName` exported from `WeatherStrip.tsx`; `<WeatherStrip plan={DayPlan} state={DayWxState} />`.

- [ ] **Step 1: Create `src/components/WeatherStrip.tsx`**
```tsx
import Icon, { type IconName } from "./Icon";
import type { DayPlan } from "../lib/schedule";
import { fmtHhMm } from "../lib/schedule";
import type { DayWxState } from "../lib/useRouteWeather";
import { codeLabel, isFair, summarize } from "../lib/weather";

export function weatherIcon(code: number): IconName {
  if (code === 0) return "sun";
  if (code <= 2) return "cloudSun";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "rain";
}

export const pct = (p: number | null) => (p == null ? "–" : `${p} %`);

export default function WeatherStrip({ plan, state }: { plan: DayPlan; state: DayWxState | undefined }) {
  if (!state || plan.stations.length === 0) return null;
  if (state.status === "none") return <p className="day-weather muted">Wetter: Noch keine Prognose.</p>;
  if (state.status === "loading") return <p className="day-weather muted">Wetter wird geladen …</p>;
  if (state.status === "error") return <p className="day-weather muted">Wetter gerade nicht verfügbar.</p>;

  const sum = summarize(state.values);
  return (
    <div className="wx-day">
      {sum && (
        <p className={`wx-summary ${isFair(sum.worstCode) ? "fair" : "wet"}`}>
          <Icon name={weatherIcon(sum.worstCode)} size={15} /> Unterwegs {sum.tMin}–{sum.tMax}° · max.{" "}
          {pct(sum.maxProb)} Regen{sum.maxPrecip > 0 ? ` · bis ${sum.maxPrecip.toFixed(1)} mm` : ""}
          {plan.daysAhead >= 2 && <span className="wx-trend"> · Trend, unsicher</span>}
        </p>
      )}
      <ol className="wx-strip" aria-label="Wetter entlang der Route">
        {plan.stations.map((st, k) => {
          const v = state.values[k];
          return (
            <li key={k} className={`wx-stop ${st.kind}`} title={v ? `${codeLabel(v.code)} · Wind ${Math.round(v.wind)} km/h` : ""}>
              <span className="wx-time">{fmtHhMm(st.arriveMin)}</span>
              {v ? (
                <>
                  <Icon name={weatherIcon(v.code)} size={16} />
                  <span className="wx-temp">{Math.round(v.temp)}°</span>
                  <span className="wx-prob">{pct(v.precipProb)}</span>
                  {v.precip > 0 && <span className="wx-mm">{v.precip.toFixed(1)} mm</span>}
                </>
              ) : (
                <span className="wx-temp">–</span>
              )}
              {st.kind === "pass" && <span className="wx-name">{st.name}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```
Check the real `Icon` export shape (`grep -n "export" src/components/Icon.tsx`) and adapt the import (default vs named) to match how `RoutePanel.tsx` imports it.

- [ ] **Step 2: Start time + strip in the day block** – in `RoutePanel.tsx`:
  - Remove the local `weatherIcon` function; `import WeatherStrip, { weatherIcon, pct } from "./WeatherStrip";` and `import { stationWx } from "../lib/useRouteWeather"; import { fmtHhMm } from "../lib/schedule";`.
  - Near the top of the component body: `const wxByWp = useMemo(() => stationWx(routeWx), [routeWx]);` (import `useMemo` if missing).
  - In `days.map(...)`, after `const open = …`: `const plan = routeWx.plans[span.day - 1]; const dayWx = routeWx.wx[span.day - 1];`
  - Inside `<div className="day-meta">`, after the date input, add:
    ```tsx
    {plan && (
      <label className="day-start">
        Start
        <input
          type="time"
          value={fmtHhMm(plan.startMin)}
          onChange={(e) => onSetDayMeta(overnight.id, { dayStart: e.target.value || undefined })}
        />
        {!plan.startIsDefault && (
          <button className="day-start-reset" onClick={() => onSetDayMeta(overnight.id, { dayStart: undefined })}>
            Standard
          </button>
        )}
      </label>
    )}
    {plan?.dateIsDefault && <span className="day-date-auto">{span.day === 1 ? "heute" : formatDate(plan.date)} (automatisch)</span>}
    ```
  - Replace the old `weather[...] === null` paragraph with `{open && plan && <WeatherStrip plan={plan} state={dayWx} />}`.

- [ ] **Step 3: Weather at each waypoint** – in `renderWaypoint`, drop the `dayDate` parameter use for weather and replace the `wx` line and the `{wx && (...)}` block with:
```tsx
    const at = wxByWp.get(wp.id);
    ...
            {at && (
              <span
                className={`wp-weather ${at.wx ? (isFair(at.wx.code) ? "fair" : "wet") : ""}`}
                title={at.wx ? `Wind ${Math.round(at.wx.wind)} km/h` : undefined}
              >
                {at.st.kind === "start" ? "ab" : "an ca."} {fmtHhMm(at.st.arriveMin)}
                {at.wx && (
                  <>
                    {" · "}<Icon name={weatherIcon(at.wx.code)} size={14} /> {Math.round(at.wx.temp)}° · {pct(at.wx.precipProb)}
                  </>
                )}
              </span>
            )}
```
(The day header date tag keeps using `overnight.dayDate`.)

- [ ] **Step 4: CSS** – append to `src/styles.css` (reuse existing colour variables; check `grep -n "wp-weather" src/styles.css` and copy its `fair`/`wet` colours):
```css
.day-start { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.day-start input { font: inherit; }
.day-start-reset { font-size: 12px; background: none; border: 0; text-decoration: underline; cursor: pointer; color: inherit; }
.day-date-auto { font-size: 12px; opacity: 0.7; }
.wx-day { margin: 6px 0 8px; }
.wx-summary { margin: 0 0 6px; font-size: 13px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.wx-trend { opacity: 0.7; }
.wx-strip { list-style: none; margin: 0; padding: 0 0 4px; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: thin; }
.wx-stop { flex: 0 0 auto; display: grid; justify-items: center; gap: 1px; min-width: 52px; padding: 4px 6px; border-radius: 8px; background: rgba(148, 163, 184, 0.12); font-size: 12px; }
.wx-stop.pass { background: rgba(251, 146, 60, 0.18); }
.wx-time { font-variant-numeric: tabular-nums; opacity: 0.8; }
.wx-temp { font-weight: 600; }
.wx-mm, .wx-name { font-size: 11px; opacity: 0.8; max-width: 80px; text-align: center; }
```

- [ ] **Step 5: Verify**

Run: `npm run lint` and `npm test` → no errors / all PASS.
Browser: `preview_start` the planner dev server (create `.claude/launch.json` in the planner repo with `npm run dev`, port from `vite.config.ts`, if missing). Plan Bern → Grimselpass → Andermatt; check: day shows «Start hh:mm» (today: now rounded), summary line, strip with times and a «Grimselpass» stop, waypoint lines «an ca. …». Change start to 08:00 → times shift. Mobile width 375 px: strip scrolls horizontally, no page overflow.

- [ ] **Step 6: Commit**
```bash
git add src/components/WeatherStrip.tsx src/components/RoutePanel.tsx src/styles.css
git commit -m "Routen-Panel: Startzeit pro Tag und Wetterband mit Durchfahrtszeiten"
```

---

### Task 7: Karte – Wetterkreise und Schalter

**Files:**
- Modify: `src/components/MapView.tsx` (props, new effect after the pass-endpoint effect ~line 488, toggle button in the returned JSX ~line 528)
- Modify: `src/styles.css` (append)

**Interfaces:**
- Consumes: `RouteWeather` (Task 5), `fmtHhMm` (Task 2), `codeLabel` (Task 4), `pct` (Task 6, from `./WeatherStrip`).
- Produces: localStorage key `"mb.wxLayer"` (`"0"` = off; anything else/missing = on).

- [ ] **Step 1: Toggle state** – in `MapView` body:
```ts
  const [wxOn, setWxOn] = useState(() => {
    try { return localStorage.getItem("mb.wxLayer") !== "0"; } catch { return true; }
  });
  const toggleWx = () =>
    setWxOn((on) => {
      try { localStorage.setItem("mb.wxLayer", on ? "0" : "1"); } catch { /* private mode */ }
      return !on;
    });
  const wxMarkersRef = useRef<maplibregl.Marker[]>([]);
```
Destructure `routeWx = null` from props.

- [ ] **Step 2: Marker effect** (after the pass-endpoint effect):
```ts
  // --- Weather along the route (DOM markers like the pass dots) ---
  useEffect(() => {
    const map = mapRef.current;
    wxMarkersRef.current.forEach((m) => m.remove());
    wxMarkersRef.current = [];
    if (!map || !routeWx || !wxOn) return;
    const emoji = (c: number) =>
      c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c === 45 || c === 48 ? "🌫️" :
      (c >= 71 && c <= 77) || c === 85 || c === 86 ? "❄️" : c >= 95 ? "⛈️" : "🌧️";
    routeWx.plans.forEach((plan, i) => {
      const state = routeWx.wx[i];
      if (state?.status !== "ok") return;
      plan.stations.forEach((st, k) => {
        const v = state.values[k];
        if (!v) return;
        const el = document.createElement("div");
        el.className = `wx-marker ${st.kind}`;
        el.textContent = `${emoji(v.code)} ${Math.round(v.temp)}°`;
        const where = st.name ?? (st.kind === "sample" ? `km ${Math.round(st.km)}` : "");
        const text =
          `Tag ${plan.day} · ${fmtHhMm(st.arriveMin)}${where ? " · " + where : ""}\n` +
          `${codeLabel(v.code)} · ${Math.round(v.temp)}° · Regen ${pct(v.precipProb)}` +
          `${v.precip > 0 ? ` · ${v.precip.toFixed(1)} mm` : ""} · Wind ${Math.round(v.wind)} km/h`;
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -10] })
          .setLngLat([st.lng, st.lat])
          .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(text))
          .addTo(map);
        wxMarkersRef.current.push(marker);
      });
    });
  }, [routeWx, wxOn]);
```
Waypoint markers already sit at start/via/end; the `offset` lifts the weather chip above them.

- [ ] **Step 3: Toggle button** – in the JSX right after `<div className="map" ref={containerRef} />`:
```tsx
      {routeWx && routeWx.plans.length > 0 && (
        <button
          className={`map-wx-toggle ${wxOn ? "on" : ""}`}
          onClick={toggleWx}
          aria-pressed={wxOn}
          title={wxOn ? "Wetter auf der Karte ausblenden" : "Wetter auf der Karte einblenden"}
        >
          Wetter
        </button>
      )}
```

- [ ] **Step 4: CSS** – append to `src/styles.css`:
```css
.wx-marker { padding: 2px 6px; border-radius: 10px; background: rgba(255, 255, 255, 0.92); color: #0f172a; font-size: 12px; font-weight: 600; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.35); white-space: nowrap; cursor: pointer; }
.wx-marker.pass { background: #ffedd5; }
.maplibregl-popup-content { white-space: pre-line; }
.map-wx-toggle { position: absolute; top: 10px; right: 10px; z-index: 2; padding: 6px 10px; border-radius: 8px; border: 0; background: rgba(15, 23, 42, 0.75); color: #f8fafc; font-size: 13px; cursor: pointer; }
.map-wx-toggle.on { background: #0ea5e9; }
```
Check that `.map-wrap` is `position: relative` (`grep -n "\.map-wrap" src/styles.css`); if not, add `position: relative;` there. Check the top-right corner is free on mobile and desktop (search box, NavRail); move to `top: 56px` if it collides.

- [ ] **Step 5: Verify**

`npm run lint` → OK. Browser: chips along the route, tap → popup with time/values, «Wetter» toggles them, reload keeps the choice. Pässeplaner mode shows no chips.

- [ ] **Step 6: Commit**
```bash
git add src/components/MapView.tsx src/styles.css
git commit -m "Karte: Wetter entlang der Route mit Schalter"
```

---

### Task 8: Roadbook, Aufräumen, Doku, Gesamttest

**Files:**
- Modify: `src/lib/roadbook.ts` (~lines 80–125)
- Modify: `src/components/RouteModal.tsx:290`
- Modify: `src/lib/weather.ts` (remove `fetchWeather`, `WeatherDay`)
- Modify: `docs/datenschutz-routenplaner.md` (line ~25: weather now sends route sample points)

**Interfaces:**
- Consumes: `RouteWeather`, `stationWx` (Task 5); `summarize`, `codeLabel` (Task 4); `fmtHhMm` (Task 2).

- [ ] **Step 1: Roadbook** – in `openRoadbook(…, routeWx: RouteWeather, knownPasses?)`:
  - In the day section, replace the removed `wx` with:
    ```ts
    const plan = routeWx.plans[span.day - 1];
    const st8 = routeWx.wx[span.day - 1];
    const sum = st8?.status === "ok" ? summarize(st8.values) : null;
    ```
    and the meta line part with
    ```ts
    ${plan ? ` · Start ${fmtHhMm(plan.startMin)}` : ""}
    ${sum ? ` · Wetter unterwegs ${sum.tMin}–${sum.tMax}°, max. ${sum.maxProb ?? "–"}% Regen${sum.maxPrecip > 0 ? `, bis ${sum.maxPrecip.toFixed(1)} mm` : ""}` : ""}
    ```
    and, if the day has no `dayDate`, show `fmtDate(plan.date)` instead of nothing.
  - In the per-waypoint row add a cell with `an ca. ${fmtHhMm(at.st.arriveMin)}` plus `${Math.round(at.wx.temp)}° ${at.wx.precipProb ?? "–"}%` when available, where `const at = stationWx(routeWx).get(wp.id)` (compute the map once before the loop).
  - (`RouteModal.tsx` already passes `routeWx` since Task 5.)

- [ ] **Step 2: Remove the old API** – delete `WeatherDay` and `fetchWeather` from `weather.ts`. Run `grep -rn "WeatherDay\|fetchWeather" src` → no hits.

- [ ] **Step 3: Datenschutz-Doku** – in `docs/datenschutz-routenplaner.md`, change the weather sentence to say that for the weather the planner sends the coordinates of points along the planned route (about every 30 km, passes and waypoints) and the date to Open-Meteo. Keep the rest unchanged.

- [ ] **Step 4: Full verification**

Run: `npm run lint`, `npm test`, `npm run build` → all succeed.
Browser (dev server), with screenshots for the user:
  1. One-day tour today (e.g. Jura tour from the club tours): start = now rounded, strip, map chips.
  2. Three-day tour without dates: dates today/tomorrow/day after (automatisch), day 3 shows «Trend, unsicher».
  3. Day date in 20 days → «Noch keine Prognose», no chips for that day.
  4. Offline / blocked `api.open-meteo.com` (DevTools request blocking or `javascript_tool` to stub `fetch` for that host) → «Wetter gerade nicht verfügbar», routing still works.
  5. Share link with a changed start time opens with the same start time.
  6. Roadbook opens and shows start time + weather line.
  7. Phone width 375 px and desktop.

- [ ] **Step 5: Commit**
```bash
git add src/lib/roadbook.ts src/components/RouteModal.tsx src/lib/weather.ts docs/datenschutz-routenplaner.md
git commit -m "Roadbook mit Wetter unterwegs, alte Tages-Wetterabfrage entfernt"
```
