// Central place for the free, key-less services the app relies on.
// Swapping any of these (e.g. to a self-hosted instance) happens here.

// OpenFreeMap – free vector tiles, no API key, no usage limit.
// https://openfreemap.org/
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Default map view: centre of the Alps – prime motorcycle territory.
export const DEFAULT_CENTER: [number, number] = [9.0, 46.8];
export const DEFAULT_ZOOM = 7;
