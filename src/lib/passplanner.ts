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

/**
 * Note: auto-adding "through-passes on the way" used to be done geometrically
 * (project candidate passes onto the straight leg between two anchors). That
 * was unreliable — between e.g. Susten and Gotthard the straight line runs east
 * past Oberalp, so it picked the wrong passes. It has been replaced by the
 * router-scored optimiser in passopt.ts (optimizeLoop), which judges every
 * candidate with the real router (BRouter).
 */

// Largest pick count for which we brute-force the optimal visiting order. 7
// passes → 5040 permutations, trivial; beyond that we fall back to the angular
// sweep. Riders practically never mark more than a handful.
const BRUTE_MAX = 7;

/** Total straight-line length of the closed tour start → seq… → start. */
function loopLength(
  start: { lat: number; lng: number },
  seq: { lat: number; lng: number }[],
): number {
  const s: Coord = [start.lng, start.lat];
  let len = haversine(s, [seq[0].lng, seq[0].lat]);
  for (let i = 1; i < seq.length; i++) {
    len += haversine([seq[i - 1].lng, seq[i - 1].lat], [seq[i].lng, seq[i].lat]);
  }
  return len + haversine([seq[seq.length - 1].lng, seq[seq.length - 1].lat], s);
}

/** Visit every permutation of `items` exactly once (Heap's algorithm). */
function forEachPermutation<T>(items: T[], visit: (perm: T[]) => void): void {
  const a = [...items];
  const c = new Array(a.length).fill(0);
  visit([...a]);
  let i = 0;
  while (i < a.length) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [a[i], a[j]] = [a[j], a[i]];
      visit([...a]);
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

/**
 * Order picks into a clean, crossing-free round-trip sequence.
 *
 * For a handful of passes we brute-force the shortest closed tour
 * (start → … → start). The optimal tour is provably free of self-crossings AND
 * naturally enters/exits at the passes nearest the start — which is exactly what
 * the old angular sweep got wrong: starting e.g. Susten/Grimsel/Furka from
 * Wassen it cut the loop at Grimsel (the farthest pass), forcing the route to
 * drive out past Furka to reach Grimsel and straight back again. Beyond
 * BRUTE_MAX picks we fall back to an angular sweep around the centroid.
 */
export function orderForLoop<T extends { lat: number; lng: number }>(
  start: { lat: number; lng: number },
  picks: T[],
): T[] {
  if (picks.length <= 2) return orderByNearestNeighbour(start, picks);

  if (picks.length <= BRUTE_MAX) {
    let best = picks;
    let bestLen = Infinity;
    forEachPermutation(picks, (perm) => {
      const len = loopLength(start, perm);
      if (len < bestLen) {
        bestLen = len;
        best = perm;
      }
    });
    return best;
  }

  // Fallback for many picks: angular sweep around the centroid, started near the
  // start's bearing into the cluster.
  const cLat = picks.reduce((s, p) => s + p.lat, 0) / picks.length;
  const cLng = picks.reduce((s, p) => s + p.lng, 0) / picks.length;
  const ang = (p: { lat: number; lng: number }) =>
    Math.atan2(p.lat - cLat, p.lng - cLng);
  const sorted = [...picks].sort((a, b) => ang(a) - ang(b));
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
