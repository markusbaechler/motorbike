import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from "../config";
import rawPasses from "../data/passes.json";
import rawCoords from "../data/pass-coords.json";
import type {
  Endpoint,
  GeoPass,
  LngLat,
  MarkState,
  Pass,
  SavedRoute,
  SavedRouteMeta,
  SurfaceFilter,
} from "../lib/types";
import { newRouteId, routeStore } from "../lib/routeStore";
import { withNeighbours } from "../lib/countries";
import {
  cachedCoord,
  geocodePass,
  geocodePlace,
  reverseCountry,
} from "../lib/geocode";
import {
  distanceToSegment,
  formatDuration,
  formatKm,
  haversine,
  orderByNearestNeighbour,
} from "../lib/geo";
import { routeThrough, type RouteResult } from "../lib/route";
import {
  addPlannerLayers,
  LYR_PASS_DOTS,
  passesToGeoJSON,
  SRC_PASSES,
  SRC_ROUTE,
} from "../lib/passLayers";

const PASSES = rawPasses as Pass[];

// Coordinates baked in at build time by scripts/geocode-passes.mjs:
// { "<pass-id>": [lon, lat] }. null = looked up but not resolvable.
const BAKED = rawCoords as unknown as Record<string, [number, number] | null>;

function bakedCoord(pass: Pass): LngLat | undefined {
  const c = BAKED[pass.id];
  return c ? { lon: c[0], lat: c[1] } : undefined;
}

const EMPTY_LINE: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [] },
};

