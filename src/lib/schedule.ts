// When is the rider where? Pure timing for the weather along the route:
// default dates/start times, break rules, timed stations. No network access.
import { computeDays, type DaySpan } from "./days";
import { haversine, type Coord } from "./geo";
import type { KnownPass } from "./analysis";
import type { RouteResult, Waypoint } from "../types";

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
    const date: string = own ?? (prev ? addDays(prev, 1) : today);
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

export type StationKind = "start" | "via" | "end" | "pass" | "sample";
export interface Station {
  lat: number;
  lng: number;
  ele?: number;
  km: number; // from the day's start
  arriveMin: number; // clock minutes, may exceed 1440
  kind: StationKind;
  name?: string; // waypoint / pass name
  wpId?: string; // set for start/via/end
}
export interface DayPlan {
  day: number;
  date: string;
  dateIsDefault: boolean;
  startMin: number;
  startIsDefault: boolean;
  daysAhead: number; // date − today
  stations: Station[]; // sorted by km
}

export const SAMPLE_KM = 30;
export const MIN_GAP_KM = 8;
export const MAX_STATIONS = 25;
const PASS_RADIUS_M = 300;

// Track point with distance and riding time since the day's start.
interface TrackPt {
  c: Coord;
  km: number;
  driveMin: number;
}

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

/** Timed weather stations for every day of the route. */
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
    const plan: DayPlan = {
      day: span.day,
      date,
      dateIsDefault: isDefault,
      startMin,
      startIsDefault: !own,
      daysAhead: daysBetween(today, date),
      stations: [],
    };
    const track = dayTrack(route, span.startIdx, span.endIdx);
    if (track.length === 0) return plan;
    const dayKm = track[track.length - 1].km;

    const at = (p: TrackPt, kind: StationKind, extra: Partial<Station> = {}): Station => ({
      lng: p.c[0],
      lat: p.c[1],
      ele: p.c.length > 2 ? p.c[2] : undefined,
      km: p.km,
      arriveMin: arrivalMin(startMin, p.driveMin, p.km),
      kind,
      ...extra,
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
    // Cheap bounding-box prefilter: the pass list has ~1000 entries.
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const t of track) {
      minLat = Math.min(minLat, t.c[1]); maxLat = Math.max(maxLat, t.c[1]);
      minLng = Math.min(minLng, t.c[0]); maxLng = Math.max(maxLng, t.c[0]);
    }
    const near = (passes ?? []).filter(
      (p) => p.lat >= minLat - 0.01 && p.lat <= maxLat + 0.01 && p.lng >= minLng - 0.015 && p.lng <= maxLng + 0.015,
    );
    for (const p of near) {
      const pc: Coord = [p.lng, p.lat];
      let hit: TrackPt | null = null;
      for (const t of track) {
        if (Math.abs(t.c[1] - p.lat) > 0.01 || Math.abs(t.c[0] - p.lng) > 0.015) continue;
        if (haversine(t.c, pc) <= PASS_RADIUS_M) {
          hit = t;
          break;
        }
      }
      if (hit && !fixed.some((s) => s.kind === "pass" && s.name === p.name)) {
        fixed.push(at(hit, "pass", { name: p.name }));
      }
    }

    // Samples every SAMPLE_KM, spread wider when the day would exceed MAX_STATIONS.
    const room = Math.max(1, MAX_STATIONS - fixed.length);
    const step = Math.max(SAMPLE_KM, dayKm / (room + 1));
    const samples: Station[] = [];
    for (let km = step; km < dayKm - MIN_GAP_KM; km += step) {
      if (fixed.some((s) => Math.abs(s.km - km) < MIN_GAP_KM)) continue;
      samples.push(at(nearestAt(track, km), "sample"));
    }

    // The cap only ever drops samples: waypoints and passes always keep their time.
    const keep = samples.slice(0, Math.max(0, MAX_STATIONS - fixed.length));
    plan.stations = [...fixed, ...keep].sort((a, b) => a.km - b.km);
    return plan;
  });
}
