// Shared domain types for route planning.

// Logical routing modes shown in the UI. Each maps to a concrete BRouter
// profile in lib/routing.ts.
export type RouteProfile = "kurvig" | "schnell";

export interface Waypoint {
  id: string;
  lng: number;
  lat: number;
  // Optional place name from the search; map-placed points have none.
  name?: string;
  // Profile used for the leg arriving at this waypoint (from the previous
  // one). Ignored for the first waypoint, which has no incoming leg.
  legProfile: RouteProfile;
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
