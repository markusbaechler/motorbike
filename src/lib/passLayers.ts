import type maplibregl from "maplibre-gl";
import type { GeoPass, MarkState } from "./types";

// Source / layer ids shared between the planner component and these helpers.
export const SRC_PASSES = "passes";
export const SRC_ROUTE = "route";
export const LYR_PASS_DOTS = "pass-dots";
export const LYR_PASS_LABELS = "pass-labels";
export const LYR_ROUTE_LINE = "route-line";
export const LYR_ROUTE_CASING = "route-casing";

export function passesToGeoJSON(
  passes: GeoPass[],
  marks: Record<string, MarkState>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: passes.map((p) => ({
      type: "Feature",
      properties: {
        id: p.id,
        name: p.name,
        surface: p.surface,
        height: p.height,
        winter: p.winter,
        url: p.url,
        mark: marks[p.id] ?? "none",
      },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

// unmarked: purple for unpaved, blue for asphalt; marked: red / amber.
const COLOR_BY_STATE = [
  "match",
  ["get", "mark"],
  "need",
  "#ef4444",
  "nice",
  "#f59e0b",
  ["case", ["==", ["get", "surface"], "unpaved"], "#a78bfa", "#38bdf8"],
  // The style-spec expression types aren't exported from maplibre-gl, so we
  // assert the type at the single use site below.
] as unknown as never;

/** Add the (initially empty) planner sources and layers to the map. */
export function addPlannerLayers(map: maplibregl.Map): void {
  const empty: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  map.addSource(SRC_ROUTE, { type: "geojson", data: empty });
  map.addLayer({
    id: LYR_ROUTE_CASING,
    type: "line",
    source: SRC_ROUTE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#0c4a6e", "line-width": 8, "line-opacity": 0.9 },
  });
  map.addLayer({
    id: LYR_ROUTE_LINE,
    type: "line",
    source: SRC_ROUTE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#38bdf8", "line-width": 4 },
  });

  map.addSource(SRC_PASSES, { type: "geojson", data: empty });
  map.addLayer({
    id: LYR_PASS_DOTS,
    type: "circle",
    source: SRC_PASSES,
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        ["case", ["==", ["get", "mark"], "none"], 3, 5],
        11,
        ["case", ["==", ["get", "mark"], "none"], 5, 8],
      ],
      "circle-color": COLOR_BY_STATE,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": [
        "case",
        ["==", ["get", "mark"], "none"],
        1,
        2,
      ],
    },
  });
  map.addLayer({
    id: LYR_PASS_LABELS,
    type: "symbol",
    source: SRC_PASSES,
    // Only label marked passes to avoid clutter.
    filter: ["!=", ["get", "mark"], "none"],
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-max-width": 12,
    },
    paint: {
      "text-color": "#f8fafc",
      "text-halo-color": "#0f172a",
      "text-halo-width": 1.4,
    },
  });
}
