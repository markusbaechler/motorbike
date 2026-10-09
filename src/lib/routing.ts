import type { RouteProfile, RouteResult, Waypoint } from "../types";
import { reportThrottled, withSlot } from "./queue";
import { haversine, type Coord } from "./geo";

// BRouter – free, key-less public routing server. Routing runs from the
// user's browser. https://brouter.de/
const BROUTER = "https://brouter.de";

// Map each logical UI profile to one or more stock BRouter profiles, tried in
// order (fallback if the first is unavailable on the public server).
//   schnell -> "car-fast": motorway-friendly, direct.
// The "Fun" profiles additionally try a custom curvy profile first (uploaded
// once to the public server, see CURVY_PROFILE) that strongly prefers small,
// winding Landstrassen and avoids Haupt-/Schnellstrassen. If the upload or that
// route fails, we fall back to these stock profiles. No "moped": it may not
// use an Autostrasse and would send a motorcycle on absurd detours.
const BROUTER_PROFILES: Record<RouteProfile, string[]> = {
  kurvig: ["car-eco", "car-fast"],
  kurvig_plus: ["car-eco", "car-fast"],
  schnell: ["car-fast", "car-eco"],
};

// Custom BRouter profile (standard cost model). Started from the stock "moped"
// profile (full access + one-way handling) but with the cost weights inverted
// so the smallest roads are cheapest and big roads are expensive — i.e. it
// hunts out curvy tertiary/unclassified back-roads. Turn cost is lowered so it
// happily takes winding roads. Uploaded to the public server on first use.
//
// Access follows motorcycles, not mopeds: an Autostrasse (motorroad=yes) is
// allowed, and motorways are allowed at a cost of 20 – Fun routes stay off
// them unless the alternative is many times longer. The moped rules banned
// both, which sent Wolfgangpass → Klosters Dorf over Chur and Landquart
// (121.7 km instead of 9.8 km, the Klosters bypass is an Autostrasse).
export const CURVY_PROFILE = `
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
                                   switch or highway=motorway highway=motorway_link    1
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
              0
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
 switch or highway=motorway highway=motorway_link    20
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
// from distance using realistic average speeds per mode. Calibrated on club
// experience: a curvy 129 km after-work loop takes about 2 h 30 (≈ 52 km/h);
// the earlier values (42 / 36 / 82) were felt to be too pessimistic.
const AVG_SPEED_KMH: Record<RouteProfile, number> = {
  kurvig: 52,
  kurvig_plus: 45,
  schnell: 90,
};

interface Leg {
  feature: GeoJSON.Feature;
  distanceKm: number;
  durationMin: number;
  profile: RouteProfile;
}

// --- Network robustness -----------------------------------------------------
// The public BRouter server is free but shared: it is occasionally slow,
// briefly unavailable, and it throttles per IP (403 "Please, retry later!"
// from the proxy in front of it, sometimes 429). Every request therefore goes
// through the queue in lib/queue.ts (paced below the server's limit, shared
// pause after a 403), gets a timeout, and is retried with exponential backoff
// on timeouts, network errors and 5xx.
const REQUEST_TIMEOUT_MS = 20000;
const MAX_TRIES = 4;

const abortError = () => new DOMException("Aborted", "AbortError");
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, 700 * 2 ** attempt));

/** Throttled or down: worth waiting and retrying, never worth a fallback profile. */
export const isOverloaded = (status: number): boolean =>
  status === 403 || status === 429 || status >= 500;

export const overloadMessage = (status: number): string =>
  `Routing-Dienst ist gerade ausgelastet (HTTP ${status}). Kurz warten und erneut versuchen.`;

async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// A 403/429 means "this IP sent too much": the queue then pauses every
// request (see lib/queue.ts) and this one goes back in line. Three pauses
// (about 1.5 min) before giving up – enough for the measured ~30 s block.
const MAX_THROTTLE_WAITS = 3;

async function brouterFetch(url: string, signal?: AbortSignal): Promise<Response> {
  let lastErr: Error | null = null;
  let throttleWaits = 0;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      // The queue slot covers the request only, not the backoff sleep.
      const res = await withSlot(() => fetchWithTimeout(url, signal), signal);
      if ((res.status === 403 || res.status === 429) && throttleWaits < MAX_THROTTLE_WAITS) {
        throttleWaits++;
        reportThrottled();
        attempt--; // waiting out the server's limit is not a failed attempt
        continue;
      }
      if (res.status >= 500 && attempt < MAX_TRIES - 1) {
        lastErr = new Error(`HTTP ${res.status}`);
        await backoff(attempt);
        continue;
      }
      return res;
    } catch (e) {
      // The caller aborted (e.g. waypoints changed) → propagate, don't retry.
      if (signal?.aborted || (e as Error).name === "AbortError") throw abortError();
      // Otherwise it was our timeout or a network error → retry.
      lastErr = e as Error;
      if (attempt < MAX_TRIES - 1) {
        await backoff(attempt);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error("Routing fehlgeschlagen");
}

// --- Leg cache ---------------------------------------------------------------
// Every edit re-routes the whole tour, but only the legs next to the edited
// point actually change. Finished legs are kept by "lonlats|profile" and a leg
// that is being fetched is shared between callers, so dragging a point or a
// retry after an error costs one or two requests instead of ten.
interface CachedLeg {
  feature: GeoJSON.Feature;
  distanceKm: number;
  durationMin: number;
  profile: RouteProfile;
}

const LEG_CACHE_MAX = 400;
const legDone = new Map<string, CachedLeg>();

interface Inflight {
  promise: Promise<CachedLeg>;
  ctrl: AbortController;
  refs: number;
}
const legInflight = new Map<string, Inflight>();

function cachedLeg(
  key: string,
  factory: (signal: AbortSignal) => Promise<CachedLeg>,
  signal?: AbortSignal,
): Promise<CachedLeg> {
  const hit = legDone.get(key);
  if (hit) {
    // Refresh insertion order so the cache drops the least recently used leg.
    legDone.delete(key);
    legDone.set(key, hit);
    return Promise.resolve(hit);
  }
  let entry = legInflight.get(key);
  if (!entry) {
    const ctrl = new AbortController();
    const e: Inflight = { ctrl, refs: 0, promise: Promise.resolve() as unknown as Promise<CachedLeg> };
    e.promise = factory(ctrl.signal)
      .then((leg) => {
        legDone.set(key, leg);
        while (legDone.size > LEG_CACHE_MAX) legDone.delete(legDone.keys().next().value!);
        return leg;
      })
      .finally(() => {
        if (legInflight.get(key) === e) legInflight.delete(key);
      });
    legInflight.set(key, e);
    entry = e;
  }
  const shared = entry;
  shared.refs++;
  return new Promise<CachedLeg>((resolve, reject) => {
    // The request itself is only cancelled once every caller has let go.
    const onAbort = () => {
      shared.refs--;
      if (shared.refs <= 0) shared.ctrl.abort();
      reject(abortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    shared.promise.then(
      (leg) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(leg);
      },
      (err: unknown) => {
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/** Test hook: forget every cached leg. */
export function clearLegCache(): void {
  legDone.clear();
}

async function routeLeg(lonlats: string, profile: RouteProfile, signal: AbortSignal): Promise<CachedLeg> {
  let lastError = "unbekannter Fehler";

  const chain = await brouterProfileChain(profile);
  for (const brouterProfile of chain) {
    const url =
      `${BROUTER}/brouter?lonlats=${lonlats}` +
      `&profile=${brouterProfile}&alternativeidx=0&format=geojson`;

    let res: Response;
    try {
      res = await brouterFetch(url, signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      lastError = (e as Error).message;
      continue;
    }

    if (!res.ok) {
      // Throttled or down even after the retries: the fallback profile would
      // only be the next request into the same wall, and a stock profile
      // would silently replace the curvy route.
      if (isOverloaded(res.status)) throw new Error(overloadMessage(res.status));
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
    // Tag the leg with its logical profile (for colouring).
    feature.properties = { ...feature.properties, profile };

    const distanceKm = Number(props["track-length"] ?? 0) / 1000;
    return {
      feature,
      distanceKm,
      durationMin: (distanceKm / AVG_SPEED_KMH[profile]) * 60,
      profile,
    };
  }

  throw new Error(lastError);
}

async function fetchLeg(
  from: Waypoint,
  to: Waypoint,
  profile: RouteProfile,
  legIndex: number,
  signal?: AbortSignal,
): Promise<Leg> {
  const lonlats = legLonlats(from, to);
  let leg: CachedLeg;
  try {
    leg = await cachedLeg(`${lonlats}|${profile}`, (s) => routeLeg(lonlats, profile, s), signal);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Etappe ${legIndex + 1}: ${(e as Error).message}`);
  }
  // The cached feature is shared; the index (drag handling) is per position.
  return {
    ...leg,
    feature: { ...leg.feature, properties: { ...leg.feature.properties, legIndex } },
  };
}

