import { destination, type Coord } from "./geo";
import { fetchMultiPoint } from "./routing";
import { analyse, type RouteAnalysis } from "./analysis";
import type { RouteProfile } from "../types";

// The Tour-Genius generates real round trips (start = finish) and ranks them
// by the same motorcycle attractiveness score used everywhere else.
//
// To get a genuine loop (rather than an out-and-back), it places MANY via
// points densely on a circle around the start: the closer the points sit, the
// more the route is forced to hug the ring and come back on different roads.
// Each candidate is then measured for "roundness" (how much area the route
// actually encloses) so we can drop degenerate there-and-back results and
// prefer the cleanest loops.

export type TourDuration = "half" | "full";

export interface TourStop {
  lat: number;
  lng: number;
  name?: string;
}

export interface TourCandidate {
  stops: TourStop[]; // start, vias …, back to start
  distanceKm: number;
  durationMin: number;
  roundness: number; // 0 (line) … 1 (perfect circle)
  analysis: RouteAnalysis;
}

// Rough target ride distance per duration (real road km, curvy roads).
const TARGET_KM: Record<TourDuration, number> = { half: 120, full: 250 };

// Roads are longer than the straight circle through the via-points.
const DETOUR = 1.35;
// Target spacing between adjacent ring points. Small spacing forces the route
// to follow the circle closely → a real loop.
const POINT_SPACING_M = 9000;
// Compass bearings to rotate the loop around the start by (one candidate each).
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function targetKm(duration: TourDuration): number {
  return TARGET_KM[duration];
}

// Isoperimetric quotient of the route polygon: 4π·area / perimeter².
// 1 for a perfect circle, ~0 for an out-and-back line. Uses a local planar
// projection; translation-invariant so absolute lng/lat origin is irrelevant.
function roundnessOf(feature: GeoJSON.Feature, perimM: number): number {
  const g = feature.geometry;
  if (g.type !== "LineString" || g.coordinates.length < 4 || perimM <= 0) return 0;
  const lat0 = (g.coordinates[0][1] * Math.PI) / 180;
  const kx = Math.cos(lat0) * 111320;
  const ky = 110540;
  let twice = 0;
  const c = g.coordinates;
  for (let i = 0; i < c.length - 1; i++) {
    const x1 = c[i][0] * kx;
    const y1 = c[i][1] * ky;
    const x2 = c[i + 1][0] * kx;
    const y2 = c[i + 1][1] * ky;
    twice += x1 * y2 - x2 * y1;
  }
  const area = Math.abs(twice) / 2;
  return clamp((4 * Math.PI * area) / (perimM * perimM), 0, 1);
}

export async function findTours(
  start: { lat: number; lng: number; name?: string },
  duration: TourDuration,
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<TourCandidate[]> {
  const target = TARGET_KM[duration];
  // For a dense ring the polygon perimeter ≈ the circle circumference, so we
  // size the radius from the target straight perimeter directly.
  const straightPerimM = (target / DETOUR) * 1000;
  const radiusM = straightPerimM / (2 * Math.PI);
  // Choose how many points to put on the ring so neighbours are ~9 km apart.
  const ring = clamp(
    Math.round(Math.PI / Math.asin(clamp(POINT_SPACING_M / (2 * radiusM), 0.05, 0.99))),
    6,
    14,
  );

  const origin: Coord = [start.lng, start.lat];

  const tasks = BEARINGS.map(async (deg): Promise<TourCandidate> => {
    const center = destination(origin, deg, radiusM);
    // Start sits on the circle at the bearing opposite the center.
    const startAngle = (deg + 180) % 360;
    const stops: TourStop[] = [{ lat: start.lat, lng: start.lng, name: start.name }];
    for (let i = 1; i < ring; i++) {
      const ang = (startAngle + (i * 360) / ring) % 360;
      const p = destination(center, ang, radiusM);
      stops.push({ lng: p[0], lat: p[1] });
    }
    stops.push({ lat: start.lat, lng: start.lng, name: start.name });

    const res = await fetchMultiPoint(stops, profile, signal);
    return {
      stops,
      distanceKm: res.distanceKm,
      durationMin: res.durationMin,
      roundness: roundnessOf(res.feature, res.distanceKm * 1000),
      analysis: analyse([res.feature]),
    };
  });

  const settled = await Promise.allSettled(tasks);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const ok = settled
    .filter((s): s is PromiseFulfilledResult<TourCandidate> => s.status === "fulfilled")
    .map((s) => s.value);

  if (ok.length === 0) {
    throw new Error("Keine Tour gefunden. Anderen Start oder eine andere Dauer versuchen.");
  }

  // Keep real loops only: enough enclosed area and a plausible distance.
  const plausible = (c: TourCandidate) =>
    c.distanceKm >= target * 0.5 && c.distanceKm <= target * 1.8;
  let pool = ok.filter((c) => c.roundness >= 0.18 && plausible(c));
  if (pool.length === 0) pool = ok.filter((c) => c.roundness >= 0.12);
  if (pool.length === 0) pool = ok;

  // Fitness: attractiveness + roundness bonus − distance penalty. Rewards
  // genuine, scenic loops that hit the requested length.
  const fitness = (c: TourCandidate) =>
    c.analysis.scores.overall +
    c.roundness * 3 -
    (Math.abs(c.distanceKm - target) / target) * 4;

  pool.sort((a, b) => fitness(b) - fitness(a));
  return pool;
}
