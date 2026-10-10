import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RouteWeather } from "../lib/useRouteWeather";
import { fmtHhMm } from "../lib/schedule";
import { codeLabel } from "../lib/weather";
import { declutter, type Box } from "../lib/declutter";
import { fetchRadarFrames, nextFrame, RADAR_ATTRIBUTION, RADAR_MAX_ZOOM, type RadarFrame } from "../lib/radar";
import { pct } from "./WeatherStrip";
import Icon from "./Icon";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from "../config";
import { computeDays, dayNumbers } from "../lib/days";
import type { FocusPoint } from "../App";
import type { RouteResult, Waypoint } from "../types";
import { pointLabel } from "../lib/waypoints";

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
  // Context menu "Start hier": the point becomes the new first waypoint.
  onPrependWaypoint: (lng: number, lat: number) => void;
  // Context menu "Ziel hier": the point becomes the destination (opens a
  // round trip on purpose).
  onSetDestination: (lng: number, lat: number) => void;
  onMoveWaypoint: (id: string, lng: number, lat: number) => void;
  onInsertWaypoint: (legIndex: number, lng: number, lat: number) => void;
  // Pässeplaner: when non-null the map shows clickable pass dots and the normal
  // tap-to-add-waypoint behaviour is suppressed.
  passPoints?: PassPoint[] | null;
  // Weather along the route (null = hide, e.g. in the Pässeplaner).
  routeWx?: RouteWeather | null;
  passEndpoints?: { start: PassEndpoint; end: PassEndpoint | null } | null;
  onSetPassMark?: (key: string, mark: "need" | "nice" | null) => void;
  // While "Tour planen" sits in the sidebar (desktop) the map stays free to
  // look around, but taps, the context menu, line drags and marker drags must
  // not edit the route behind the form ("Tour erstellen" replaces it anyway).
  editLocked?: boolean;
  // While locked: clicks, the context menu and marker drags edit the form in
  // the sidebar instead (its points are passed in as `waypoints`).
  onPlanPick?: (lng: number, lat: number, target?: "start" | "via" | "end") => void;
  onPlanMove?: (id: string, lng: number, lat: number) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Current height of the bottom sheet (RoutePanel publishes it as --panel-h),