// --- Taking over a route that was already computed --------------------------
// The Tour-Genius routes every candidate in ONE request through all stops.
// When the rider looks at a candidate, those legs are put into the leg cache,
// so the planner shows it without asking the server again – right after the
// Genius burst that request would only hit the server's 403.

type Pt = { lat: number; lng: number };

// Same key as fetchLeg uses.
const legLonlats = (from: Pt, to: Pt) =>
  `${from.lng.toFixed(6)},${from.lat.toFixed(6)}|${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;

/**
 * Index of the track point where each leg ends (first entry 0, last entry the
 * last point). A via stop is matched to the nearest track point; on a loop
 * that passes a stop twice the first pass wins.
 */
function splitIndices(coords: Coord[], stops: Pt[]): number[] {
  const out = [0];
  let from = 0;
  for (let k = 1; k < stops.length - 1; k++) {
    const p = [stops[k].lng, stops[k].lat];
    let dmin = Infinity;
    for (let j = from; j < coords.length; j++) dmin = Math.min(dmin, haversine(coords[j], p));
    let at = from;
    for (let j = from; j < coords.length; j++) {
      if (haversine(coords[j], p) <= dmin + 5) {
        at = j;
        break;
      }
    }
    out.push(at);
    from = at;
  }
  out.push(coords.length - 1);
  return out;
}

/** Split one routed line into one line per leg (shared point at each stop). */
export function splitAtStops(coords: Coord[], stops: Pt[]): Coord[][] {
  const b = splitIndices(coords, stops);
  return b.slice(1).map((end, i) => coords.slice(b[i], end + 1));
}

/**
 * Put the legs of an already routed multi-stop line into the leg cache, so
 * fetchRoute() serves them without a request. BRouter's per-segment table
 * ("messages": road type and length per segment) is split along, so the
 * route details stay right even after single legs are re-routed later.
 */
export function primeLegs(stops: Pt[], feature: GeoJSON.Feature, profile: RouteProfile): boolean {
  if (feature.geometry?.type !== "LineString" || stops.length < 2) return false;
  const coords = feature.geometry.coordinates;
  if (coords.length < 2) return false;
  const bounds = splitIndices(coords, stops);

  // Messages rows end at a track point (micro-degrees); hand each row to the
  // leg that contains that point.
  const msgs = (feature.properties as { messages?: string[][] } | null)?.messages;
  const rowsPerLeg: string[][][] = bounds.slice(1).map(() => []);
  if (Array.isArray(msgs) && msgs.length > 1) {
    const lonI = msgs[0].indexOf("Longitude");
    const latI = msgs[0].indexOf("Latitude");
    let j = 0;
    for (const row of msgs.slice(1)) {
      const lng = Number(row[lonI]) / 1e6;
      const lat = Number(row[latI]) / 1e6;
      let k = j;
      while (k < coords.length && (Math.abs(coords[k][0] - lng) > 2e-6 || Math.abs(coords[k][1] - lat) > 2e-6)) k++;
      if (k < coords.length) j = k;
      let leg = bounds.findIndex((end, i) => i > 0 && end >= j) - 1;
      if (leg < 0) leg = rowsPerLeg.length - 1;
      rowsPerLeg[leg].push(row);
    }
  }

  for (let i = 0; i + 1 < bounds.length; i++) {
    const part = coords.slice(bounds[i], bounds[i + 1] + 1);
    let m = 0;
    for (let j = 1; j < part.length; j++) m += haversine(part[j - 1], part[j]);
    const distanceKm = m / 1000;
    const properties: Record<string, unknown> = { profile, "track-length": String(Math.round(m)) };
    if (Array.isArray(msgs) && msgs.length > 1) properties.messages = [msgs[0], ...rowsPerLeg[i]];
    legDone.set(`${legLonlats(stops[i], stops[i + 1])}|${profile}`, {
      feature: { type: "Feature", properties, geometry: { type: "LineString", coordinates: part } },
      distanceKm,
      durationMin: (distanceKm / AVG_SPEED_KMH[profile]) * 60,
      profile,
    });
  }
  while (legDone.size > LEG_CACHE_MAX) legDone.delete(legDone.keys().next().value!);
  return true;
}

// --- Combined requests -------------------------------------------------------
// One request per leg made a 34-point tour cost 33 requests – minutes against
// a server that allows ~15 a minute. BRouter takes any number of points, and
// a combined request gives the same line as leg by leg (measured: 98.0 km both
// ways, 0.2 s instead of 10 requests). So consecutive legs that are not cached
// yet and share a riding style are routed together and split into legs.
const MAX_RUN_LEGS = 25;

const isLegKnown = (from: Pt, to: Pt, profile: RouteProfile) => {
  const key = `${legLonlats(from, to)}|${profile}`;
  return legDone.has(key) || legInflight.has(key);
};

/**
 * Route waypoints[start] … waypoints[end] (end exclusive in legs) in one
 * request with the riding style's first profile. Refused (4xx other than
 * throttling) → split in halves; single legs are left to fetchLeg, which has
 * the full fallback chain and the per-leg error message.
 */
async function routeRun(
  wps: Waypoint[],
  start: number,
  end: number,
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<void> {
  if (end - start < 2) return;
  const points = wps.slice(start, end + 1);
  const brouterProfile = (await brouterProfileChain(profile))[0];
  const lonlats = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join("|");
  let res: Response;
  try {
    res = await brouterFetch(
      `${BROUTER}/brouter?lonlats=${lonlats}&profile=${brouterProfile}&alternativeidx=0&format=geojson`,
      signal,
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return; // network trouble: fetchLeg tries again leg by leg
  }
  if (res.ok) {
    const feature = ((await res.json()) as GeoJSON.FeatureCollection).features?.[0];
    if (feature && primeLegs(points, feature, profile)) return;
  }
  if (isOverloaded(res.status)) return; // fetchLeg reports it per leg
  // e.g. "target island" for one bad point: keep the rest combined.
  const mid = start + Math.floor((end - start) / 2);
  await Promise.all([routeRun(wps, start, mid, profile, signal), routeRun(wps, mid, end, profile, signal)]);
}

/** Route every run of uncached legs with the same riding style together. */
async function routeRuns(wps: Waypoint[], signal?: AbortSignal): Promise<void> {
  const runs: Promise<void>[] = [];
  let i = 0;
  while (i < wps.length - 1) {
    const profile = wps[i + 1].legProfile;
    let j = i;
    while (
      j < wps.length - 1 &&
      j - i < MAX_RUN_LEGS &&
      wps[j + 1].legProfile === profile &&
      !isLegKnown(wps[j], wps[j + 1], profile)
    ) {
      j++;
    }
    if (j - i >= 2) runs.push(routeRun(wps, i, j, profile, signal));
    i = Math.max(j, i + 1);
  }
  await Promise.all(runs);
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
      res = await brouterFetch(url, signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      lastError = (e as Error).message;
      continue;
    }
    if (!res.ok) {
      if (isOverloaded(res.status)) throw new Error(overloadMessage(res.status));
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
 * own profile, then combining them. Legs are requested together (the queue
 * paces them) and every finished leg lands in the cache even when another
 * one fails, so a retry only fetches what is missing. Requires at least two
 * waypoints.
 */
export async function fetchRoute(
  waypoints: Waypoint[],
  signal?: AbortSignal,
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error("Mindestens zwei Wegpunkte nötig.");
  }

  // Combined requests first; whatever they could not deliver is then routed
  // leg by leg below (cache hits for everything they did deliver).
  await routeRuns(waypoints, signal);
  if (signal?.aborted) throw abortError();

  const legPromises: Promise<Leg>[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    legPromises.push(
      fetchLeg(waypoints[i - 1], waypoints[i], waypoints[i].legProfile, i - 1, signal),
    );
  }

  const settled = await Promise.allSettled(legPromises);
  if (signal?.aborted) throw abortError();
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
  const legs = settled.map((r) => (r as PromiseFulfilledResult<Leg>).value);

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
