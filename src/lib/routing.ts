import type { RouteProfile, RouteResult, Waypoint } from "../types";

// BRouter – free, key-less public routing server. Routing runs from the
// user's browser. https://brouter.de/
const BROUTER = "https://brouter.de";

// Custom BRouter profile that strongly prefers small, winding back-roads and
// heavily penalises motorways / trunk / primary roads — i.e. a "curvy" car
// route for motorcycle touring. Uploaded once per session; BRouter returns a
// profile id we then route against.
const CURVY_PROFILE = `
---context:global
assign validForCars = 1
assign turnInstructionMode = 1

---context:way
assign turncost = 0
assign initialcost = 0

assign blocked = or highway= or access=private access=no

assign costfactor
  switch blocked                                   100000
  switch highway=motorway|motorway_link            9
  switch highway=trunk|trunk_link                  7
  switch highway=primary|primary_link              4
  switch highway=secondary|secondary_link          1.3
  switch highway=tertiary|tertiary_link            1.0
  switch highway=unclassified                      1.1
  switch highway=residential|living_street         1.6
  switch highway=service                           3
  switch highway=track|path|footway|cycleway|bridleway|steps|pedestrian   100000
  2.5

---context:node
assign initialcost = 0
`;

// Map a logical UI profile to a concrete BRouter profile name.
// "schnell" uses the stock motorway-friendly profile; "kurvig" uses our
// uploaded custom profile (falling back to car-eco if the upload fails).
let curvyIdPromise: Promise<string> | null = null;

async function getCurvyProfileId(signal?: AbortSignal): Promise<string> {
  if (!curvyIdPromise) {
    curvyIdPromise = (async () => {
      const res = await fetch(`${BROUTER}/brouter/profile`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: CURVY_PROFILE,
        signal,
      });
      if (!res.ok) throw new Error(`Profil-Upload fehlgeschlagen (HTTP ${res.status}).`);
      const data = (await res.json()) as { profileid?: string; error?: string };
      if (!data.profileid) throw new Error(data.error || "Kein Profil-Id erhalten.");
      return data.profileid;
    })();
    // Allow a retry on a later call if this upload fails.
    curvyIdPromise.catch(() => {
      curvyIdPromise = null;
    });
  }
  return curvyIdPromise;
}

async function resolveBrouterProfile(
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<string> {
  if (profile === "schnell") return "car-fast";
  try {
    return await getCurvyProfileId(signal);
  } catch {
    // Fallback so the app keeps working even if the upload is unavailable.
    return "car-eco";
  }
}

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
  const brouterProfile = await resolveBrouterProfile(profile, signal);

  const lonlats =
    `${from.lng.toFixed(6)},${from.lat.toFixed(6)}|` +
    `${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;

  const url =
    `${BROUTER}/brouter?lonlats=${lonlats}` +
    `&profile=${brouterProfile}&alternativeidx=0&format=geojson`;

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
  // Tag the leg with its logical profile (for colouring) and index (drag).
  feature.properties = { ...feature.properties, profile, legIndex };

  return {
    feature,
    distanceKm: Number(props["track-length"] ?? 0) / 1000,
    durationMin: Number(props["total-time"] ?? 0) / 60,
    profile,
  };
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
