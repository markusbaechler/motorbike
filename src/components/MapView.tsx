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
  height: number;
  mark: "none" | "need" | "nice";
}

export interface PassEndpoint {
  lat: number;
  lng: number;
  name: string;
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
  passEndpoints?: { start: PassEndpoint; end: PassEndpoint | null } | null;
  onSetPassMark?: (key: string, mark: "need" | "nice" | null) => void;
}

function passFeatures(points: PassPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      properties: {
        key: p.key,
        name: p.name,
        surface: p.surface,
        height: p.height,
        mark: p.mark,
      },
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
  passEndpoints = null,
  onSetPassMark,
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
  const endpointMarkersRef = useRef<maplibregl.Marker[]>([]);
  const passPopupRef = useRef<maplibregl.Popup | null>(null);

  const addRef = useRef(onAddWaypoint);
  const moveRef = useRef(onMoveWaypoint);
  const insertRef = useRef(onInsertWaypoint);
  const setPassMarkRef = useRef(onSetPassMark);
  addRef.current = onAddWaypoint;
  moveRef.current = onMoveWaypoint;
  insertRef.current = onInsertWaypoint;
  setPassMarkRef.current = onSetPassMark;

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
      // Mark the map ready immediately so data-sync effects never get stuck
      // waiting for a "load" that already fired (which left the pass layer empty).
      loadedRef.current = true;
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
          // Marked passes are clearly bigger so the selection is obvious.
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, ["case", ["==", ["get", "mark"], "none"], 5, 7],
            12, ["case", ["==", ["get", "mark"], "none"], 7, 11],
          ],
          "circle-color": [
            "match", ["get", "mark"],
            "need", "#fb5165",
            "nice", "#f59e0b",
            ["case", ["==", ["get", "surface"], "unpaved"], "#a78bfa", "#3aa0ff"],
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["==", ["get", "mark"], "none"], 1.5, 3],
        },
      });
      // Marked passes carry a name label.
      map.addLayer({
        id: "pass-sel-labels",
        type: "symbol",
        source: "passes",
        filter: ["!=", ["get", "mark"], "none"],
        layout: {
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-max-width": 12,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#100f12",
          "text-halo-width": 1.6,
        },
      });

      // Click a pass → popup with an explicit Need-to / Nice-to / Entfernen choice.
      const actionPopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 14,
        className: "pass-popup",
      });
      passPopupRef.current = actionPopup;
      const esc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const openActionPopup = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        suppressClickRef.current = true; // don't also add a waypoint
        const props = f.properties as {
          key: string; name: string; height?: number; mark: string;
        };
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        const h = props.height ? ` · ${props.height} m` : "";
        actionPopup
          .setLngLat(coords)
          .setHTML(
            `<div class="pass-pop">
               <div class="pass-pop-name">${esc(props.name)}${h}</div>
               <div class="pass-pop-btns">
                 <button type="button" data-mark="need" class="pp-btn pp-need${props.mark === "need" ? " on" : ""}">Need-to</button>
                 <button type="button" data-mark="nice" class="pp-btn pp-nice${props.mark === "nice" ? " on" : ""}">Nice-to</button>
                 ${props.mark !== "none" ? '<button type="button" data-mark="none" class="pp-btn pp-rm">Entfernen</button>' : ""}
               </div>
             </div>`,
          )
          .addTo(map);
        const el = actionPopup.getElement();
        el?.querySelectorAll<HTMLButtonElement>("button[data-mark]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const m = btn.dataset.mark;
            setPassMarkRef.current?.(props.key, m === "none" ? null : (m as "need" | "nice"));
            actionPopup.remove();
          });
        });
      };
      map.on("click", "pass-dots", openActionPopup);
      map.on("mouseenter", "pass-dots", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "pass-dots", () => { map.getCanvas().style.cursor = ""; });

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
        if (passEndpoints) {
          b.extend([passEndpoints.start.lng, passEndpoints.start.lat]);
          if (passEndpoints.end) b.extend([passEndpoints.end.lng, passEndpoints.end.lat]);
        }
        map.fitBounds(b, { padding: { top: 120, bottom: 160, left: 50, right: 50 }, maxZoom: 11 });
      }
      fitPassCountRef.current = pts.length;
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [passPoints]);

  // --- Pässeplaner start/end markers ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of endpointMarkersRef.current) m.remove();
    endpointMarkersRef.current = [];
    if (!passEndpoints) return;

    const make = (pt: PassEndpoint, color: string, glyph: string) => {
      const el = document.createElement("div");
      el.className = "wp-marker pass-endpoint";
      el.style.background = color;
      el.textContent = glyph;
      el.title = pt.name;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pt.lng, pt.lat])
        .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(pt.name))
        .addTo(map);
      endpointMarkersRef.current.push(marker);
    };
    make(passEndpoints.start, "#34d399", "S");
    if (passEndpoints.end) make(passEndpoints.end, "#fb7185", "Z");
  }, [passEndpoints]);

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
