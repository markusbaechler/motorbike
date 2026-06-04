import type { RouteProfile, RouteResult, Waypoint } from "../types";

// BRouter – free, key-less public routing server. Routing runs from the
// user's browser. https://brouter.de/
const BROUTER_URL = "https://brouter.de/brouter";

interface Leg {
  feature: GeoJSON.Feature;
  distanceKm: number;
  durationMin: number;
  profile: RouteProfile;
}

// Fetch a single leg (between two consecutive waypoints) with its own profile.
async function fetchLeg(
  from: Waypoint,
  to: Waypoint,
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<Leg> {
  const lonlats =
    `${from.lng.toFixed(6)},${from.lat.toFixed(6)}|` +
    `${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;

  const url =
    `${BROUTER_URL}?lonlats=${lonlats}` +
    `&profile=${profile}&alternativeidx=0&format=geojson`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Routing fehlgeschlagen (HTTP ${res.status}).`);
  }

  const geojson = (await res.json()) as GeoJSON.FeatureCollection;
  const feature = geojson.features?.[0];
  if (!feature) {
    throw new Error("Keine Route für diesen Abschnitt gefunden.");
  }

  const props = (feature.properties ?? {}) as Record<string, string>;
  // Tag the leg with its profile so the map can colour it.
  feature.properties = { ...feature.properties, profile };

  return {
    feature,
    distanceKm: Number(props["track-length"] ?? 0) / 1000,
    durationMin: Number(props["total-time"] ?? 0) / 60,
    profile,
  };
}

/**
 * Route through all waypoints in order, computing each leg with that leg's
 * own profile, then combining them into one result. Legs are fetched in
 * parallel. Requires at least two waypoints.
 */
export async function fetchRoute(
  waypoints: Waypoint[],
  signal?: AbortSignal,
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error("Mindestens zwei Wegpunkte nötig.");
  }

  const legPromises: Promise<Leg>[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    legPromises.push(
      fetchLeg(waypoints[i - 1], waypoints[i], waypoints[i].legProfile, signal),
    );
  }

  const legs = await Promise.all(legPromises);

  return {
    geojson: {
      type: "FeatureCollection",
      features: legs.map((l) => l.feature),
    },
    distanceKm: legs.reduce((sum, l) => sum + l.distanceKm, 0),
    durationMin: legs.reduce((sum, l) => sum + l.durationMin, 0),
    legs: legs.map((l) => ({
      profile: l.profile,
      distanceKm: l.distanceKm,
      durationMin: l.durationMin,
    })),
  };
}
