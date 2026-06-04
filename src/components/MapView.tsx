import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from "../config";
import type { FocusPoint } from "../App";
import type { RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  route: RouteResult | null;
  focus: FocusPoint | null;
  fitSignal: number;
  onAddWaypoint: (lng: number, lat: number) => void;
  onMoveWaypoint: (id: string, lng: number, lat: number) => void;
  onInsertWaypoint: (legIndex: number, lng: number, lat: number) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function markerColor(index: number, total: number): string {
  if (index === 0) return "#22c55e";
  if (index === total - 1) return "#ef4444";
  return "#3b82f6";
}

export default function MapView({
  waypoints,
  route,
  focus,
  fitSignal,
  onAddWaypoint,
  onMoveWaypoint,
  onInsertWaypoint,
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
            "#3b82f6",
            /* kurvig / default */ "#f97316",
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

    waypoints.forEach((wp, index) => {
      const el = document.createElement("div");
      el.className = "wp-marker";
      el.style.background = markerColor(index, waypoints.length);
      el.textContent = String(index + 1);

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

  return <div className="map" ref={containerRef} />;
}
