// Core domain types for the Pässeplaner (mountain-pass planner).

/** A mountain pass as imported from the Passliste Europa spreadsheet. */
export interface Pass {
  /** Stable id derived from the moto-pass.eu URL slug. */
  id: string;
  /** Full display name, may contain an alternative name in parentheses. */
  name: string;
  /** Cleaned-up query string used for geocoding (parentheticals removed). */
  query: string;
  /** Altitude in metres. */
  height: number;
  /** Road surface. */
  surface: Surface;
  /** Winter-closure estimate (free text, German). */
  winter: string;
  /** Source category (German). */
  category: string;
  /** Countries the pass belongs to (German names). */
  countries: string[];
  /** Source page on moto-pass.eu. */
  url: string;
}

export type Surface = "asphalt" | "unpaved";

/** How a pass is marked for inclusion in the route. */
export type MarkState = "none" | "need" | "nice";

/** Surface filter chosen by the user. */
export type SurfaceFilter = "asphalt" | "all";

export interface LngLat {
  lon: number;
  lat: number;
}

/** A geocoded pass: the static data plus resolved coordinates. */
export interface GeoPass extends Pass {
  lon: number;
  lat: number;
}

/** A resolved start/destination point in the planner form. */
export interface Endpoint {
  text: string;
  coord: LngLat | null;
  label: string | null;
}

/**
 * A user-saved plan. Holds only the inputs needed to reproduce a plan –
 * start/destination, the corridor settings and the pass markings. The pass
 * list and route geometry are derived on demand and therefore not stored.
 *
 * Kept deliberately serialisable and self-contained so the same shape can be
 * persisted locally today and synced to a cloud backend later (see M7).
 */
export interface SavedRoute {
  /** Stable id (uuid). */
  id: string;
  /** User-chosen name. */
  name: string;
  /** Last-modified timestamp (epoch ms) – used for sync conflict resolution. */
  updatedAt: number;
  start: Endpoint;
  roundTrip: boolean;
  dest: Endpoint;
  surface: SurfaceFilter;
  includeNeighbours: boolean;
  corridorKm: number;
  marks: Record<string, MarkState>;
}

/** Lightweight listing entry – enough to render the saved-routes list. */
export type SavedRouteMeta = Pick<SavedRoute, "id" | "name" | "updatedAt">;
