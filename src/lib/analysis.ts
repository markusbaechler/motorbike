import { bearing, bearingDelta, haversine, type Coord } from "./geo";

export interface ElevationPoint {
  km: number;
  ele: number;
}

export interface RoadKm {
  autobahn: number;
  schnell: number;
  haupt: number; // Hauptstrassen (primary/secondary)
  neben: number; // Landstrassen / small back-roads (tertiary & below)
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
  // Named passes the route crosses (from the pass list), in route order. When
  // no list is given, `passes` falls back to counting climbs in the profile.
  passes: number;
  passNames: string[] | null;
  hasRoadData: boolean;
  roadKm: RoadKm;
  scores: {
    curves: number; // 0–10 Kurvenreichtum
    mountains: number; // 0–10 Bergigkeit
    scenic: number; // 0–10 kleine Strassen, wenig Autobahn
    overall: number; // 0–10 Gesamt-Attraktivität
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
  let haupt = 0;
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
      else if (
        hw === "primary" ||
        hw === "primary_link" ||
        hw === "secondary" ||
        hw === "secondary_link"
      )
        haupt += dist;
      else neben += dist;
    }
  }

  return {
    roadKm: {
      autobahn: autobahn / 1000,
      schnell: schnell / 1000,
      haupt: haupt / 1000,
      neben: neben / 1000,
    },
    hasData,
  };
}

export interface KnownPass {
  name: string;
  lat: number;
  lng: number;
}

// A pass counts when the route passes within this distance of its point.
const PASS_RADIUS_M = 300;

/**
 * Named passes along the route, in the order they are ridden. Each pass is
 * compared with the track (thinned to ~100 m) after a cheap bounding-box test.
 */
export function passesOnRoute(coords: Coord[], known: KnownPass[]): string[] {
  if (coords.length === 0) return [];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const c of coords) {
    minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
    minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]);
  }
  const pad = 0.01;
  const near = known.filter(
    (p) => p.lat >= minLat - pad && p.lat <= maxLat + pad && p.lng >= minLng - pad && p.lng <= maxLng + pad,
  );
  if (near.length === 0) return [];
  const track = thin(coords, 100);
  const found: { name: string; at: number }[] = [];
  for (const p of near) {
    const pc: Coord = [p.lng, p.lat];
    for (let i = 0; i < track.length; i++) {
      if (Math.abs(track[i][1] - p.lat) > 0.01 || Math.abs(track[i][0] - p.lng) > 0.015) continue;
      if (haversine(track[i], pc) <= PASS_RADIUS_M) {
        if (!found.some((f) => f.name === p.name)) found.push({ name: p.name, at: i });
        break;
      }
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.name);
}

// Fallback without a pass list: prominent high points in the elevation profile
// (a climb of >=thresh followed by a descent of >=thresh). Overcounts in hilly
// country (every Jura ridge is a "pass"), hence only a fallback.
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

export function analyse(features: GeoJSON.Feature[], knownPasses?: KnownPass[]): RouteAnalysis {
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
  const passNames = knownPasses ? passesOnRoute(coords, knownPasses) : null;
  const passes = passNames ? passNames.length : hasElevation ? countPasses(profile.map((p) => p.ele)) : 0;

  // --- Sub-scores (each 0–1) ---
  // Calibrated on the club tours and reference routes so that the club's
  // favourites (Jura XXL, the Ticino rounds) land around 8, alpine pass
  // tours higher, a flat Mittelland loop clearly lower and motorway near 0.
  // Measures are relative to the terrain (relief, climb, passes) rather than
  // absolute altitude, so a great Jura tour isn't held down by not being
  // 2400 m high.
  // Curves: rising quickly, then levelling off (diminishing returns):
  // 1 corner/km ≈ 3.7, 2.5 ≈ 7.7, 3 ≈ 8.3, 5 ≈ 9.6.
  const curve01 = 1 - Math.exp(-Math.max(0, cornersPerKm - 0.3) / 1.5);
  // Mountains: relief (highest minus lowest point, 1400 m = full), climbing
  // per km (16 m/km = full) and named passes (8 = full).
  const relief01 = hasElevation ? clamp((maxEle - minEle) / 1400, 0, 1) : 0;
  const ascent01 = clamp(ascentM / totalKm / 16, 0, 1);
  const pass01 = clamp(passes / 8, 0, 1);
  const mountains01 = clamp(0.4 * relief01 + 0.3 * ascent01 + 0.3 * pass01, 0, 1);
  // Roads: motorway counts fully against the tour, trunk roads mostly, main
  // roads a little (alpine passes are main roads in OSM, so they must not be
  // punished as hard as a motorway).
  const scenic01 = hasData
    ? clamp(1 - (roadKm.autobahn + 0.6 * roadKm.schnell + 0.25 * roadKm.haupt) / totalKm, 0, 1)
    : 0.5;

  const overall = round1((curve01 * 0.4 + mountains01 * 0.4 + scenic01 * 0.2) * 10);

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
    passNames,
    hasRoadData: hasData,
    roadKm,
    scores: {
      curves: round1(curve01 * 10),
      mountains: round1(mountains01 * 10),
      scenic: round1(scenic01 * 10),
      overall,
    },
  };
}
