import { destination, type Coord } from "./geo";
import { fetchMultiPoint } from "./routing";
import { analyse, type RouteAnalysis } from "./analysis";
import type { RouteProfile } from "../types";

// The Tour-Genius generates round trips (start = finish) and ranks them by
// the same motorcycle attractiveness score used everywhere else. It builds a
// handful of candidate loops by placing via-points evenly on a circle around
// the start, rotated to different compass bearings, routes each one and keeps
// the statistically best ones.

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
  analysis: RouteAnalysis;
}

// Rough target ride distance per duration (real road km, curvy roads).
const TARGET_KM: Record<TourDuration, number> = { half: 120, full: 250 };

// Roads are longer than the straight polygon through the via-points.
const DETOUR = 1.35;
// Points placed on the circle, including the start (4 → a rounded square loop).
const RING = 4;
// Compass bearings to rotate the loop around the start by (one candidate each).
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

export function targetKm(duration: TourDuration): number {
  return TARGET_KM[duration];
}

export async function findTours(
  start: { lat: number; lng: number; name?: string },
  duration: TourDuration,
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<TourCandidate[]> {
  const target = TARGET_KM[duration];
  // Straight-line loop perimeter we aim for, then the circle radius that
  // yields it: perimeter = RING · 2r · sin(π/RING).
  const straightPerimM = (target / DETOUR) * 1000;
  const radiusM = straightPerimM / (RING * 2 * Math.sin(Math.PI / RING));

  const origin: Coord = [start.lng, start.lat];

  const tasks = BEARINGS.map(async (deg): Promise<TourCandidate> => {
    const center = destination(origin, deg, radiusM);
    // Start sits on the circle at the bearing opposite the center.
    const startAngle = (deg + 180) % 360;
    const stops: TourStop[] = [{ lat: start.lat, lng: start.lng, name: start.name }];
    for (let i = 1; i < RING; i++) {
      const ang = (startAngle + (i * 360) / RING) % 360;
      const p = destination(center, ang, radiusM);
      stops.push({ lng: p[0], lat: p[1] });
    }
    stops.push({ lat: start.lat, lng: start.lng, name: start.name });

    const res = await fetchMultiPoint(stops, profile, signal);
    return {
      stops,
      distanceKm: res.distanceKm,
      durationMin: res.durationMin,
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

  // Keep candidates whose real distance is in a plausible band around target.
  let pool = ok.filter((c) => c.distanceKm >= target * 0.55 && c.distanceKm <= target * 1.7);
  if (pool.length === 0) pool = ok;

  // Fitness: attractiveness score, lightly penalised for missing the target
  // distance (50 % off ≈ −2 points).
  const fitness = (c: TourCandidate) =>
    c.analysis.scores.overall - (Math.abs(c.distanceKm - target) / target) * 4;

  pool.sort((a, b) => fitness(b) - fitness(a));
  return pool;
}
