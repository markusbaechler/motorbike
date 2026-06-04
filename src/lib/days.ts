import type { RouteResult, Waypoint } from "../types";

export interface DaySpan {
  day: number;
  // Waypoint indices: the day runs from startIdx to endIdx (inclusive).
  // The overnight stop is waypoints[endIdx]. Consecutive days share that
  // waypoint (it ends one day and starts the next).
  startIdx: number;
  endIdx: number;
}

/**
 * Split the waypoint sequence into days at every waypoint flagged `dayEnd`.
 * The final waypoint always closes the last day.
 */
export function computeDays(waypoints: Waypoint[]): DaySpan[] {
  const days: DaySpan[] = [];
  if (waypoints.length < 2) return days;

  let start = 0;
  let day = 1;
  for (let i = 1; i < waypoints.length; i++) {
    const isLast = i === waypoints.length - 1;
    if (waypoints[i].dayEnd || isLast) {
      days.push({ day: day++, startIdx: start, endIdx: i });
      start = i;
    }
  }
  return days;
}

export interface DayStats {
  distanceKm: number;
  durationMin: number;
}

/** Sum the legs that belong to a day (legs startIdx … endIdx-1). */
export function dayStats(span: DaySpan, route: RouteResult | null): DayStats {
  if (!route) return { distanceKm: 0, durationMin: 0 };
  let distanceKm = 0;
  let durationMin = 0;
  for (let j = span.startIdx; j < span.endIdx; j++) {
    const leg = route.legs[j];
    if (leg) {
      distanceKm += leg.distanceKm;
      durationMin += leg.durationMin;
    }
  }
  return { distanceKm, durationMin };
}
