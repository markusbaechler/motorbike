// Router-scored loop optimiser for the Pässeplaner (Tour-Genius principle).
//
// Given a start, the rider's marked passes (need/nice) and the region's other
// passes, this builds a round tour (or point-to-point trip) that strings the
// marked passes together AND auto-adds the scenic through-passes that lie
// naturally on the way — chosen so the loop rides as many passes as possible
// while minimising back-tracking ("Rückfahrten").
//
// Crucially every candidate is judged with the REAL router (BRouter), not with
// straight-line geometry. The old corridor approach (throughPassesAlong)
// projected passes onto the straight leg between two anchors; between e.g.
// Susten and Gotthard that straight line runs east past Oberalp, so it added
// the wrong passes and missed Grimsel/Furka (which sit on the actual road loop
// to the south-west). Here we instead try inserting a candidate pass, route the
// resulting tour for real, and keep the insertion only if the routed tour gets
// better (more passes, no extra retracing, acceptable extra distance).

import { haversine, type Coord } from "./geo";
import { fetchMultiPoint } from "./routing";
import { orderByNearestNeighbour, orderForLoop, type KeyedPass } from "./passplanner";
import type { RouteProfile } from "../types";

export interface OptStop {
  lat: number;
  lng: number;
  name?: string;
  // Pass anchors carry their stable key; the start/end anchors do not. Used to
  // count how many passes the tour deliberately rides.
  key?: string;
}

export interface OptResult {
  stops: OptStop[]; // start, …passes…, end (or start again for a round trip)
  distanceKm: number;
  durationMin: number;
  doubled: number; // 0 (no overlap) … 1 (mostly retraced)
  passCount: number; // number of pass anchors the tour rides
  feature: GeoJSON.Feature;
  added: OptStop[]; // passes the optimiser auto-added on top of the marked ones
}

export interface OptimizeParams {
  start: { lat: number; lng: number; name?: string };
  end: { lat: number; lng: number; name?: string } | null; // null → round trip
  marked: KeyedPass[]; // user-marked passes (need + nice), all included
  region: KeyedPass[]; // candidate pool of the region's passes (surface-filtered)
  profile: RouteProfile;
  signal?: AbortSignal;
  // Tunables (defaults are good for Alpine pass loops).
  corridorKm?: number; // pre-filter: how far a candidate may sit from the loop
  maxAdds?: number; // cap on auto-added passes
  trialsPerRound?: number; // candidate passes routed per greedy round
  maxPool?: number; // cap on the candidate pool size
}

// --- scoring weights (in km-equivalent units; W_KM = 1) ---
// score = (passes ridden) − (real routed km) − (retraced fraction).
// A pass is worth up to ~35 km of extra riding, and retracing is punished hard.
// The doubling weight sits in a deliberate window, validated by the BRouter
// harness (scripts/test-passopt.mjs) on the Wassen / Susten+Gotthard case:
//   • below ~570 the genuine, SHORTER through-pass (Furka, 140 km) beats the
//     longer "rounder" alternative (Nufenen, 164 km);
//   • above ~410 the eastward out-and-back spur (Oberalp) is rejected because
//     its retracing outweighs the extra pass.
const W_PASS = 35;
const W_KM = 1;
const W_DOUBLED = 480;

// Absolute ceiling on a tour's retraced fraction. A pure score gate can't stop
// over-stuffing: each extra pass lengthens the loop, which DILUTES the global
// `doubled` fraction, so spurs/southern bulges (Oberalp, Nufenen) keep sneaking
// in and the loop ties itself in knots. The clean Alpine multi-pass loops the
// optimiser is meant to produce stay well under this (Susten-Grimsel-Furka-
// Gotthard ≈ 0.05, Gotthard-Furka-Grimsel-Brünig ≈ 0.09); the 7-pass tangle that
// prompted this gate sat at ≈ 0.16. Any insertion that pushes a tour above the
// ceiling is rejected outright, regardless of how many passes it would add.
const MAX_DOUBLED = 0.11;

const score = (t: { passCount: number; distanceKm: number; doubled: number }) =>
  t.passCount * W_PASS - t.distanceKm * W_KM - t.doubled * W_DOUBLED;

// --- retracing detection (same idea as the Tour-Genius) ---
const STEP_M = 120; // resample step
const CELL_M = 170; // grid cell for detecting retraced road

interface Sample {
  cell: string;
}

function resample(feature: GeoJSON.Feature): Sample[] {
  const g = feature.geometry;
  if (g.type !== "LineString" || g.coordinates.length < 2) return [];
  const c = g.coordinates;
  const lat0 = (c[0][1] * Math.PI) / 180;
  const kx = Math.cos(lat0) * 111320;
  const ky = 110540;
  const cellOf = (lng: number, lat: number) =>
    `${Math.round((lng * kx) / CELL_M)},${Math.round((lat * ky) / CELL_M)}`;

  const out: Sample[] = [{ cell: cellOf(c[0][0], c[0][1]) }];
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
      out.push({ cell: cellOf(lng, lat) });
    }
  }
  return out;
}

// Fraction of the route that re-enters a grid cell it had already left
// (≈ retraced road / dead-end / out-and-back stubs).
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

