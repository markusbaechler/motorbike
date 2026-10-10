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