// so "fit into view" keeps the whole route visible above the sheet.
function panelHeight(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel-h"));
  return Number.isFinite(v) ? v : 0;
}

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
  onPrependWaypoint,
  onSetDestination,
  onMoveWaypoint,
  onInsertWaypoint,
  passPoints = null,
  passEndpoints = null,
  routeWx = null,
  onSetPassMark,
  editLocked = false,
  onPlanPick,
  onPlanMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(editLocked);
  lockedRef.current = editLocked;
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Suppress the map "click" (append) that follows a line-drag insert.
  const suppressClickRef = useRef(false);
  // True while the Pässeplaner pass layer is active (suppresses add-waypoint).
  const passModeRef = useRef(false);
  const fitPassCountRef = useRef(0);
  const endpointMarkersRef = useRef<maplibregl.Marker[]>([]);
  // Weather chips along the route; the toggle is remembered per device.
  const wxMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Rain radar (RainViewer): off by default – the loop costs mobile data.
  const [radarOn, setRadarOn] = useState(() => {
    try {
      return localStorage.getItem("mb.radar") === "1";
    } catch {
      return false;
    }
  });
  const toggleRadar = () =>
    setRadarOn((on) => {
      try {
        localStorage.setItem("mb.radar", on ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !on;
    });
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [radarIdx, setRadarIdx] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(true);
  const [radarError, setRadarError] = useState(false);
  const radarLayersRef = useRef<string[]>([]);
  const [wxOn, setWxOn] = useState(() => {
    try {
      return localStorage.getItem("mb.wxLayer") !== "0";
    } catch {
      return true;
    }
  });
  const toggleWx = () =>
    setWxOn((on) => {
      try {
        localStorage.setItem("mb.wxLayer", on ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !on;
    });
  const passMarkersRef = useRef<maplibregl.Marker[]>([]);
  const passPopupRef = useRef<maplibregl.Popup | null>(null);

  const addRef = useRef(onAddWaypoint);
  const prependRef = useRef(onPrependWaypoint);
  const destRef = useRef(onSetDestination);
  const moveRef = useRef(onMoveWaypoint);
  const insertRef = useRef(onInsertWaypoint);
  const setPassMarkRef = useRef(onSetPassMark);
  addRef.current = onAddWaypoint;
  prependRef.current = onPrependWaypoint;
  destRef.current = onSetDestination;
  moveRef.current = onMoveWaypoint;
  insertRef.current = onInsertWaypoint;
  setPassMarkRef.current = onSetPassMark;
  const planPickRef = useRef(onPlanPick);
  const planMoveRef = useRef(onPlanMove);
  planPickRef.current = onPlanPick;
  planMoveRef.current = onPlanMove;
  // Markers can be dragged unless the route is locked without a form to edit.
  const canDrag = () => !lockedRef.current || !!planMoveRef.current;

  // Right-click / long-press menu: "Start hier", "Zwischenziel hier", "Ziel hier".
  // Position in container pixels; null when closed.
  const [ctx, setCtx] = useState<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const ctxOpenRef = useRef(false);
  ctxOpenRef.current = ctx !== null;
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtx(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ctx]);

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

      // Pässeplaner pass dots are rendered as DOM markers (see effect below),
      // not as style layers — robust against any base-style expression issues.

      setupLineDrag(map);
      addPassLabels(map);
    });

    map.on("click", (e) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      // A click while the context menu is open only closes the menu.
      if (ctxOpenRef.current) {
        setCtx(null);
        return;
      }
      // In Pässeplaner mode the map is for picking passes, not adding stops.
      if (passModeRef.current) return;
      if (lockedRef.current) {
        planPickRef.current?.(e.lngLat.lng, e.lngLat.lat);
        return;
      }
      addRef.current(e.lngLat.lng, e.lngLat.lat);
    });

    map.on("contextmenu", (e) => {
      e.preventDefault();
      e.originalEvent.preventDefault();
      if (passModeRef.current || (lockedRef.current && !planPickRef.current)) return;
      setCtx({ x: e.point.x, y: e.point.y, lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    map.on("movestart", () => setCtx(null));

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
      if (lockedRef.current) return;
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
      // Hover tooltip with the place name (desktop); map-placed points show
      // their coordinates.
      el.title = pointLabel(wp);
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

      const marker = new maplibregl.Marker({ element: el, draggable: canDrag() })
        .setLngLat([wp.lng, wp.lat])
        .addTo(map);

      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        if (lockedRef.current) planMoveRef.current?.(wp.id, lng, lat);
        else moveRef.current(wp.id, lng, lat);
      });

      markersRef.current.push(marker);
    });
  }, [waypoints]);

  // Lock/unlock editing on the map (markers already on it + an open menu).
  useEffect(() => {
    for (const m of markersRef.current) m.setDraggable(canDrag());
    setCtx(null);
    // The current route fades while a new one is being put together.
    const map = mapRef.current;
    if (map && loadedRef.current && map.getLayer("route-line")) {
      map.setPaintProperty("route-line", "line-opacity", editLocked ? 0.35 : 1);
      map.setPaintProperty("route-casing", "line-opacity", editLocked ? 0.2 : 0.6);
    }
  }, [editLocked]);

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

  // --- Sync Pässeplaner pass dots (as DOM markers) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of passMarkersRef.current) m.remove();
    passMarkersRef.current = [];

    const pts = passPoints ?? [];
    passModeRef.current = pts.length > 0;
    if (pts.length === 0) {
      fitPassCountRef.current = 0;
      passPopupRef.current?.remove();
      return;
    }

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (!passPopupRef.current) {
      passPopupRef.current = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 16,
        className: "pass-popup",
      });
    }
    const popup = passPopupRef.current;

    const openPopup = (p: PassPoint) => {
      const h = p.height ? ` · ${p.height} m` : "";
      const cur = p.mark;
      popup
        .setLngLat([p.lng, p.lat])
        .setHTML(
          `<div class="pass-pop">
             <div class="pass-pop-name">${esc(p.name)}${h}</div>
             <div class="pass-pop-btns">
               <button type="button" data-mark="need" class="pp-btn pp-need${cur === "need" ? " on" : ""}" title="Muss dabei sein">Muss</button>
               <button type="button" data-mark="nice" class="pp-btn pp-nice${cur === "nice" ? " on" : ""}" title="Kann dabei sein, wenn es passt">Kann</button>
               ${cur !== "none" ? '<button type="button" data-mark="none" class="pp-btn pp-rm">Entfernen</button>' : ""}
             </div>
           </div>`,
        )
        .addTo(map);
      popup.getElement()
        ?.querySelectorAll<HTMLButtonElement>("button[data-mark]")
        .forEach((btn) => {
          btn.addEventListener("click", () => {
            const m = btn.dataset.mark;
            setPassMarkRef.current?.(p.key, m === "none" ? null : (m as "need" | "nice"));
            popup.remove();
          });
        });
    };

    for (const p of pts) {
      const el = document.createElement("div");
      el.className = `pass-marker pass-marker--${p.mark}`;
      el.title = p.name;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openPopup(p);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      passMarkersRef.current.push(marker);
    }

    // Fit to the passes only when they first appear (not on every mark).
    if (fitPassCountRef.current === 0) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend([p.lng, p.lat]));
      if (passEndpoints) {
        b.extend([passEndpoints.start.lng, passEndpoints.start.lat]);
        if (passEndpoints.end) b.extend([passEndpoints.end.lng, passEndpoints.end.lat]);
      }
      // Keep the passes clear of the floating selection bar at the top.
      const bar = document.querySelector(".pass-select")?.getBoundingClientRect();
      const top = bar ? Math.round(bar.bottom) + 24 : 120;
      map.fitBounds(b, {
        padding: { top, bottom: 40 + panelHeight(), left: 40, right: 40 },
        maxZoom: 11,
      });
    }
    fitPassCountRef.current = pts.length;
  }, [passPoints, passEndpoints]);

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

  // --- Weather along the route (DOM markers like the pass dots) ---
  useEffect(() => {
    const map = mapRef.current;
    wxMarkersRef.current.forEach((m) => m.remove());
    wxMarkersRef.current = [];
    if (!map || !routeWx || !wxOn) return;
    // When space is short: passes, then day ends, day starts, the 30-km
    // samples, and last the via points (their weather is in the list).
    const PRIORITY: Record<string, number> = { pass: 0, end: 1, start: 2, sample: 3, via: 4 };
    const prio: number[] = [];
    // Chips float above the point, clear of a waypoint marker (26 px) on it.
    const LIFT = 16;
    const emoji = (c: number) =>
      c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c === 45 || c === 48 ? "🌫️" :
      (c >= 71 && c <= 77) || c === 85 || c === 86 ? "❄️" : c >= 95 ? "⛈️" : "🌧️";
    routeWx.plans.forEach((plan, i) => {
      const state = routeWx.wx[i];
      if (state?.status !== "ok") return;
      plan.stations.forEach((st, k) => {
        const v = state.values[k];
        if (!v) return;
        const el = document.createElement("div");
        el.className = `wx-marker ${st.kind}`;
        el.textContent = `${emoji(v.code)} ${Math.round(v.temp)}°`;
        const where = st.name ?? (st.kind === "sample" ? `km ${Math.round(st.km)}` : "");
        const text =
          `Tag ${plan.day} · ${fmtHhMm(st.arriveMin)}${where ? " · " + where : ""}
` +
          `${codeLabel(v.code)} · ${Math.round(v.temp)}° · Regen ${pct(v.precipProb)}` +
          `${v.precip > 0 ? ` · ${v.precip.toFixed(1)} mm` : ""} · Wind ${Math.round(v.wind)} km/h`;
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -LIFT] })
          .setLngLat([st.lng, st.lat])
          .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false, className: "wx-popup" }).setText(text))
          .addTo(map);
        wxMarkersRef.current.push(marker);
        prio.push(PRIORITY[st.kind] ?? 3);
      });
    });

    // Show only the chips that fit without overlapping each other or the
    // numbered waypoint markers; zooming in brings more back.
    const layout = () => {
      const obstacles: Box[] = markersRef.current.map((m) => {
        const p = map.project(m.getLngLat());
        const el = m.getElement();
        const w = el.offsetWidth || 28;
        const h = el.offsetHeight || 28;
        return { x: p.x - w / 2, y: p.y - h / 2, w, h };
      });
      const items = wxMarkersRef.current.map((m, i) => {
        const p = map.project(m.getLngLat());
        const el = m.getElement();
        const w = el.offsetWidth || 56;
        const h = el.offsetHeight || 22;
        return { box: { x: p.x - w / 2, y: p.y - LIFT - h, w, h }, priority: prio[i] };
      });
      const vis = declutter(items, obstacles);
      wxMarkersRef.current.forEach((m, i) => {
        m.getElement().style.visibility = vis[i] ? "" : "hidden";
      });
    };
    layout();
    map.on("moveend", layout);
    map.on("resize", layout);
    return () => {
      map.off("moveend", layout);
      map.off("resize", layout);
    };
  }, [routeWx, wxOn]);

  // --- Rain radar: frame list, refreshed every 10 min while shown ---
  useEffect(() => {
    if (!radarOn) {
      setRadarFrames([]);
      setRadarError(false);
      return;
    }
    const ctrl = new AbortController();
    const load = () =>
      fetchRadarFrames(ctrl.signal)
        .then((f) => {
          setRadarError(false);
          setRadarFrames(f);
          setRadarIdx(f.length - 1); // start on the newest picture
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setRadarError(true);
        });
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => {
      clearInterval(t);
      ctrl.abort();
    };
  }, [radarOn]);

  // --- Rain radar: one raster layer per frame, below the route line ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const id of radarLayersRef.current) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      radarLayersRef.current = [];
      for (const f of radarFrames) {
        const id = `radar-${f.time}`;
        map.addSource(id, {
          type: "raster",
          tiles: [f.tiles],
          tileSize: 256,
          maxzoom: RADAR_MAX_ZOOM,
          attribution: RADAR_ATTRIBUTION,
        });
        map.addLayer(
          {
            id,
            type: "raster",
            source: id,
            paint: { "raster-opacity": 0, "raster-fade-duration": 0 },
          },
          map.getLayer("route-casing") ? "route-casing" : undefined,
        );
        radarLayersRef.current.push(id);
      }
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [radarFrames]);

  // --- Rain radar: show the current frame ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    radarLayersRef.current.forEach((id, i) => {
      if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", i === radarIdx ? 0.7 : 0);
    });
  }, [radarIdx, radarFrames]);

  // --- Rain radar: loop, holding the newest picture a little longer ---
  useEffect(() => {
    if (!radarPlaying || radarFrames.length < 2) return;
    const last = radarIdx === radarFrames.length - 1;
    const t = setTimeout(() => setRadarIdx((i) => nextFrame(i, radarFrames.length)), last ? 2000 : 600);
    return () => clearTimeout(t);
  }, [radarPlaying, radarIdx, radarFrames]);

  const radarTime = radarFrames[radarIdx]
    ? new Date(radarFrames[radarIdx].time * 1000).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
    : "";

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
      padding: { top: 110, bottom: 40 + panelHeight(), left: 50, right: 50 },
      maxZoom: 12,
    });
  }, [fitSignal]);

  // Keep the menu inside the map area even near the right/bottom edge.
  const menuLeft = ctx ? Math.min(ctx.x, (containerRef.current?.clientWidth ?? 9999) - 220) : 0;
  const menuTop = ctx ? Math.min(ctx.y, (containerRef.current?.clientHeight ?? 9999) - 160) : 0;
  const choose = (fn: (lng: number, lat: number) => void) => () => {
    if (ctx) fn(ctx.lng, ctx.lat);
    setCtx(null);
  };
  // With the form open the menu fills its fields instead of editing the route.
  const plan = (target: "start" | "via" | "end") => (lng: number, lat: number) =>
    planPickRef.current?.(lng, lat, target);
  const planning = editLocked && !!onPlanPick;
  const insertVia = (lng: number, lat: number) => {
    const n = waypointsRef.current.length;
    if (n >= 2) insertRef.current(n - 2, lng, lat);
    else addRef.current(lng, lat);
  };

  return (
    <div className="map-wrap">
      <div className="map" ref={containerRef} />
      <div className="map-toggles">
        {routeWx && routeWx.plans.length > 0 && (
          <button
            className={`map-wx-toggle ${wxOn ? "on" : ""}`}
            onClick={toggleWx}
            aria-pressed={wxOn}
            title={wxOn ? "Wetter auf der Karte ausblenden" : "Wetter auf der Karte einblenden"}
          >
            Wetter
          </button>
        )}
        <button
          className={`map-wx-toggle ${radarOn ? "on" : ""}`}
          onClick={toggleRadar}
          aria-pressed={radarOn}
          title={radarOn ? "Regenradar ausblenden" : "Regenradar der letzten 2 Stunden einblenden"}
        >
          Radar
        </button>
        {radarOn && radarError && <span className="map-radar-time">Radar gerade nicht verfügbar</span>}
        {radarOn && !radarError && radarTime && (
          <button
            className="map-radar-time"
            onClick={() => setRadarPlaying((p) => !p)}
            title={`Gemessener Regen der letzten 2 Stunden (unabhängig vom Tourdatum) – ${radarPlaying ? "anhalten" : "abspielen"}`}
          >
            {radarPlaying ? "⏸" : "▶"} Live {radarTime}
          </button>
        )}
      </div>
      {ctx && (
        <div className="map-ctx" role="menu" style={{ left: menuLeft, top: menuTop }}>
          <button role="menuitem" onClick={choose(planning ? plan("start") : (lng, lat) => prependRef.current(lng, lat))}>
            <Icon name="flag" size={16} /> Start hier
          </button>
          <button role="menuitem" onClick={choose(planning ? plan("via") : insertVia)}>
            <Icon name="plus" size={16} /> Zwischenziel hier
          </button>
          <button role="menuitem" onClick={choose(planning ? plan("end") : (lng, lat) => destRef.current(lng, lat))}>
            <Icon name="check" size={16} /> Ziel hier
          </button>
        </div>
      )}
    </div>
  );
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
