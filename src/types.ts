// Shared domain types for route planning.

// BRouter server-side profiles (free public instance, no API key).
// "car-eco" strongly prefers small, scenic back-roads (our "curvy" mode);
// "car-fast" uses motorways for quick connecting legs.
export type RouteProfile = "car-eco" | "car-fast";

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
