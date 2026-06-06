import type { LngLat } from "./types";

/** Great-circle distance in metres between two points. */
export function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Shortest distance (metres) from point `p` to the segment a–b, computed in a
 * local equirectangular projection. Good enough for the corridor filter at the
 * scales we deal with (tens to hundreds of km).
 */
export function distanceToSegment(p: LngLat, a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat0 = toRad((a.lat + b.lat) / 2);
  const x = (q: LngLat) => R * toRad(q.lon) * Math.cos(lat0);
  const y = (q: LngLat) => R * toRad(q.lat);
  const ax = x(a),
    ay = y(a),
    bx = x(b),
    by = y(b),
    px = x(p),
    py = y(p);
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Order waypoints into a sensible visiting sequence using a greedy
 * nearest-neighbour walk from `start`. Works for both point-to-point and
 * round trips (where `end` equals `start`).
 */
export function orderByNearestNeighbour<T extends LngLat>(
  start: LngLat,
  points: T[],
): T[] {
  const remaining = [...points];
  const ordered: T[] = [];
  let current: LngLat = start;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = next;
  }
  return ordered;
}

/** Format a distance in metres as a human-friendly km string. */
export function formatKm(metres: number): string {
  return `${(metres / 1000).toFixed(metres < 100000 ? 1 : 0)} km`;
}

/** Format a duration in seconds as `h:mm`. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
