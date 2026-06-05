import { destination, type Coord } from "./geo";
import { fetchMultiPoint } from "./routing";
import { analyse, type RouteAnalysis } from "./analysis";
import type { RouteProfile } from "../types";

// The Tour-Genius generates real round trips (start = finish) and ranks them by
// the same motorcycle attractiveness score used everywhere else.
//
// Naively forcing the route through geometric circle points creates "Sackgassen"
// (dead-end stubs): whenever a via snaps onto a no-through lane, the router
// drives in and back out the same way. To avoid that we route in TWO passes:
//   1. A rough loop through points on a circle around the start.
//   2. We then place the real via points ONTO that first route's through-roads,
//      skipping any stretch that was ridden twice, and route again.
// The second pass therefore only has to reach points that already lie on
// genuine through-roads → clean loops without out-and-back spurs.

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

// Target ride distance per duration (real road km on curvy roads).
const TARGET_KM: Record<TourDuration, number> = { half: 90, full: 190 };

// Roads are a bit longer than the straight circle through the via-points.
const DETOUR = 1.3;
// Spacing between adjacent ring points on the first (rough) pass.
const POINT_SPACING_M = 13000;
// Rotate the loop around the start by these bearings (one candidate each).
const BEARINGS = [0, 40, 80, 120, 160, 200, 240, 280, 320];
// Resampling step when analysing route geometry.
const STEP_M = 120;
// Grid cell for detecting retraced road.
const CELL_M = 170;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function targetKm(duration: TourDuration): number {
  return TARGET_KM[duration];
}

interface Sample {
  lng: number;
  lat: number;
  cell: string;
}

// Resample a route LineString roughly every STEP_M metres.
function resample(feature: GeoJSON.Feature): Sample[] {
  const g = feature.geometry;
  if (g.type !== "LineString" || g.coordinates.length < 2) return [];
  const c = g.coordinates;
  const lat0 = (c[0][1] * Math.PI) / 180;
  const kx = Math.cos(lat0) * 111320;
  const ky = 110540;
  const cellOf = (lng: number, lat: number) =>
    `${Math.round((lng * kx) / CELL_M)},${Math.round((lat * ky) / CELL_M)}`;

  const out: Sample[] = [{ lng: c[0][0], lat: c[0][1], cell: cellOf(c[0][0], c[0][1]) }];
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const dx = (c[i][0] - c[i - 1][0]) * kx;
    const dy = (c[i][1] - c[i - 1][1]) * ky;
    const seg = Math.hypot(dx, dy);
    if (seg === 0) continue;
    acc += seg;
    while (acc >= STEP_M) {
      acc -= STEP_M;
      const t = 1 - acc / seg;
      const lng = c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t;
      const lat = c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
      out.push({ lng, lat, cell: cellOf(lng, lat) });
    }
  }
  return out;
}

// Fraction of the route that re-enters a grid cell it had already left
// (≈ retraced road / dead-end stubs).
function doubledOf(samples: Sample[]): number {
  if (samples.length === 0) return 1;
  const seen = new Set<string>();
  const recent: string[] = [];
  let revisit = 0;
  for (const s of samples) {
    if (seen.has(s.cell) && !recent.includes(s.cell)) revisit++;
    seen.add(s.cell);
    recent.push(s.cell);
    if (recent.length > 6) recent.shift();
  }
  return revisit / samples.length;
}

// Isoperimetric quotient (1 = circle, 0 = line) from the raw geometry.
function roundnessOf(feature: GeoJSON.Feature, perimM: number): number {
  const g = feature.geometry;
  if (g.type !== "LineString" || g.coordinates.length < 4 || perimM <= 0) return 0;
  const c = g.coordinates;
  const lat0 = (c[0][1] * Math.PI) / 180;
  const kx = Math.cos(lat0) * 111320;
  const ky = 110540;
  let twice = 0;
  for (let i = 0; i < c.length - 1; i++) {
    twice += c[i][0] * kx * (c[i + 1][1] * ky) - c[i + 1][0] * kx * (c[i][1] * ky);
  }
  const area = Math.abs(twice) / 2;
  return clamp((4 * Math.PI * area) / (perimM * perimM), 0, 1);
}

// Pick `k` via points spread evenly along the route, but only from stretches
// that were ridden exactly once (through-roads). Stub stretches are skipped.
function cleanVias(samples: Sample[], k: number): TourStop[] {
  const n = samples.length;
  if (n < k + 2) return [];
  const counts = new Map<string, number>();
  for (const s of samples) counts.set(s.cell, (counts.get(s.cell) ?? 0) + 1);
  const clean = (i: number) => (counts.get(samples[i].cell) ?? 0) <= 1;

  const vias: TourStop[] = [];
  for (let j = 1; j <= k; j++) {
    const target = Math.round((j * n) / (k + 1));
    let best = -1;
    for (let d = 0; d < Math.floor(n / (k + 1)); d++) {
      if (target - d > 0 && clean(target - d)) { best = target - d; break; }
      if (target + d < n && clean(target + d)) { best = target + d; break; }
    }
    if (best < 0) continue;
    const s = samples[best];
    const prev = vias[vias.length - 1];
    // Skip if essentially the same spot as the previous via.
    if (prev && Math.abs(prev.lat - s.lat) < 0.004 && Math.abs(prev.lng - s.lng) < 0.006) {
      continue;
    }
    vias.push({ lng: s.lng, lat: s.lat });
  }
  return vias;
}

