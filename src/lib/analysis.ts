import { bearing, bearingDelta, haversine, type Coord } from "./geo";

export interface ElevationPoint {
  km: number;
  ele: number;
}

export interface RoadKm {
  autobahn: number;
  schnell: number;
  neben: number;
}

export interface RouteAnalysis {
  distanceKm: number;
  hasElevation: boolean;
  profile: ElevationPoint[];
  ascentM: number;
  descentM: number;
  minEle: number;
  maxEle: number;
  cornersPerKm: number;
  passes: number;
  hasRoadData: boolean;
  roadKm: RoadKm;
  scores: {
    attractiveness: number; // 0–10
    bergigkeit: number; // 0–10
    overall: number; // 0–10
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function collectCoords(features: GeoJSON.Feature[]): Coord[] {
  const coords: Coord[] = [];
  for (const f of features) {
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

function thin(coords: Coord[], minGap: number): Coord[] {
  if (coords.length === 0) return coords;
  const out: Coord[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (haversine(out[out.length - 1], coords[i]) >= minGap) out.push(coords[i]);
  }
  return out;
}

// Distance per road category, parsed from BRouter's per-segment "messages"
// table (columns include Distance and WayTags like "highway=secondary …").
function roadBreakdown(features: GeoJSON.Feature[]): { roadKm: RoadKm; hasData: boolean } {
  let autobahn = 0;
  let schnell = 0;
  let neben = 0;
  let hasData = false;

  for (const f of features) {
    const msgs = (f.properties as { messages?: string[][] } | undefined)?.messages;
    if (!Array.isArray(msgs) || msgs.length < 2) continue;
    const header = msgs[0];
    const di = header.indexOf("Distance");
    const wi = header.indexOf("WayTags");
    if (di < 0 || wi < 0) continue;
    hasData = true;
    for (let r = 1; r < msgs.length; r++) {
      const row = msgs[r];
      const dist = Number(row[di]) || 0;
      const m = String(row[wi] ?? "").match(/highway=([^\s]+)/);
      const hw = m ? m[1] : "";
      if (hw === "motorway" || hw === "motorway_link") autobahn += dist;
      else if (hw === "trunk" || hw === "trunk_link") schnell += dist;
      else neben += dist;
    }
  }

  return {
    roadKm: { autobahn: autobahn / 1000, schnell: schnell / 1000, neben: neben / 1000 },
    hasData,
  };
}

// Count mountain passes as prominent high points in the elevation profile
// (a climb of >=thresh followed by a descent of >=thresh).
function countPasses(eles: number[], thresh = 140): number {
  if (eles.length < 3) return 0;
  let passes = 0;
  let state: "climb" | "descend" = "descend";
  let valley = eles[0];
  let peak = eles[0];
  for (const e of eles) {
    if (state === "climb") {
      if (e > peak) peak = e;
      if (peak - e >= thresh) {
        if (peak - valley >= thresh) passes++;
        state = "descend";
        valley = e;
      }
    } else {
      if (e < valley) valley = e;
      if (e - valley >= thresh) {
        state = "climb";
        peak = e;
      }
    }
  }
  return passes;
}

export function analyse(features: GeoJSON.Feature[]): RouteAnalysis {
  const coords = collectCoords(features);

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
        if (d > 1) ascentM += d;
        else if (d < -1) descentM += -d;
      }
      prevEle = ele;
      profile.push({ km: cumM / 1000, ele });
    }
  }

  const distanceKm = cumM / 1000;
  const totalKm = distanceKm || 1;

  // Curves: count real corners (>25° on a ~40 m resampled track).
  const resampled = thin(coords, 40);
  let cornerCount = 0;
  for (let i = 1; i < resampled.length - 1; i++) {
    const b1 = bearing(resampled[i - 1], resampled[i]);
    const b2 = bearing(resampled[i], resampled[i + 1]);
    if (bearingDelta(b1, b2) > 25) cornerCount++;
  }
  const cornersPerKm = cornerCount / totalKm;

  const { roadKm, hasData } = roadBreakdown(features);
  const passes = hasElevation ? countPasses(profile.map((p) => p.ele)) : 0;

  // --- Attractiveness (multi-signal, 0–10) ---
  const curve01 = clamp(cornersPerKm / 3, 0, 1);
  const scenicShare = hasData ? roadKm.neben / totalKm : 0;
  const motorwayShare = hasData ? roadKm.autobahn / totalKm : 0;
  const attract01 = hasData
    ? clamp(0.5 * scenicShare + 0.5 * curve01 - 0.3 * motorwayShare, 0, 1)
    : curve01;
  const attractiveness = round1(attract01 * 10);

  // --- Bergigkeit (0–10) ---
  const alt01 = hasElevation ? clamp(maxEle / 2400, 0, 1) : 0;
  const pass01 = clamp(passes / 4, 0, 1);
  const ascent01 = clamp(ascentM / totalKm / 18, 0, 1);
  const bergigkeit = round1(clamp(0.5 * alt01 + 0.3 * pass01 + 0.2 * ascent01, 0, 1) * 10);

  const overall = round1(attractiveness * 0.6 + bergigkeit * 0.4);

  return {
    distanceKm,
    hasElevation,
    profile,
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    minEle: hasElevation ? Math.round(minEle) : 0,
    maxEle: hasElevation ? Math.round(maxEle) : 0,
    cornersPerKm: Math.round(cornersPerKm * 10) / 10,
    passes,
    hasRoadData: hasData,
    roadKm,
    scores: { attractiveness, bergigkeit, overall },
  };
}