export default function PassPlanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // --- form state ----------------------------------------------------------
  const [start, setStart] = useState<Endpoint>({
    text: "",
    coord: null,
    label: null,
  });
  const [roundTrip, setRoundTrip] = useState(true);
  const [dest, setDest] = useState<Endpoint>({
    text: "",
    coord: null,
    label: null,
  });
  const [surface, setSurface] = useState<SurfaceFilter>("asphalt");
  const [includeNeighbours, setIncludeNeighbours] = useState(true);
  const [corridorKm, setCorridorKm] = useState(60);

  // --- results -------------------------------------------------------------
  const [passes, setPasses] = useState<GeoPass[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkState>>({});
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeOrder, setRouteOrder] = useState<GeoPass[]>([]);

  // --- saved routes (M6) ---------------------------------------------------
  const [saved, setSaved] = useState<SavedRouteMeta[]>([]);
  const [routeName, setRouteName] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);

  // --- status --------------------------------------------------------------
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const loadToken = useRef(0);

  // Mirror state the imperative map click handler needs.
  const passesRef = useRef<GeoPass[]>([]);
  const marksRef = useRef<Record<string, MarkState>>({});
  passesRef.current = passes;
  marksRef.current = marks;

  const startMarker = useRef<maplibregl.Marker | null>(null);
  const destMarker = useRef<maplibregl.Marker | null>(null);

  // --- map setup -----------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "bottom-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      addPlannerLayers(map);
      map.on("click", LYR_PASS_DOTS, (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) cycleMark(id);
      });
      map.on("mouseenter", LYR_PASS_DOTS, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", LYR_PASS_DOTS, () => {
        map.getCanvas().style.cursor = "";
      });
      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the passes source in sync with state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(SRC_PASSES) as maplibregl.GeoJSONSource | undefined;
    src?.setData(passesToGeoJSON(passes, marks));
  }, [passes, marks, mapReady]);

  const cycleMark = useCallback((id: string) => {
    setMarks((prev) => {
      const cur = prev[id] ?? "none";
      const next: MarkState =
        cur === "none" ? "need" : cur === "need" ? "nice" : "none";
      const updated = { ...prev };
      if (next === "none") delete updated[id];
      else updated[id] = next;
      return updated;
    });
  }, []);

  const setMark = useCallback((id: string, value: MarkState) => {
    setMarks((prev) => {
      const updated = { ...prev };
      if (value === "none") delete updated[id];
      else updated[id] = value;
      return updated;
    });
  }, []);

  // --- step 1+2+3+4: geocode endpoints, then load passes -------------------
  const showPasses = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    if (!start.text.trim()) {
      setStatus("Bitte einen Startort eingeben.");
      return;
    }
    if (!roundTrip && !dest.text.trim()) {
      setStatus("Bitte einen Zielort eingeben (oder Rundtour wählen).");
      return;
    }

    const token = ++loadToken.current;
    setBusy(true);
    setRoute(null);
    setRouteOrder([]);
    (map.getSource(SRC_ROUTE) as maplibregl.GeoJSONSource)?.setData(EMPTY_LINE);

    try {
      setStatus("Start-/Zielort wird gesucht …");
      const startGeo = await geocodePlace(start.text);
      if (!startGeo) {
        setStatus(`Startort „${start.text}“ nicht gefunden.`);
        setBusy(false);
        return;
      }
      const startCoord: LngLat = { lat: startGeo.lat, lon: startGeo.lon };
      setStart((s) => ({ ...s, coord: startCoord, label: startGeo.label }));
      placeMarker(startMarker, startCoord, "#22c55e", map);

      let destCoord: LngLat = startCoord;
      if (!roundTrip) {
        const destGeo = await geocodePlace(dest.text);
        if (!destGeo) {
          setStatus(`Zielort „${dest.text}“ nicht gefunden.`);
          setBusy(false);
          return;
        }
        destCoord = { lat: destGeo.lat, lon: destGeo.lon };
        setDest((d) => ({ ...d, coord: destCoord, label: destGeo.label }));
        placeMarker(destMarker, destCoord, "#ef4444", map);
      } else {
        destMarker.current?.remove();
        destMarker.current = null;
        setDest((d) => ({ ...d, coord: null, label: null }));
      }

      // Frame the area of interest.
      const bounds = new maplibregl.LngLatBounds(
        [startCoord.lon, startCoord.lat],
        [startCoord.lon, startCoord.lat],
      );
      bounds.extend([destCoord.lon, destCoord.lat]);
      map.fitBounds(bounds, { padding: 120, maxZoom: 9, duration: 600 });

      // Determine the relevant countries from start/end.
      setStatus("Region wird bestimmt …");
      const countries = new Set<string>();
      for (const c of [startCoord, destCoord]) {
        const country = await reverseCountry(c);
        if (country) countries.add(country);
      }
      const relevant =
        countries.size === 0
          ? null
          : includeNeighbours
            ? withNeighbours(countries)
            : countries;

      // Candidate passes: surface + (country) + later corridor.
      const candidates = PASSES.filter((p) => {
        if (surface === "asphalt" && p.surface !== "asphalt") return false;
        if (relevant && !p.countries.some((c) => relevant.has(c))) return false;
        return true;
      });

      if (!candidates.length) {
        setStatus("Keine Pässe in dieser Region gefunden.");
        setBusy(false);
        return;
      }

      // Corridor test: within `corridorKm` of the start→end line (or, for a
      // round trip, within that radius of the start).
      const inCorridor = (c: LngLat) => {
        const m = corridorKm * 1000;
        return roundTrip
          ? haversine(startCoord, c) <= m
          : distanceToSegment(c, startCoord, destCoord) <= m;
      };

      // Resolve coordinates – baked-in first (instant, no network), then the
      // localStorage cache, finally a throttled Nominatim lookup as fallback.
      // Show passes that fall inside the corridor as they resolve.
      const found: GeoPass[] = [];
      setProgress({ done: 0, total: candidates.length });
      for (let i = 0; i < candidates.length; i++) {
        if (loadToken.current !== token) return; // a newer load superseded us
        const p = candidates[i];
        const coord =
          bakedCoord(p) ?? cachedCoord(p) ?? (await geocodePass(p));
        setProgress({ done: i + 1, total: candidates.length });
        if (coord && inCorridor(coord)) {
          const gp: GeoPass = { ...p, lon: coord.lon, lat: coord.lat };
          found.push(gp);
          setPasses([...found]);
        }
        setStatus(
          `Pässe werden geladen … ${i + 1}/${candidates.length} geprüft, ${found.length} im Korridor`,
        );
      }

      if (loadToken.current !== token) return;
      setStatus(
        found.length
          ? `${found.length} Pässe im Korridor. Klicke Pässe an: 1× = Need-to (rot), 2× = Nice-to (gelb).`
          : "Keine Pässe im gewählten Korridor. Korridorbreite erhöhen?",
      );
    } catch (err) {
      setStatus(`Fehler: ${(err as Error).message}`);
    } finally {
      if (loadToken.current === token) {
        setBusy(false);
        setProgress(null);
      }
    }
  }, [start, dest, roundTrip, surface, includeNeighbours, corridorKm]);

  // --- step: reset ---------------------------------------------------------
  const reset = useCallback(() => {
    loadToken.current++;
    setPasses([]);
    setMarks({});
    setRoute(null);
    setRouteOrder([]);
    setProgress(null);
    setStatus("");
    setBusy(false);
    startMarker.current?.remove();
    startMarker.current = null;
    destMarker.current?.remove();
    destMarker.current = null;
    const map = mapRef.current;
    (map?.getSource(SRC_ROUTE) as maplibregl.GeoJSONSource)?.setData(EMPTY_LINE);
  }, []);

  // --- step 5: plan the route ----------------------------------------------
  const selected = useMemo(
    () => passes.filter((p) => marks[p.id] && marks[p.id] !== "none"),
    [passes, marks],
  );

  const planRoute = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !start.coord) {
      setStatus("Bitte zuerst Pässe laden.");
      return;
    }
    if (!selected.length) {
      setStatus("Bitte mindestens einen Pass markieren.");
      return;
    }
    setBusy(true);
    setStatus("Route wird berechnet …");
    try {
      const ordered = orderByNearestNeighbour(start.coord, selected);
      const end = roundTrip ? start.coord : dest.coord ?? start.coord;
      const waypoints: LngLat[] = [
        start.coord,
        ...ordered.map((p) => ({ lon: p.lon, lat: p.lat })),
        end,
      ];
      const profile = surface === "all" ? "trekking" : "car-fast";
      const result = await routeThrough(waypoints, profile);
      setRoute(result);
      setRouteOrder(ordered);
      (map.getSource(SRC_ROUTE) as maplibregl.GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: result.geometry,
      });
      const b = new maplibregl.LngLatBounds();
      for (const [lon, lat] of result.geometry.coordinates)
        b.extend([lon, lat]);
      map.fitBounds(b, { padding: 80, duration: 700 });
      setStatus(
        `Route: ${formatKm(result.distance)} · ${formatDuration(result.time)} · ${ordered.length} Pässe`,
      );
    } catch (err) {
      setStatus(`Routing-Fehler: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [start.coord, dest.coord, roundTrip, selected, surface]);

  // --- saved routes: load list, save, load, delete -------------------------
  const refreshSaved = useCallback(async () => {
    setSaved(await routeStore.list());
  }, []);

  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  const saveCurrent = useCallback(async () => {
    const name = routeName.trim();
    if (!name) {
      setStatus("Bitte einen Namen für die Route eingeben.");
      return;
    }
    if (!start.text.trim()) {
      setStatus("Es gibt noch nichts zu speichern – zuerst eine Route planen.");
      return;
    }
    const id = currentId ?? newRouteId();
    const entry: SavedRoute = {
      id,
      name,
      updatedAt: Date.now(),
      start,
      roundTrip,
      dest,
      surface,
      includeNeighbours,
      corridorKm,
      marks,
    };
    await routeStore.save(entry);
    setCurrentId(id);
    await refreshSaved();
    setStatus(`Route „${name}“ gespeichert.`);
  }, [
    routeName,
    currentId,
    start,
    roundTrip,
    dest,
    surface,
    includeNeighbours,
    corridorKm,
    marks,
    refreshSaved,
  ]);

  const loadSaved = useCallback(
    async (id: string) => {
      const entry = await routeStore.load(id);
      if (!entry) {
        setStatus("Diese Route existiert nicht mehr.");
        await refreshSaved();
        return;
      }
      loadToken.current++; // cancel any in-flight pass loading
      setStart(entry.start);
      setRoundTrip(entry.roundTrip);
      setDest(entry.dest);
      setSurface(entry.surface);
      setIncludeNeighbours(entry.includeNeighbours);
      setCorridorKm(entry.corridorKm);
      setMarks(entry.marks);
      setRouteName(entry.name);
      setCurrentId(entry.id);
      // Reset derived state; the user re-runs "Pässe einblenden" to render.
      setPasses([]);
      setRoute(null);
      setRouteOrder([]);
      const map = mapRef.current;
      (map?.getSource(SRC_ROUTE) as maplibregl.GeoJSONSource)?.setData(
        EMPTY_LINE,
      );
      placeMarker(startMarker, entry.start.coord, "#22c55e", map);
      placeMarker(destMarker, entry.dest.coord, "#ef4444", map);
      if (entry.start.coord) {
        map?.flyTo({
          center: [entry.start.coord.lon, entry.start.coord.lat],
          zoom: 8,
        });
      }
      setStatus(
        `„${entry.name}“ geladen. „Pässe einblenden“, um die Karte zu füllen.`,
      );
    },
    [refreshSaved],
  );

  const deleteSaved = useCallback(
    async (id: string) => {
      await routeStore.remove(id);
      if (currentId === id) setCurrentId(null);
      await refreshSaved();
    },
    [currentId, refreshSaved],
  );

  const needCount = selected.filter((p) => marks[p.id] === "need").length;
  const niceCount = selected.filter((p) => marks[p.id] === "nice").length;

  return (
    <>
      <div className="map" ref={containerRef} />
      <Panel
        start={start}
        setStart={setStart}
        roundTrip={roundTrip}
        setRoundTrip={setRoundTrip}
        dest={dest}
        setDest={setDest}
        surface={surface}
        setSurface={setSurface}
        includeNeighbours={includeNeighbours}
        setIncludeNeighbours={setIncludeNeighbours}
        corridorKm={corridorKm}
        setCorridorKm={setCorridorKm}
        showPasses={showPasses}
        reset={reset}
        busy={busy}
        status={status}
        progress={progress}
        passes={passes}
        marks={marks}
        setMark={setMark}
        selected={selected}
        needCount={needCount}
        niceCount={niceCount}
        planRoute={planRoute}
        route={route}
        routeOrder={routeOrder}
        flyTo={(p) => mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: 12 })}
        saved={saved}
        routeName={routeName}
        setRouteName={setRouteName}
        currentId={currentId}
        saveCurrent={saveCurrent}
        loadSaved={loadSaved}
        deleteSaved={deleteSaved}
      />
    </>
  );
}

function placeMarker(
  ref: React.MutableRefObject<maplibregl.Marker | null>,
  coord: LngLat | null,
  color: string,
  map: maplibregl.Map | null,
) {
  if (!coord || !map) {
    ref.current?.remove();
    ref.current = null;
    return;
  }
  if (!ref.current) {
    ref.current = new maplibregl.Marker({ color }).addTo(map);
  }
  ref.current.setLngLat([coord.lon, coord.lat]);
}

// --- presentational panel ---------------------------------------------------

interface PanelProps {
  start: Endpoint;
  setStart: React.Dispatch<React.SetStateAction<Endpoint>>;
  roundTrip: boolean;
  setRoundTrip: (v: boolean) => void;
  dest: Endpoint;
  setDest: React.Dispatch<React.SetStateAction<Endpoint>>;
  surface: SurfaceFilter;
  setSurface: (v: SurfaceFilter) => void;
  includeNeighbours: boolean;
  setIncludeNeighbours: (v: boolean) => void;
  corridorKm: number;
  setCorridorKm: (v: number) => void;
  showPasses: () => void;
  reset: () => void;
  busy: boolean;
  status: string;
  progress: { done: number; total: number } | null;
  passes: GeoPass[];
  marks: Record<string, MarkState>;
  setMark: (id: string, v: MarkState) => void;
  selected: GeoPass[];
  needCount: number;
  niceCount: number;
  planRoute: () => void;
  route: RouteResult | null;
  routeOrder: GeoPass[];
  flyTo: (p: GeoPass) => void;
  saved: SavedRouteMeta[];
  routeName: string;
  setRouteName: (v: string) => void;
  currentId: string | null;
  saveCurrent: () => void;
  loadSaved: (id: string) => void;
  deleteSaved: (id: string) => void;
}

function Panel(props: PanelProps) {
  const [open, setOpen] = useState(true);
  const {
    start,
    setStart,
    roundTrip,
    setRoundTrip,
    dest,
    setDest,
    surface,
    setSurface,
    includeNeighbours,
    setIncludeNeighbours,
    corridorKm,
    setCorridorKm,
    showPasses,
    reset,
    busy,
    status,
    progress,
    passes,
    marks,
    setMark,
    selected,
    needCount,
    niceCount,
    planRoute,
    route,
    routeOrder,
    flyTo,
    saved,
    routeName,
    setRouteName,
    currentId,
    saveCurrent,
    loadSaved,
    deleteSaved,
  } = props;

  return (
    <div className={`planner ${open ? "" : "planner--collapsed"}`}>
      <button
        className="planner__toggle"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Einklappen" : "Ausklappen"}
      >
        {open ? "‹ Pässeplaner" : "›"}
      </button>

      {open && (
        <div className="planner__body">
          {/* Step 1 – Start */}
          <label className="field">
            <span>Startort</span>
            <input
              type="text"
              value={start.text}
              placeholder="z. B. Chur"
              onChange={(e) =>
                setStart((s) => ({ ...s, text: e.target.value }))
              }
            />
          </label>

          {/* Step 2 – Round trip */}
          <label className="check">
            <input
              type="checkbox"
              checked={roundTrip}
              onChange={(e) => setRoundTrip(e.target.checked)}
            />
            <span>Rundtour (zurück zum Start)</span>
          </label>

          {/* Step 3 – Destination */}
          {!roundTrip && (
            <label className="field">
              <span>Zielort</span>
              <input
                type="text"
                value={dest.text}
                placeholder="z. B. Bozen"
                onChange={(e) =>
                  setDest((d) => ({ ...d, text: e.target.value }))
                }
              />
            </label>
          )}

          {/* Step 4 – Surface */}
          <fieldset className="field">
            <span>Belag</span>
            <label className="radio">
              <input
                type="radio"
                name="surface"
                checked={surface === "asphalt"}
                onChange={() => setSurface("asphalt")}
              />
              Nur Asphalt
            </label>
            <label className="radio">
              <input
                type="radio"
                name="surface"
                checked={surface === "all"}
                onChange={() => setSurface("all")}
              />
              Inkl. Unbefestigt
            </label>
          </fieldset>

          <details className="advanced">
            <summary>Erweitert</summary>
            <label className="check">
              <input
                type="checkbox"
                checked={includeNeighbours}
                onChange={(e) => setIncludeNeighbours(e.target.checked)}
              />
              <span>Nachbarländer einbeziehen</span>
            </label>
            <label className="field">
              <span>Korridorbreite: {corridorKm} km</span>
              <input
                type="range"
                min={20}
                max={200}
                step={10}
                value={corridorKm}
                onChange={(e) => setCorridorKm(Number(e.target.value))}
              />
            </label>
          </details>

          <div className="actions">
            <button className="primary" onClick={showPasses} disabled={busy}>
              {busy ? "…" : "Pässe einblenden"}
            </button>
            <button onClick={reset} disabled={busy}>
              Zurücksetzen
            </button>
          </div>

          {/* Saved routes (M6) – local-first; cloud sync planned for M7. */}
          <div className="saved">
            <div className="saved__save">
              <input
                type="text"
                value={routeName}
                placeholder="Routenname"
                onChange={(e) => setRouteName(e.target.value)}
              />
              <button onClick={saveCurrent} title="Aktuelle Route speichern">
                {currentId ? "Aktualisieren" : "Speichern"}
              </button>
            </div>
            {saved.length > 0 && (
              <ul className="saved__list">
                {saved.map((r) => (
                  <li
                    key={r.id}
                    className={`saved__item ${
                      r.id === currentId ? "saved__item--active" : ""
                    }`}
                  >
                    <button
                      className="saved__name"
                      onClick={() => loadSaved(r.id)}
                      title="Route laden"
                    >
                      {r.name}
                    </button>
                    <button
                      className="saved__del"
                      onClick={() => deleteSaved(r.id)}
                      title="Route löschen"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {progress && (
            <div className="progress">
              <div
                className="progress__bar"
                style={{
                  width: `${(progress.done / progress.total) * 100}%`,
                }}
              />
            </div>
          )}
          {status && <p className="status">{status}</p>}

          {/* Step 5 – Marked passes + routing */}
          {passes.length > 0 && (
            <div className="passlist">
              <div className="passlist__head">
                <strong>{passes.length} Pässe</strong>
                <span className="legend">
                  <i className="dot dot--need" /> {needCount} need
                  <i className="dot dot--nice" /> {niceCount} nice
                </span>
              </div>
              <ul>
                {passes.map((p) => {
                  const m = marks[p.id] ?? "none";
                  return (
                    <li key={p.id} className={`passitem passitem--${m}`}>
                      <button
                        className="passitem__name"
                        onClick={() => flyTo(p)}
                        title="Auf Karte zeigen"
                      >
                        <span className="passitem__title">{p.name}</span>
                        <span className="passitem__meta">
                          {p.height} m ·{" "}
                          {p.surface === "unpaved" ? "unbefestigt" : "Asphalt"}
                        </span>
                      </button>
                      <div className="passitem__marks">
                        <button
                          className={m === "need" ? "on need" : "need"}
                          onClick={() =>
                            setMark(p.id, m === "need" ? "none" : "need")
                          }
                          title="Need-to"
                        >
                          ●
                        </button>
                        <button
                          className={m === "nice" ? "on nice" : "nice"}
                          onClick={() =>
                            setMark(p.id, m === "nice" ? "none" : "nice")
                          }
                          title="Nice-to"
                        >
                          ●
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <button
                className="primary"
                onClick={planRoute}
                disabled={busy || selected.length === 0}
              >
                Route planen ({selected.length})
              </button>
            </div>
          )}

          {/* Route result – waypoints labelled with passes */}
          {route && (
            <div className="routeresult">
              <strong>Wegpunkte</strong>
              <ol>
                <li className="wp wp--start">{start.label ?? "Start"}</li>
                {routeOrder.map((p) => (
                  <li key={p.id} className={`wp wp--${marks[p.id] ?? "none"}`}>
                    {p.name} <em>{p.height} m</em>
                  </li>
                ))}
                <li className="wp wp--end">
                  {roundTrip ? start.label ?? "Start" : dest.label ?? "Ziel"}
                </li>
              </ol>
              <p className="status">
                {formatKm(route.distance)} · {formatDuration(route.time)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
