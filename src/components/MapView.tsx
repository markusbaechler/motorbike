import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from "../config";
import type { RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  route: RouteResult | null;
  onAddWaypoint: (lng: number, lat: number) => void;
  onMoveWaypoint: (id: string, lng: number, lat: number) => void;
}

const EMPTY_ROUTE: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// Colour a marker by its role: green = start, red = finish, blue = via.
function markerColor(index: number, total: number): string {
  if (index === 0) return "#22c55e";
  if (index === total - 1) return "#ef4444";
  return "#3b82f6";
}

export default function MapView({
  waypoints,
  route,
  onAddWaypoint,
  onMoveWaypoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // Keep latest callbacks without re-initialising the map.
  const addRef = useRef(onAddWaypoint);
  const moveRef = useRef(onMoveWaypoint);
  addRef.current = onAddWaypoint;
  moveRef.current = onMoveWaypoint;

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
      map.addSource("route", { type: "geojson", data: EMPTY_ROUTE });
      // Casing underneath for contrast, coloured line on top.
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#0f172a", "line-width": 8, "line-opacity": 0.6 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          // Colour each leg by its profile: curvy = orange, fast = blue.
          "line-color": [
            "match",
            ["get", "profile"],
            "car-fast",
            "#3b82f6",
            /* car-eco / default */ "#f97316",
          ],
          "line-width": 5,
        },
      });
      loadedRef.current = true;
    });

    map.on("click", (e) => {
      addRef.current(e.lngLat.lng, e.lngLat.lat);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

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
      if (!src) return;
      src.setData(route?.geojson ?? EMPTY_ROUTE);
    };

    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [route]);

  return <div className="map" ref={containerRef} />;
}
