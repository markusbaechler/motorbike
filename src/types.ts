// Shared domain types for route planning.

// Logical routing modes shown in the UI. Each maps to a concrete BRouter
// profile in lib/routing.ts.
//   kurvig      -> scenic back-roads, reliable & contiguous (car-eco)
//   kurvig_plus -> maximally twisty (moped), can detour in the high Alps
//   schnell     -> motorway-friendly, direct (car-fast)
export type RouteProfile = "kurvig" | "kurvig_plus" | "schnell";

export interface Waypoint {
  id: string;
  lng: number;
  lat: number;
  // Place name: from the search, looked up for map-placed points, or typed
  // by the rider (then nameEdited is set and the name stays when it moves).
  name?: string;
  nameEdited?: boolean;
  // Profile used for the leg arriving at this waypoint (from the previous
  // one). Ignored for the first waypoint, which has no incoming leg.
  legProfile: RouteProfile;
  // Marks this waypoint as the end of a day (overnight stop). The next day
  // starts here. The final waypoint always ends the last day implicitly.
  dayEnd?: boolean;
  // Optional label + date for the day that ENDS at this waypoint (i.e. set on
  // each day's destination waypoint).
  dayName?: string;
  dayDate?: string; // ISO yyyy-mm-dd
  // Start time of the day that ENDS at this waypoint ("HH:MM"). Unset = default
  // (today: now, else 09:00 – see lib/schedule.ts).
  dayStart?: string;
}

export interface LegSummary {
  profile: RouteProfile;
  distanceKm: number;
  durationMin: number;
}

export interface RouteResult {
  geojson: GeoJSON.FeatureCollection;
  distanceKm: number;
  durationMin: number;
  legs: LegSummary[];
}