// Shortest distance (metres) from point p to the segment a–b in a local
// equirectangular projection.
function distSegM(p: Coord, a: Coord, b: Coord): number {
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

// Smallest distance (metres) from a pass to any anchor-leg of the current loop.
function minDistToSeq(seq: OptStop[], p: { lat: number; lng: number }): number {
  const pt: Coord = [p.lng, p.lat];
  let best = Infinity;
  for (let i = 1; i < seq.length; i++) {
    const a: Coord = [seq[i - 1].lng, seq[i - 1].lat];
    const b: Coord = [seq[i].lng, seq[i].lat];
    best = Math.min(best, distSegM(pt, a, b));
  }
  return best;
}

// The straight-line detour (km) added by inserting p at its cheapest position
// in seq, plus that position's index. Used only to RANK which candidates are
// worth a (real) routing trial — acceptance is always decided by the router.
function bestInsertion(seq: OptStop[], p: OptStop): { index: number; detourKm: number } {
  let bestIdx = 1;
  let bestDetour = Infinity;
  const pc: Coord = [p.lng, p.lat];
  for (let i = 1; i < seq.length; i++) {
    const a: Coord = [seq[i - 1].lng, seq[i - 1].lat];
    const b: Coord = [seq[i].lng, seq[i].lat];
    const detour =
      (haversine(a, pc) + haversine(pc, b) - haversine(a, b)) / 1000;
    if (detour < bestDetour) {
      bestDetour = detour;
      bestIdx = i;
    }
  }
  return { index: bestIdx, detourKm: bestDetour };
}

const toStop = (p: KeyedPass): OptStop => ({
  lat: p.lat,
  lng: p.lng,
  name: p.name,
  key: p.key,
});

interface Routed {
  stops: OptStop[];
  distanceKm: number;
  durationMin: number;
  doubled: number;
  passCount: number;
  feature: GeoJSON.Feature;
}

async function routeTour(
  stops: OptStop[],
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<Routed> {
  const r = await fetchMultiPoint(stops, profile, signal);
  return {
    stops,
    distanceKm: r.distanceKm,
    durationMin: r.durationMin,
    doubled: doubledOf(resample(r.feature)),
    passCount: stops.filter((s) => s.key).length,
    feature: r.feature,
  };
}

/**
 * Build the best loop / point-to-point tour over the marked passes, auto-adding
 * scenic through-passes only when the REAL routed tour improves (more passes,
 * no extra retracing, acceptable extra distance).
 */
export async function optimizeLoop(params: OptimizeParams): Promise<OptResult> {
  const {
    start,
    end,
    marked,
    region,
    profile,
    signal,
    corridorKm = 30,
    maxAdds = 6,
    trialsPerRound = 4,
    maxPool = 12,
  } = params;

  const startStop: OptStop = { lat: start.lat, lng: start.lng, name: start.name };
  const endStop: OptStop = end
    ? { lat: end.lat, lng: end.lng, name: end.name }
    : startStop;

  // Order the marked passes into a sensible visiting sequence: nearest-neighbour
  // toward the destination for point-to-point, angular sweep for a round trip.
  const orderedMarked = (
    end ? orderByNearestNeighbour(start, marked) : orderForLoop(start, marked)
  ).map(toStop);

  let seq: OptStop[] = [startStop, ...orderedMarked, endStop];

  // Candidate pool: the region's through-passes (kind "pass"), not already
  // marked, within a generous corridor of the current loop. The corridor is
  // only a cheap pre-filter — the router decides what actually gets added, so a
  // few too many candidates just cost a couple of extra routing trials.
  const markedKeys = new Set(marked.map((p) => p.key));
  let pool = region
    .filter(
      (p) =>
        p.kind === "pass" &&
        !markedKeys.has(p.key) &&
        minDistToSeq(seq, p) <= corridorKm * 1000,
    )
    .sort((a, b) => minDistToSeq(seq, a) - minDistToSeq(seq, b))
    .slice(0, maxPool);

  let current = await routeTour(seq, profile, signal);
  const addedKeys = new Set<string>();

  for (let round = 0; round < maxAdds && pool.length > 0; round++) {
    // Rank remaining candidates by straight-line insertion cost; only route the
    // cheapest few this round to keep the number of BRouter calls bounded.
    const ranked = pool
      .map((p) => ({ p, ins: bestInsertion(seq, toStop(p)) }))
      .sort((a, b) => a.ins.detourKm - b.ins.detourKm)
      .slice(0, trialsPerRound);

    let best: Routed | null = null;
    let bestKey: string | null = null;
    for (const { p, ins } of ranked) {
      const trial = [...seq];
      trial.splice(ins.index, 0, toStop(p));
      let routed: Routed;
      try {
        routed = await routeTour(trial, profile, signal);
      } catch {
        continue; // routing failed for this trial — skip it
      }
      // Reject anything that turns the tour into a knot (absolute retracing
      // ceiling) before even considering the score — this is what stops the
      // optimiser from stuffing in spurs/bulges (Oberalp, Nufenen) that the
      // dilution-prone score alone lets through.
      if (routed.doubled > MAX_DOUBLED) continue;
      // Among the acceptable candidates, keep the one that improves the routed
      // score most.
      if (score(routed) > score(current) && (!best || score(routed) > score(best))) {
        best = routed;
        bestKey = p.key;
      }
    }

    if (best && bestKey) {
      current = best;
      seq = best.stops;
      addedKeys.add(bestKey);
      pool = pool.filter((p) => p.key !== bestKey);
    } else {
      break; // no candidate improved the tour without back-tracking → done
    }
  }

  return {
    stops: current.stops,
    distanceKm: current.distanceKm,
    durationMin: current.durationMin,
    doubled: current.doubled,
    passCount: current.passCount,
    feature: current.feature,
    added: current.stops.filter((s) => s.key && addedKeys.has(s.key)),
  };
}
