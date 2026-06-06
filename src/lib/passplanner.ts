// Pässeplaner: a standalone feature that lets the rider pick mountain passes
// in a corridor between start and destination (or around the start for a round
// trip), mark them as need-to / nice-to, and turn them into a normal route.
//
// Uses its own rich data file (public/passes-europe.json) which – unlike the
// curated DEFAULT_PASSES that feed Tour-Genius – carries surface info so the
// asphalt/unpaved filter works.

import { haversine, type Coord } from "./geo";

export interface EuroPass {
  name: string;
  lat: number;
  lng: number;
  surface: "asphalt" | "unpaved";
  height: number;
  // "pass" = through pass (road continues), "road" = spur / dead-end scenic
  // road. Only through passes are auto-inserted so routes don't detour into
  // dead-end valleys.
  kind: "pass" | "road";
}

export type PassMark = "need" | "nice";
export type SurfaceFilter = "asphalt" | "all";

/** A pass enriched with a stable key (coords are unique). */
export interface KeyedPass extends EuroPass {
  key: string;
}

export const passKey = (p: EuroPass): string => `${p.lat},${p.lng}`;

const DATA_URL = "./passes-europe.json";
let cache: KeyedPass[] | null = null;
let inflight: Promise<KeyedPass[]> | null = null;

export async function ensureEuroPasses(): Promise<KeyedPass[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Pässe-Daten konnten nicht geladen werden (HTTP ${res.status}).`);
      const data = (await res.json()) as EuroPass[];
      cache = data.map((p) => ({ ...p, key: passKey(p) }));
      return cache;
    })().catch((e) => {
      inflight = null;
      throw e;
    });
  }
  return inflight;
}

/**
 * Shortest distance (metres) from point p to the segment a–b, in a local
 * equirectangular projection (accurate enough at these scales).
 */
function distanceToSegmentM(p: Coord, a: Coord, b: Coord): number {
  const Re = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const lat0 = rad((a[1] + b[1]) / 2);
  const x = (q: Coord) => Re * rad(q[0]) * Math.cos(lat0);
  const y = (q: Coord) => Re * rad(q[1]);
  const ax = x(a), ay = y(a), bx = x(b), by = y(b), px = x(p), py = y(p);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export interface CorridorParams {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number } | null; // null → round trip
  surface: SurfaceFilter;
  corridorKm: number;
}

/** Passes inside the corridor, matching the surface filter. */
export function passesInCorridor(passes: KeyedPass[], p: CorridorParams): KeyedPass[] {
  const m = p.corridorKm * 1000;
  const start: Coord = [p.start.lng, p.start.lat];
  const end: Coord | null = p.end ? [p.end.lng, p.end.lat] : null;
  return passes.filter((pass) => {
    if (p.surface === "asphalt" && pass.surface !== "asphalt") return false;
    const pt: Coord = [pass.lng, pass.lat];
    const d = end ? distanceToSegmentM(pt, start, end) : haversine(start, pt);
    return d <= m;
  });
}

/**
 * Order picks into a sensible visiting sequence with a greedy
 * nearest-neighbour walk from the start. Good for point-to-point trips.
 */
export function orderByNearestNeighbour<T extends { lat: number; lng: number }>(
  start: { lat: number; lng: number },
  picks: T[],
): T[] {
  const remaining = [...picks];
  const ordered: T[] = [];
  let cur: Coord = [start.lng, start.lat];
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(cur, [remaining[i].lng, remaining[i].lat]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const [next] = remaining.splice(best, 1);
    ordered.push(next);
    cur = [next.lng, next.lat];
  }
  return ordered;
}

/** Position of p relative to segment a→b: t = 0..1 along, perp = metres aside. */
function alongAndPerp(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): { t: number; perp: number } {
  const Re = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const lat0 = r((a.lat + b.lat) / 2);
  const x = (q: { lat: number; lng: number }) => Re * r(q.lng) * Math.cos(lat0);
  const y = (q: { lat: number; lng: number }) => Re * r(q.lat);
  const ax = x(a), ay = y(a), bx = x(b), by = y(b), px = x(p), py = y(p);
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const rx = px - ax, ry = py - ay;
  return { t: (rx * ux + ry * uy) / len, perp: Math.abs(rx * -uy + ry * ux) };
}

/**
 * Through-passes that lie *along* the leg a→b (inside a corridor), so a route
 * naturally rides over passes on the way without the user marking every one.
 * Spur/dead-end roads (kind "road") are never inserted. Ordered along the leg.
 */
export function throughPassesAlong(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  candidates: KeyedPass[],
  opts: { corridorKm?: number; maxPerLeg?: number; minLegKm?: number } = {},
): KeyedPass[] {
  const corridor = (opts.corridorKm ?? 12) * 1000;
  const maxPerLeg = opts.maxPerLeg ?? 6;
  const minLeg = (opts.minLegKm ?? 8) * 1000;
  if (haversine([a.lng, a.lat], [b.lng, b.lat]) < minLeg) return [];
  const picks: { t: number; p: KeyedPass }[] = [];
  for (const p of candidates) {
    if (p.kind !== "pass") continue;
    const { t, perp } = alongAndPerp(p, a, b);
    if (t > 0.05 && t < 0.95 && perp <= corridor) picks.push({ t, p });
  }
  picks.sort((x, y) => x.t - y.t);
  return picks.slice(0, maxPerLeg).map((x) => x.p);
}

/**
 * Order picks around their centroid by angle, so a round trip sweeps around
 * the area in one direction (a clean loop) instead of doubling back. The loop
 * is started at the pick whose angle is closest to the start → passes' general
 * direction, for a natural exit from the start.
 */
export function orderForLoop<T extends { lat: number; lng: number }>(
  start: { lat: number; lng: number },
  picks: T[],
): T[] {
  if (picks.length <= 2) return orderByNearestNeighbour(start, picks);
  const cLat = picks.reduce((s, p) => s + p.lat, 0) / picks.length;
  const cLng = picks.reduce((s, p) => s + p.lng, 0) / picks.length;
  const ang = (p: { lat: number; lng: number }) =>
    Math.atan2(p.lat - cLat, p.lng - cLng);
  const sorted = [...picks].sort((a, b) => ang(a) - ang(b));
  // Rotate so the loop begins near the start's bearing into the cluster.
  const startAng = Math.atan2(cLat - start.lat, cLng - start.lng);
  let bestIdx = 0;
  let bestDiff = Infinity;
  sorted.forEach((p, i) => {
    let d = Math.abs(ang(p) - startAng);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  });
  return [...sorted.slice(bestIdx), ...sorted.slice(0, bestIdx)];
}
