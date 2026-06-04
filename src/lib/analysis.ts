import { bearing, bearingDelta, haversine, type Coord } from "./geo";
import type { RouteResult } from "../types";

export interface ElevationPoint {
  km: number;
  ele: number;
}

export interface RouteAnalysis {
  hasElevation: boolean;
  profile: ElevationPoint[];
  ascentM: number;
  descentM: number;
  minEle: number;
  maxEle: number;
  cornersPerKm: number;
  scores: {
    curves: number; // 0–10
    climb: number; // 0–10
    overall: number; // 0–10
  };
}

// Flatten all leg geometries into one ordered coordinate list, dropping
// duplicated join points between consecutive legs.
function collectCoords(route: RouteResult): Coord[] {
  const coords: Coord[] = [];
  for (const f of route.geojson.features) {
    const g = f.geometry;
    if (g.type !== "LineString") continue;
    for (const c of g.coordinates) {
      const last = coords[coords.length - 1];
      if (last && last[0] === c[0] && last[1] === c[1]) continue;
      coords.push(c);
    }
  }
  return coords;
}

// Keep only points at least `minGap` metres apart, to reduce GPS jitter
// before measuring curvature.
function thin(coords: Coord[], minGap: number): Coord[] {
  if (coords.length === 0) return coords;
  const out: Coord[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (haversine(out[out.length - 1], coords[i]) >= minGap) out.push(coords[i]);
  }
  return out;
}

const clamp10 = (v: number) => Math.max(0, Math.min(10, v));

export function analyseRoute(route: RouteResult): RouteAnalysis {
  const coords = collectCoords(route);

  // Elevation profile + ascent/descent
  const profile: ElevationPoint[] = [];
  let cumM = 0;
  let ascentM = 0;
  let descentM = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let hasElevation = false;
  let prevEle: number | null = null;

  for (let i = 0; i < coords.length; i++) {
    if (i > 0) cumM += haversine(coords[i - 1], coords[i]);
    const ele = coords[i].length > 2 ? coords[i][2] : NaN;
    if (Number.isFinite(ele)) {
      hasElevation = true;
      minEle = Math.min(minEle, ele);
      maxEle = Math.max(maxEle, ele);
      if (prevEle !== null) {
        const d = ele - prevEle;
        if (d > 1) ascentM += d; // ignore <1 m noise
        else if (d < -1) descentM += -d;
      }
      prevEle = ele;
      profile.push({ km: cumM / 1000, ele });
    }
  }

  const totalKm = cumM / 1000 || 1;

  // Curviness: count *real* corners (sharp direction changes), not the dense
  // micro-wiggles of the raw geometry. We resample to ~60 m spacing and count
  // vertices whose turn angle exceeds 30° — i.e. bends/hairpins. Motorways and
  // valley roads have ~0 corners/km; alpine pass roads have many.
  const resampled = thin(coords, 40);
  let cornerCount = 0;
  for (let i = 1; i < resampled.length - 1; i++) {
    const b1 = bearing(resampled[i - 1], resampled[i]);
    const b2 = bearing(resampled[i], resampled[i + 1]);
    if (bearingDelta(b1, b2) > 25) cornerCount++;
  }
  const cornersPerKm = cornerCount / totalKm;

  // Heuristic scores (0–10). Transparent, not an external rating.
  // Curves: ~3 real corners/km is already a very twisty road -> 10.
  const curves = clamp10((cornersPerKm / 3) * 10);
  // Bergigkeit: combine how high it goes (pass altitude) with climb density.
  const altScore = hasElevation ? clamp10((maxEle / 2400) * 10) : 0;
  const ascentScore = clamp10((ascentM / totalKm / 18) * 10);
  const climb = clamp10(Math.max(altScore, ascentScore) * 0.85 + Math.min(altScore, ascentScore) * 0.15);
  const overall = Math.round((curves * 0.55 + climb * 0.45) * 10) / 10;

  return {
    hasElevation,
    profile,
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    minEle: hasElevation ? Math.round(minEle) : 0,
    maxEle: hasElevation ? Math.round(maxEle) : 0,
    cornersPerKm: Math.round(cornersPerKm * 10) / 10,
    scores: {
      curves: Math.round(curves * 10) / 10,
      climb: Math.round(climb * 10) / 10,
      overall,
    },
  };
}
