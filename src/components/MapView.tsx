import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from "../config";
import { computeDays, dayNumbers } from "../lib/days";
import type { FocusPoint } from "../App";
import type { RouteResult, Waypoint } from "../types";

export interface PassPoint {
  key: string;
  name: string;
  lat: number;
  lng: number;
  surface: string;
  mark: "none" | "need" | "nice";
}

interface Props {
  waypoints: Waypoint[];
  route: RouteResult | null;
  focus: FocusPoint | null;
  fitSignal: number;
  onAddWaypoint: (lng: number, lat: number) => void;
  onMoveWaypoint: (id: string, lng: number, lat: number) => void;
  onInsertWaypoint: (legIndex: number, lng: number, lat: number) => void;
  // Pässeplaner: when non-null the map shows clickable pass dots and the normal
  // tap-to-add-waypoint behaviour is suppressed.
  passPoints?: PassPoint[] | null;
  onTogglePass?: (key: string) => void;
}

function passFeatures(points: PassPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      properties: { key: p.key, name: p.name, surface: p.surface, mark: p.mark },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function markerColor(index: number, total: number): string {
  if (index === 0) return "#34d399";
  if (index === total - 1) return "#fb7185";
  return "#38bdf8";
}

export default function MapView({
  waypoints,
  route,
  focus,
  fitSignal,
  onAddWaypoint,
  onMoveWaypoint,
  onInsertWaypoint,
  passPoints = null,
  onTogglePass,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Suppress the map "click" (append) that follows a line-drag insert.
  const suppressClickRef = useRef(false);
  // True while the Pässeplaner pass layer is active (suppresses add-waypoint).
  const passModeRef = useRef(false);
  const fitPassCountRef = useRef(0);

  const addRef = useRef(onAddWaypoint);
  const moveRef = useRef(onMoveWaypoint);
  const insertRef = useRef(onInsertWaypoint);
  const togglePassRef = useRef(onTogglePass);
  addRef.current = onAddWaypoint;
  moveRef.current = onMoveWaypoint;
  insertRef.current = onInsertWaypoint;
  togglePassRef.current = onTogglePass;

  const waypointsRef = useRef(waypoints);
  waypointsRef.current = waypoints;

  // --- Map initialisation (once) ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "bottom-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: EMPTY });
      map.addSource("drag", { type: "geojson", data: EMPTY });

      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#0f172a", "line-width": 9, "line-opacity": 0.6 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "profile"],
            "schnell",
            "#38bdf8",
            "kurvig_plus",
            "#f472b6",
            /* kurvig / default */ "#fb923c",
          ],
          "line-width": 5,
        },
      });
      // Preview dot shown while dragging the line to insert a point.
      map.addLayer({
        id: "drag-point",
        type: "circle",
        source: "drag",
        paint: {
          "circle-radius": 7,
          "circle-color": "#f8fafc",
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 2,
        },
      });

      // --- Pässeplaner pass dots (initially empty) ---
      map.addSource("passes", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "pass-dots",
        type: "circle",
        source: "passes",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            5, ["case", ["==", ["get", "mark"], "none"], 3.5, 5.5],
            11, ["case", ["==", ["get", "mark"], "none"], 5.5, 8.5],
          ],
          "circle-color": [
            "match", ["get", "mark"],
            "need", "#fb7185",
            "nice", "#f59e0b",
            ["case", ["==", ["get", "surface"], "unpaved"], "#a78bfa", "#38bdf8"],
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["==", ["get", "mark"], "none"], 1, 2],
        },
      });
      map.addLayer({
        id: "pass-sel-labels",
        type: "symbol",
        source: "passes",
        filter: ["!=", ["get", "mark"], "none"],
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-max-width": 12,
        },
        paint: {
          "text-color": "#f6f5f3",
          "text-halo-color": "#100f12",
          "text-halo-width": 1.4,
        },
      });
      map.on("click", "pass-dots", (e) => {
        const key = e.features?.[0]?.properties?.key as string | undefined;
        if (key) {
          suppressClickRef.current = true; // don't also add a waypoint
          togglePassRef.current?.(key);
        }
      });
      map.on("mouseenter", "pass-dots", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "pass-dots", () => { map.getCanvas().style.cursor = ""; });

      loadedRef.current = true;
      setupLineDrag(map);
      addPassLabels(map);
    });

    map.on("click", (e) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      // In Pässeplaner mode the map is for picking passes, not adding stops.
      if (passModeRef.current) return;
      addRef.current(e.lngLat.lng, e.lngLat.lat);
    });

    // Hover affordance over the route line.
    map.on("mouseenter", "route-line", () => {
      map.getCanvas().style.cursor = "grab";
    });
    map.on("mouseleave", "route-line", () => {
      map.getCanvas().style.cursor = "";
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Set up drag-to-insert: grab the route line and drop to insert a waypoint
  // into that leg. Works for both mouse and touch.
  function setupLineDrag(map: maplibregl.Map) {
    let legIndex: number | null = null;
    const dragSrc = () => map.getSource("drag") as maplibregl.GeoJSONSource;

    const onDown = (
      e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent,
    ) => {
      const idx = e.features?.[0]?.properties?.legIndex;
      if (idx === undefined || idx === null) return;
      e.preventDefault();
      legIndex = Number(idx);
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
    };

    const onMove = (
      e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent,
    ) => {
      if (legIndex === null) return;
      dragSrc().setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [e.lngLat.lng, e.lngLat.lat] },
          },
        ],
      });
    };

    const onUp = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (legIndex === null) return;
      const leg = legIndex;
      legIndex = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      dragSrc().setData(EMPTY);
      suppressClickRef.current = true;
      insertRef.current(leg, e.lngLat.lng, e.lngLat.lat);
    };

    map.on("mousedown", "route-line", onDown);
    map.on("touchstart", "route-line", onDown);
    map.on("mousemove", onMove);
    map.on("touchmove", onMove);
    map.on("mouseup", onUp);
    map.on("touchend", onUp);
  }

  // --- Sync markers with waypoints ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const days = computeDays(waypoints);
    const nums = dayNumbers(waypoints, days);

    waypoints.forEach((wp, index) => {
      const isLast = index === waypoints.length - 1;
      const isOvernight = !!wp.dayEnd && !isLast;

      const el = document.createElement("div");
      if (isOvernight) {
        // Highlight overnight stops with a bed marker (inline SVG, not emoji).
        el.className = "wp-marker bed";
        el.innerHTML =
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v12"/><path d="M21 19v-5a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3"/><path d="M3 14h18"/></svg>';
      } else {
        el.className = "wp-marker";
        el.style.background = markerColor(index, waypoints.length);
        el.textContent = String(nums[index]);
      }

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([wp.lng, wp.lat])
        .addTo(map);

      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        moveRef.current(wp.id, lng, lat);
      });

      markersRef.current.push(marker);
    });
  }, [waypoints]);

  // --- Sync route line ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
      src?.setData(route?.geojson ?? EMPTY);
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [route]);

  // --- Sync Pässeplaner pass dots ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("passes") as maplibregl.GeoJSONSource | undefined;
      const pts = passPoints ?? [];
      src?.setData(pts.length ? passFeatures(pts) : EMPTY);
      passModeRef.current = pts.length > 0;
      // Fit to the passes only when they first appear (not on every mark).
      if (pts.length > 0 && fitPassCountRef.current === 0) {
        const b = new maplibregl.LngLatBounds();
        pts.forEach((p) => b.extend([p.lng, p.lat]));
        map.fitBounds(b, { padding: { top: 110, bottom: 160, left: 50, right: 50 }, maxZoom: 11 });
      }
      fitPassCountRef.current = pts.length;
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [passPoints]);

  // --- Fly to a searched location ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 11) });
  }, [focus]);

  // --- Fit the whole route into view (e.g. after quick-plan) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitSignal === 0) return;
    const wps = waypointsRef.current;
    if (wps.length < 1) return;
    const bounds = new maplibregl.LngLatBounds();
    wps.forEach((w) => bounds.extend([w.lng, w.lat]));
    map.fitBounds(bounds, {
      padding: { top: 90, bottom: 320, left: 50, right: 50 },
      maxZoom: 12,
    });
  }, [fitSignal]);

  return <div className="map" ref={containerRef} />;
}

