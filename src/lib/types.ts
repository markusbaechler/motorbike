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
