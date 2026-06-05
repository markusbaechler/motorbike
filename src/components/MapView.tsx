import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from "../config";
import { computeDays, dayNumbers } from "../lib/days";
import type { FocusPoint } from "../App";
import type { Poi } from "../lib/pois";
import type { RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  route: RouteResult | null;
  focus: FocusPoint | null;
  fitSignal: number;
  pois: Poi[];
  onAddWaypoint: (lng: number, lat: number) => void;
  onMoveWaypoint: (id: string, lng: number, lat: number) => void;
  onInsertWaypoint: (legIndex: number, lng: number, lat: number) => void;
  onAddPoiStop: (poi: Poi) => void;
}

const POI_ICON: Record<string, string> = {
  natur:
    '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 20 6-10 4 6 3-4 5 8z"/></svg>',
  motorrad:
    '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17h6l4-7h3"/></svg>',
  gastro:
    '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v7a2 2 0 0 0 4 0V3M6 11v10M18 3c-1.7 0-3 2-3 5s1 4 3 4v9"/></svg>',
};

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
  pois,
  onAddWaypoint,
  onMoveWaypoint,
  onInsertWaypoint,
  onAddPoiStop,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Suppress the map "click" (append) that follows a line-drag insert.
  const suppressClickRef = useRef(false);

  const addRef = useRef(onAddWaypoint);
  const moveRef = useRef(onMoveWaypoint);
  const insertRef = useRef(onInsertWaypoint);
  addRef.current = onAddWaypoint;
  moveRef.current = onMoveWaypoint;
  insertRef.current = onInsertWaypoint;

  const waypointsRef = useRef(waypoints);
  waypointsRef.current = waypoints;

  const poiMarkersRef = useRef<maplibregl.Marker[]>([]);
  const addPoiStopRef = useRef(onAddPoiStop);
  addPoiStopRef.current = onAddPoiStop;

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

      loadedRef.current = true;
      setupLineDrag(map);
      addPassLabels(map);
    });

    map.on("click", (e) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
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

  // --- Sync POI markers ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of poiMarkersRef.current) m.remove();
    poiMarkersRef.current = [];

    for (const poi of pois) {
      const el = document.createElement("div");
      el.className = `poi-marker ${poi.category}`;
      el.innerHTML = POI_ICON[poi.category] ?? "";

      const content = document.createElement("div");
      content.className = "poi-popup";
      const title = document.createElement("strong");
      title.textContent = poi.name;
      const kind = document.createElement("span");
      kind.className = "poi-kind";
      kind.textContent = poi.kind;
      const btn = document.createElement("button");
      btn.className = "poi-add";
      btn.textContent = "Als Stopp hinzufügen";
      btn.addEventListener("click", () => {
        addPoiStopRef.current(poi);
        popup.remove();
      });
      content.append(title, kind, btn);

      const popup = new maplibregl.Popup({ offset: 16, closeButton: true }).setDOMContent(content);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([poi.lng, poi.lat])
        .setPopup(popup)
        .addTo(map);
      poiMarkersRef.current.push(marker);
    }
  }, [pois]);

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
