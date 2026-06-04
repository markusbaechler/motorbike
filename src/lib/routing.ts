import type { RouteProfile, RouteResult, Waypoint } from "../types";

// BRouter – free, key-less public routing server. It supports profiles that
// favour small, scenic back-roads over motorways, which suits motorcycle
// touring. https://brouter.de/
const BROUTER_URL = "https://brouter.de/brouter";

/**
 * Fetch a route through the given waypoints (in order) for the given profile.
 * Requires at least two waypoints. Pass an AbortSignal to cancel stale
 * requests when the user keeps editing.
 */
export async function fetchRoute(
  waypoints: Waypoint[],
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error("Mindestens zwei Wegpunkte nötig.");
  }

  const lonlats = waypoints
    .map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`)
    .join("|");

  const url =
    `${BROUTER_URL}?lonlats=${lonlats}` +
    `&profile=${profile}&alternativeidx=0&format=geojson`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Routing fehlgeschlagen (HTTP ${res.status}).`);
  }

  const geojson = (await res.json()) as GeoJSON.FeatureCollection;
  const props = (geojson.features?.[0]?.properties ?? {}) as Record<string, string>;

  return {
    geojson,
    distanceKm: Number(props["track-length"] ?? 0) / 1000,
    durationMin: Number(props["total-time"] ?? 0) / 60,
  };
}
