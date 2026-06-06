import type { LngLat } from "./types";

// Curvy, key-less routing via BRouter's public web API. We request GeoJSON so
// the resulting LineString can be dropped straight onto MapLibre, and read the
// total distance/time from the feature properties.
//
// https://brouter.de/  /  https://github.com/abrensch/brouter

const BROUTER = "https://brouter.de/brouter";

export interface RouteResult {
  geometry: GeoJSON.LineString;
  distance: number; // metres
  time: number; // seconds
}

/**
 * Route through the given waypoints (start → … → end) using a motorbike-
 * friendly profile. `profile` defaults to `car-fast` which keeps to paved,
 * faster roads; pass `trekking` to also allow rougher tracks.
 */
export async function routeThrough(
  waypoints: LngLat[],
  profile = "car-fast",
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error("Mindestens zwei Wegpunkte nötig.");
  }
  const lonlats = waypoints.map((w) => `${w.lon},${w.lat}`).join("|");
  const url =
    `${BROUTER}?lonlats=${lonlats}` +
    `&profile=${profile}&alternativeidx=0&format=geojson`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`BRouter ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection;
  const feature = data.features?.[0];
  if (!feature || feature.geometry?.type !== "LineString") {
    throw new Error("Keine Route gefunden.");
  }
  const props = (feature.properties ?? {}) as Record<string, string>;
  return {
    geometry: feature.geometry as GeoJSON.LineString,
    distance: Number(props["track-length"] ?? 0),
    time: Number(props["total-time"] ?? 0),
  };
}