// Add a clearly-readable label layer for mountain passes / saddles on top of
// the base map. Best-effort: if the vector source/layer isn't present it simply
// renders nothing. Reuses a font that already exists in the style's glyphs.
function addPassLabels(map: maplibregl.Map) {
  try {
    if (map.getLayer("pass-labels")) return;
    const style = map.getStyle();
    const vectorSource = Object.keys(style.sources).find(
      (id) => (style.sources[id] as { type?: string }).type === "vector",
    );
    if (!vectorSource) return;

    const fontLayer = style.layers.find(
      (l) => l.type === "symbol" && l.layout && (l.layout as Record<string, unknown>)["text-font"],
    );
    const font = (fontLayer?.layout as Record<string, string[]> | undefined)?.["text-font"] ?? [
      "Noto Sans Regular",
    ];

    map.addLayer({
      id: "pass-labels",
      type: "symbol",
      source: vectorSource,
      "source-layer": "mountain_peak",
      filter: [
        "any",
        ["==", ["get", "class"], "pass"],
        ["==", ["get", "class"], "saddle"],
      ],
      minzoom: 8,
      layout: {
        "text-field": [
          "case",
          ["has", "ele"],
          ["concat", ["coalesce", ["get", "name:de"], ["get", "name"], ""], " · ", ["to-string", ["get", "ele"]], " m"],
          ["coalesce", ["get", "name:de"], ["get", "name"], ""],
        ],
        "text-font": font,
        "text-size": 13,
        "text-offset": [0, 0.6],
        "text-anchor": "top",
        "text-allow-overlap": false,
        "icon-image": "",
      },
      paint: {
        "text-color": "#7c2d12",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.6,
      },
    });
  } catch {
    /* base map lacks pass data – ignore */
  }
}
