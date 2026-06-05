import { destination, type Coord } from "./geo";
import { fetchMultiPoint } from "./routing";
import { analyse, type RouteAnalysis } from "./analysis";
import type { RouteProfile } from "../types";

// The Tour-Genius generates real round trips (start = finish) and ranks them
// by the same motorcycle attractiveness score used everywhere else.
//
// It places via points on a circle around the start (rotated to several
// compass bearings → several candidates), routes each, and then measures the
// resulting geometry for two loop-quality signals:
//   • roundness  – how much area the route encloses (1 = circle, 0 = a line)
//   • doubled    – how much of the route is ridden twice (dead-end stubs /
//                  there-and-back). High = ugly spurs ("Sackgassen").
// Candidates with spurs or poor loops are dropped; the cleanest, most scenic
// loop closest to the requested length wins.

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
  doubled: number; // 0 (no overlap) … 1 (mostly retraced)
  analysis: RouteAnalysis;
}

// Target ride distance per duration (real road km on curvy roads). Curvy
// riding is slow, so a "half day" is ~90 km, a "full day" ~190 km.
const TARGET_KM: Record<TourDuration, number> = { half: 90, full: 190 };

// Roads are a bit longer than the straight circle through the via-points.
const DETOUR = 1.3;
// Spacing between adjacent ring points. Large enough to avoid snapping lots of
// points onto dead-end lanes, small enough to keep the route on the ring.
const POINT_SPACING_M = 13000;
// Rotate the loop around the start by these bearings (one candidate each).
const BEARINGS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function targetKm(duration: TourDuration): number {
  return TARGET_KM[duration];
}

interface LoopMetrics {
  roundness: number;
  doubled: number;
}

// Measure how round the route is and how much of it is retraced. Uses a local
// equirectangular projection (translation-invariant, so the origin is moot).
function loopMetrics(feature: GeoJSON.Feature, perimM: number): LoopMetrics {
  const g = feature.geometry;
  if (g.type !== "LineString" || g.coordinates.length < 4 || perimM <= 0) {
    return { roundness: 0, doubled: 1 };
  }
  const c = g.coordinates;
  const lat0 = (c[0][1] * Math.PI) / 180;
  const kx = Math.cos(lat0) * 111320;
  const ky = 110540;
  const px = (p: number[]) => p[0] * kx;
  const py = (p: number[]) => p[1] * ky;

  // Shoelace area → roundness (isoperimetric quotient).
  let twice = 0;
  for (let i = 0; i < c.length - 1; i++) {
    twice += px(c[i]) * py(c[i + 1]) - px(c[i + 1]) * py(c[i]);
  }
  const area = Math.abs(twice) / 2;
  const roundness = clamp((4 * Math.PI * area) / (perimM * perimM), 0, 1);

  // Resample every ~120 m and hash into a grid; cells re-entered after leaving
  // them indicate retraced road (spurs / there-and-back).
  const cell = 170;
  const seen = new Set<string>();
  const recent: string[] = [];
  let samples = 0;
  let revisit = 0;
  let acc = 0;
  const visit = (x: number, y: number) => {
    const key = `${Math.round(x / cell)},${Math.round(y / cell)}`;
    samples++;
    if (seen.has(key) && !recent.includes(key)) revisit++;
    seen.add(key);
    recent.push(key);
    if (recent.length > 6) recent.shift();
  };
  visit(px(c[0]), py(c[0]));
  for (let i = 1; i < c.length; i++) {
    const x1 = px(c[i - 1]);
    const y1 = py(c[i - 1]);
    const x2 = px(c[i]);
    const y2 = py(c[i]);
    const seg = Math.hypot(x2 - x1, y2 - y1);
    acc += seg;
    while (acc >= 120 && seg > 0) {
      acc -= 120;
      const t = 1 - acc / seg;
      visit(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    }
  }
  const doubled = samples > 0 ? revisit / samples : 1;
  return { roundness, doubled };
}

export async function findTours(
  start: { lat: number; lng: number; name?: string },
  duration: TourDuration,
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<TourCandidate[]> {
  const target = TARGET_KM[duration];
  // Size the radius from the target circle circumference, then choose how many
  // points keep neighbours ~POINT_SPACING_M apart (few enough to avoid spurs).
  const radiusM = ((target / DETOUR) * 1000) / (2 * Math.PI);
  const ring = clamp(
    Math.round(Math.PI / Math.asin(clamp(POINT_SPACING_M / (2 * radiusM), 0.05, 0.99))),
    5,
    9,
  );

  const origin: Coord = [start.lng, start.lat];

  const tasks = BEARINGS.map(async (deg): Promise<TourCandidate> => {
    const center = destination(origin, deg, radiusM);
    const startAngle = (deg + 180) % 360;
    const stops: TourStop[] = [{ lat: start.lat, lng: start.lng, name: start.name }];
    for (let i = 1; i < ring; i++) {
      const ang = (startAngle + (i * 360) / ring) % 360;
      const p = destination(center, ang, radiusM);
      stops.push({ lng: p[0], lat: p[1] });
    }
    stops.push({ lat: start.lat, lng: start.lng, name: start.name });

    const res = await fetchMultiPoint(stops, profile, signal);
    const m = loopMetrics(res.feature, res.distanceKm * 1000);
    return {
      stops,
      distanceKm: res.distanceKm,
      durationMin: res.durationMin,
      roundness: m.roundness,
      doubled: m.doubled,
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

  const inBand = (c: TourCandidate) =>
    c.distanceKm >= target * 0.7 && c.distanceKm <= target * 1.3;

  // Prefer clean loops (round, little retracing) of the right length. Relax the
  // criteria step by step if nothing qualifies.
  let pool = ok.filter((c) => c.roundness >= 0.3 && c.doubled <= 0.22 && inBand(c));
  if (pool.length === 0) pool = ok.filter((c) => c.roundness >= 0.22 && c.doubled <= 0.3);
  if (pool.length === 0) pool = ok.filter((c) => c.doubled <= 0.4);
  if (pool.length === 0) pool = ok;

  // Fitness: attractiveness, strong reward for roundness, strong penalty for
  // retraced road and for missing the requested length.
  const fitness = (c: TourCandidate) =>
    c.analysis.scores.overall +
    c.roundness * 4 -
    c.doubled * 7 -
    (Math.abs(c.distanceKm - target) / target) * 5;

  pool.sort((a, b) => fitness(b) - fitness(a));
  return pool;
}
