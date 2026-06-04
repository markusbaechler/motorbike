// Shared domain types for route planning.

export interface Waypoint {
  id: string;
  lng: number;
  lat: number;
}

// BRouter server-side profiles (free public instance, no API key).
export type RouteProfile = "car-eco" | "car-fast";

export interface RouteResult {
  geojson: GeoJSON.FeatureCollection;
  distanceKm: number;
  durationMin: number;
}
