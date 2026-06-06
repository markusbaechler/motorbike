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
 * nearest-neighbour walk from the start. Works for round trips too.
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