export async function findTours(
  start: { lat: number; lng: number; name?: string },
  duration: TourDuration,
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<TourCandidate[]> {
  const target = TARGET_KM[duration];
  const radiusM = ((target / DETOUR) * 1000) / (2 * Math.PI);
  const ring = clamp(
    Math.round(Math.PI / Math.asin(clamp(POINT_SPACING_M / (2 * radiusM), 0.05, 0.99))),
    5,
    9,
  );
  const origin: Coord = [start.lng, start.lat];
  const startStop: TourStop = { lat: start.lat, lng: start.lng, name: start.name };

  const build = async (deg: number): Promise<TourCandidate> => {
    // Pass 1 – rough loop through circle points.
    const center = destination(origin, deg, radiusM);
    const startAngle = (deg + 180) % 360;
    const rough: TourStop[] = [startStop];
    for (let i = 1; i < ring; i++) {
      const ang = (startAngle + (i * 360) / ring) % 360;
      const p = destination(center, ang, radiusM);
      rough.push({ lng: p[0], lat: p[1] });
    }
    rough.push(startStop);
    const r1 = await fetchMultiPoint(rough, profile, signal);
    const s1 = resample(r1.feature);
    const cand1: TourCandidate = {
      stops: rough,
      distanceKm: r1.distanceKm,
      durationMin: r1.durationMin,
      roundness: roundnessOf(r1.feature, r1.distanceKm * 1000),
      doubled: doubledOf(s1),
      analysis: analyse([r1.feature]),
    };

    // Pass 2 – place vias onto the through-roads of pass 1 (skip stubs).
    const vias = cleanVias(s1, ring - 1);
    if (vias.length < 3) return cand1;
    const refined: TourStop[] = [startStop, ...vias, startStop];
    try {
      const r2 = await fetchMultiPoint(refined, profile, signal);
      const s2 = resample(r2.feature);
      const cand2: TourCandidate = {
        stops: refined,
        distanceKm: r2.distanceKm,
        durationMin: r2.durationMin,
        roundness: roundnessOf(r2.feature, r2.distanceKm * 1000),
        doubled: doubledOf(s2),
        analysis: analyse([r2.feature]),
      };
      // Keep pass 2 unless it actually got worse (more retracing).
      return cand2.doubled <= cand1.doubled + 0.02 ? cand2 : cand1;
    } catch {
      return cand1;
    }
  };

  const settled = await Promise.allSettled(BEARINGS.map(build));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const ok = settled
    .filter((s): s is PromiseFulfilledResult<TourCandidate> => s.status === "fulfilled")
    .map((s) => s.value);

  if (ok.length === 0) {
    throw new Error("Keine Tour gefunden. Anderen Start oder eine andere Dauer versuchen.");
  }

  const inBand = (c: TourCandidate) =>
    c.distanceKm >= target * 0.65 && c.distanceKm <= target * 1.45;

  // What riders actually want: lots of climbing, passes, curves and small
  // back-roads. Score that explicitly and only lightly weigh distance, so a
  // twisty mountain loop beats a flat lap around the lake. Spurs are still
  // penalised; roundness matters only a little.
  const ascentPerKm = (c: TourCandidate) =>
    c.distanceKm > 0 ? c.analysis.ascentM / c.distanceKm : 0;
  const share = (km: number, c: TourCandidate) =>
    c.distanceKm > 0 ? km / c.distanceKm : 0;
  const fun = (c: TourCandidate) => {
    const s = c.analysis.scores;
    const rk = c.analysis.roadKm;
    // Big roads the rider does NOT want: Hauptstrassen + Schnellstrassen + Autobahn.
    const bigShare = share(rk.haupt + rk.schnell + rk.autobahn, c);
    const smallShare = share(rk.neben, c); // little Landstrassen
    return (
      s.curves * 0.95 + // twisty
      s.mountains * 1.4 + // altitude + passes + climb
      Math.min(c.analysis.passes, 8) * 0.9 + // explicit pass bonus
      Math.min(ascentPerKm(c), 18) * 0.18 + // climbing density (hm/km)
      smallShare * 6 - // reward small Landstrassen
      bigShare * 10 - // strongly punish Haupt-/Schnellstr./Autobahn
      c.doubled * 6 - // dead-end / there-and-back stubs
      (Math.abs(c.distanceKm - target) / target) * 2
    );
  };

  // Drop only the clearly broken ones (heavy spurs / wildly wrong length),
  // then keep several so the rider can browse mountain alternatives.
  let pool = ok.filter((c) => c.doubled <= 0.2 && inBand(c));
  if (pool.length === 0) pool = ok.filter((c) => c.doubled <= 0.3);
  if (pool.length === 0) pool = ok;

  pool.sort((a, b) => fun(b) - fun(a));
  return pool.slice(0, 8);
}
