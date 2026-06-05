import type { RouteProfile, RouteResult, Waypoint } from "../types";

// BRouter – free, key-less public routing server. Routing runs from the
// user's browser. https://brouter.de/
const BROUTER = "https://brouter.de";

// Map each logical UI profile to one or more stock BRouter profiles, tried in
// order (fallback if the first is unavailable on the public server).
//   kurvig  -> "moped": may not use motorways/trunk by law, so it routes over
//              small, winding back-roads (scenic / curvy).
//   schnell -> "car-fast": motorway-friendly, direct.
const BROUTER_PROFILES: Record<RouteProfile, string[]> = {
  kurvig: ["car-eco", "car-fast"],
  kurvig_plus: ["moped", "car-eco"],
  schnell: ["car-fast", "car-eco"],
};

// BRouter's per-profile travel time is unrealistic for motorcycles (the moped
// profile in particular assumes very low speeds). We estimate the duration
// from distance using realistic average speeds per mode (tuned to match real
// navigation apps like Beeline, which factor in curves/elevation/stops).
const AVG_SPEED_KMH: Record<RouteProfile, number> = {
  kurvig: 42,
  kurvig_plus: 36,
  schnell: 82,
};

interface Leg {
  feature: GeoJSON.Feature;
  distanceKm: number;
  durationMin: number;
  profile: RouteProfile;
}

async function fetchLeg(
  from: Waypoint,
  to: Waypoint,
  profile: RouteProfile,
  legIndex: number,
  signal?: AbortSignal,
): Promise<Leg> {
  const lonlats =
    `${from.lng.toFixed(6)},${from.lat.toFixed(6)}|` +
    `${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;

  let lastError = "unbekannter Fehler";

  for (const brouterProfile of BROUTER_PROFILES[profile]) {
    const url =
      `${BROUTER}/brouter?lonlats=${lonlats}` +
      `&profile=${brouterProfile}&alternativeidx=0&format=geojson`;

    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      lastError = (e as Error).message;
      continue;
    }

    if (!res.ok) {
      // BRouter returns a helpful message in the body for 400s.
      const body = (await res.text()).replace(/\s+/g, " ").trim();
      lastError = `HTTP ${res.status} – ${body.slice(0, 160)}`;
      continue;
    }

    const geojson = (await res.json()) as GeoJSON.FeatureCollection;
    const feature = geojson.features?.[0];
    if (!feature) {
      lastError = "leere Antwort vom Routing-Dienst";
      continue;
    }

    const props = (feature.properties ?? {}) as Record<string, string>;
    // Tag the leg with its logical profile (for colouring) and index (drag).
    feature.properties = { ...feature.properties, profile, legIndex };

    const distanceKm = Number(props["track-length"] ?? 0) / 1000;
    return {
      feature,
      distanceKm,
      durationMin: (distanceKm / AVG_SPEED_KMH[profile]) * 60,
      profile,
    };
  }

  throw new Error(`Etappe ${legIndex + 1}: ${lastError}`);
}

/**
 * Route through several points in a single BRouter request (one combined
 * track for the whole chain). Used by the Tour-Genius to evaluate candidate
 * loops cheaply. Returns the combined feature plus distance & duration.
 */
export async function fetchMultiPoint(
  points: { lat: number; lng: number }[],
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<{ feature: GeoJSON.Feature; distanceKm: number; durationMin: number }> {
  if (points.length < 2) throw new Error("Mindestens zwei Punkte nötig.");
  const lonlats = points
    .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
    .join("|");

  let lastError = "unbekannter Fehler";
  for (const brouterProfile of BROUTER_PROFILES[profile]) {
    const url =
      `${BROUTER}/brouter?lonlats=${lonlats}` +
      `&profile=${brouterProfile}&alternativeidx=0&format=geojson`;

    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      lastError = (e as Error).message;
      continue;
    }
    if (!res.ok) {
      const body = (await res.text()).replace(/\s+/g, " ").trim();
      lastError = `HTTP ${res.status} – ${body.slice(0, 160)}`;
      continue;
    }

    const geojson = (await res.json()) as GeoJSON.FeatureCollection;
    const feature = geojson.features?.[0];
    if (!feature) {
      lastError = "leere Antwort vom Routing-Dienst";
      continue;
    }
    const props = (feature.properties ?? {}) as Record<string, string>;
    feature.properties = { ...feature.properties, profile, legIndex: 0 };
    const distanceKm = Number(props["track-length"] ?? 0) / 1000;
    return {
      feature,
      distanceKm,
      durationMin: (distanceKm / AVG_SPEED_KMH[profile]) * 60,
    };
  }
  throw new Error(lastError);
}

/**
 * Route through all waypoints in order, computing each leg with that leg's
 * own profile, then combining them. Legs are fetched in parallel. Requires at
 * least two waypoints.
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
      fetchLeg(waypoints[i - 1], waypoints[i], waypoints[i].legProfile, i - 1, signal),
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
