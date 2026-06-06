import type { RouteProfile, RouteResult, Waypoint } from "../types";

// BRouter – free, key-less public routing server. Routing runs from the
// user's browser. https://brouter.de/
const BROUTER = "https://brouter.de";

// Map each logical UI profile to one or more stock BRouter profiles, tried in
// order (fallback if the first is unavailable on the public server).
//   schnell -> "car-fast": motorway-friendly, direct.
// The "Fun" profiles additionally try a custom curvy profile first (uploaded
// once to the public server, see CURVY_PROFILE) that strongly prefers small,
// winding Landstrassen and avoids Haupt-/Schnellstrassen. If the upload or that
// route fails, we fall back to these stock profiles.
const BROUTER_PROFILES: Record<RouteProfile, string[]> = {
  kurvig: ["car-eco", "car-fast"],
  kurvig_plus: ["moped", "car-eco"],
  schnell: ["car-fast", "car-eco"],
};

// Custom BRouter profile (standard cost model). Based on the stock "moped"
// profile (full access + one-way handling) but with the cost weights inverted
// so the smallest roads are cheapest and big roads are expensive — i.e. it
// hunts out curvy tertiary/unclassified back-roads. Turn cost is lowered so it
// happily takes winding roads. Uploaded to the public server on first use.
const CURVY_PROFILE = `
---context:global

assign downhillcost 0
assign downhillcutoff 0
assign uphillcost 0
assign uphillcutoff 0

assign   validForBikes       1
assign   validForCars        1

assign add_beeline          = false
assign turnInstructionMode  = 1

---context:way

assign turncost = if junction=roundabout then 0
                  else 30

assign initialclassifier =
     if route=ferry then 1
     else 0

assign initialcost switch route=ferry 20000 0

assign isresidentialorliving = or highway=residential|living_street living_street=yes

assign motorverhicleaccess
              switch motor_vehicle=
                     switch vehicle=
                            switch access=
                                   switch or highway=trunk highway=trunk_link          1
                                   switch or highway=primary highway=primary_link      1
                                   switch or highway=secondary highway=secondary_link  1
                                   switch or highway=tertiary highway=tertiary_link    1
                                   switch    highway=unclassified                      1
                                   switch    route=ferry                               1
                                   switch    isresidentialorliving                     1
                                   switch    highway=service                           1
                                   0
                                   or access=yes or access=designated access=destination
                            or vehicle=yes or vehicle=designated vehicle=destination
                     or motor_vehicle=yes or motor_vehicle=designated motor_vehicle=destination

assign caraccess
       switch motorcar=
              motorverhicleaccess
              or motorcar=yes or motorcar=designated motorcar=destination

assign motorcycleaccess
       switch motorcycle=
              motorverhicleaccess
              or motorcycle=yes or motorcycle=designated motorcycle=destination

assign accesspenalty
       switch or caraccess motorcycleaccess
              switch motorroad=yes 10000 0
              10000

assign onewaypenalty
       switch switch reversedirection=yes
                     switch oneway=
                            junction=roundabout
                            or oneway=yes or oneway=true oneway=1
                     oneway=-1
              10000
              0.0

assign ispaved or surface=paved or surface=asphalt or surface=concrete surface=paving_stones

assign islinktype = highway=motorway_link|trunk_link|primary_link|secondary_link|tertiary_link

assign costfactor
 add max onewaypenalty accesspenalty
 add switch islinktype 0.05 0
 switch and highway= not route=ferry  10000
 switch or highway=trunk highway=trunk_link          11
 switch or highway=primary highway=primary_link      4.5
 switch or highway=secondary highway=secondary_link  2.1
 switch or highway=tertiary highway=tertiary_link    1.0
 switch    highway=unclassified                      1.0
 switch    route=ferry                               5.67
 switch    highway=bridleway                         5
 switch    isresidentialorliving                     1.5
 switch    highway=service                           3.5
 switch or highway=track or highway=road highway=path
  switch tracktype=grade1 2.8
  switch ispaved 2.8
  28
 10000

assign dummyUsage = smoothness=

---context:node

assign motorvehicleaccess
              switch motor_vehicle=
                     switch vehicle=
                            switch access=
                                   switch barrier=gate 0
                                   switch barrier=bollard 0
                                   switch barrier=lift_gate 0
                                   switch barrier=cycle_barrier 0
                                   1
                                   or access=yes or access=designated access=destination
                            or vehicle=yes or vehicle=designated vehicle=destination
                     or motor_vehicle=yes or motor_vehicle=designated motor_vehicle=destination

assign caraccess
       switch motorcar=
              motorvehicleaccess
              or motorcar=yes or motorcar=designated motorcar=destination

assign motorcycleaccess
       switch motorcycle=
              motorvehicleaccess
              or motorcycle=yes or motorcycle=designated motorcycle=destination

assign initialcost
       switch or caraccess motorcycleaccess
              0
              1000000
`;

// Upload the curvy profile to the public server once; cache the promise so all
// legs share a single upload. Resolves to the server-assigned profile id, or
// null if the upload isn't available (then callers use stock profiles).
let curvyProfilePromise: Promise<string | null> | undefined;
function getCurvyProfileId(): Promise<string | null> {
  if (!curvyProfilePromise) {
    curvyProfilePromise = (async () => {
      try {
        const res = await fetch(`${BROUTER}/brouter/profile`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: CURVY_PROFILE,
        });
        if (!res.ok) return null;
        const j = (await res.json()) as { profileid?: string; error?: string };
        return j && j.profileid && !j.error ? j.profileid : null;
      } catch {
        return null;
      }
    })();
  }
  return curvyProfilePromise;
}

// The ordered list of BRouter profiles to try for a logical profile. The Fun
// profiles lead with the uploaded curvy profile when available.
async function brouterProfileChain(profile: RouteProfile): Promise<string[]> {
  const stock = BROUTER_PROFILES[profile];
  if (profile === "schnell") return stock;
  const curvy = await getCurvyProfileId();
  return curvy ? [curvy, ...stock] : stock;
}

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

  const chain = await brouterProfileChain(profile);
  for (const brouterProfile of chain) {
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
  const chain = await brouterProfileChain(profile);
  for (const brouterProfile of chain) {
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
