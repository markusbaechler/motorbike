import { useEffect, useRef, useState } from "react";
import MapView from "./components/MapView";
import RoutePanel from "./components/RoutePanel";
import RouteModal from "./components/RouteModal";
import QuickPlanModal, { type QuickStop } from "./components/QuickPlanModal";
import RoutesModal from "./components/RoutesModal";
import BookingPrefsModal from "./components/BookingPrefsModal";
import SearchBox from "./components/SearchBox";
import { getBookingPrefs, saveBookingPrefs, type BookingPrefs } from "./lib/storage";
import { addDays, buildBookingUrl } from "./lib/booking";
import { fetchPois, type Poi, type PoiCategory } from "./lib/pois";
import { haversine } from "./lib/geo";
import { fetchRoute } from "./lib/routing";
import type { GeoResult } from "./lib/geocoding";
import type { RouteProfile, RouteResult, Waypoint } from "./types";

let nextId = 1;
const makeId = () => `wp-${nextId++}`;

export interface FocusPoint {
  lng: number;
  lat: number;
  key: number;
}

export default function App() {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  // Profile assigned to a newly added leg; per-leg overrides happen in the list.
  const [defaultProfile, setDefaultProfile] = useState<RouteProfile>("kurvig");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusPoint | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showQuickPlan, setShowQuickPlan] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [showBookingPrefs, setShowBookingPrefs] = useState(false);
  const [bookingPrefs, setBookingPrefsState] = useState<BookingPrefs>(() => getBookingPrefs());

  const updateBookingPrefs = (p: BookingPrefs) => {
    saveBookingPrefs(p);
    setBookingPrefsState(p);
  };

  // --- Sehenswürdigkeiten / POIs ---
  const [poiCats, setPoiCats] = useState<PoiCategory[]>([]);
  const [pois, setPois] = useState<Poi[]>([]);
  const [poiLoading, setPoiLoading] = useState(false);
  const [poiError, setPoiError] = useState<string | null>(null);

  const togglePoiCat = (c: PoiCategory) =>
    setPoiCats((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  const poiDebounce = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!route || poiCats.length === 0) {
      setPois([]);
      setPoiError(null);
      setPoiLoading(false);
      return;
    }
    const coords: number[][] = [];
    for (const f of route.geojson.features) {
      if (f.geometry.type === "LineString") {
        for (const c of f.geometry.coordinates) coords.push(c);
      }
    }
    const controller = new AbortController();
    clearTimeout(poiDebounce.current);
    poiDebounce.current = setTimeout(async () => {
      setPoiLoading(true);
      setPoiError(null);
      try {
        setPois(await fetchPois(coords, poiCats, controller.signal));
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setPois([]);
          setPoiError((e as Error).message);
        }
      } finally {
        setPoiLoading(false);
      }
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(poiDebounce.current);
    };
  }, [route, poiCats]);

  // Add a POI as a stop, inserted into the nearest leg of the route.
  const addPoiStop = (poi: Poi) => {
    if (!route) return;
    let bestLeg = 0;
    let bestDist = Infinity;
    for (const f of route.geojson.features) {
      if (f.geometry.type !== "LineString") continue;
      const legIdx = (f.properties?.legIndex ?? 0) as number;
      for (const c of f.geometry.coordinates) {
        const d = haversine([poi.lng, poi.lat], c);
        if (d < bestDist) {
          bestDist = d;
          bestLeg = legIdx;
        }
      }
    }
    insertWaypoint(bestLeg, poi.lng, poi.lat, poi.name);
  };

  const openHotel = (place: string, checkin?: string) => {
    const checkout = checkin ? addDays(checkin, 1) : undefined;
    const url = buildBookingUrl(place, checkin, checkout, bookingPrefs);
    window.open(url, "_blank", "noopener");
  };
  // Bumped to ask the map to fit the whole route into view.
  const [fitSignal, setFitSignal] = useState(0);
  // True right after "+ Tag hinzufügen": the next added point starts a new day.
  const [pendingDay, setPendingDay] = useState(false);

  const addWaypoint = (lng: number, lat: number, name?: string) => {
    setPendingDay(false);
    setWaypoints((wps) => [
      ...wps,
      { id: makeId(), lng, lat, name, legProfile: defaultProfile },
    ]);
  };

  // End the current day at the last waypoint (overnight) so the next point
  // added begins a new day.
  const addDay = () =>
    setWaypoints((wps) => {
      if (wps.length < 2) return wps;
      setPendingDay(true);
      return wps.map((w, i) => (i === wps.length - 1 ? { ...w, dayEnd: true } : w));
    });

  // Insert a shaping point into a specific leg (legIndex = index of the leg
  // being reshaped). The new point keeps that leg's profile.
  const insertWaypoint = (legIndex: number, lng: number, lat: number, name?: string) =>
    setWaypoints((wps) => {
      const dest = wps[legIndex + 1];
      const newWp: Waypoint = {
        id: makeId(),
        lng,
        lat,
        name,
        legProfile: dest ? dest.legProfile : defaultProfile,
      };
      const copy = [...wps];
      copy.splice(legIndex + 1, 0, newWp);
      return copy;
    });

  const moveWaypoint = (id: string, lng: number, lat: number) =>
    setWaypoints((wps) =>
      wps.map((w) => (w.id === id ? { ...w, lng, lat, name: undefined } : w)),
    );

  const removeWaypoint = (id: string) =>
    setWaypoints((wps) => wps.filter((w) => w.id !== id));

  const setLegProfile = (id: string, profile: RouteProfile) =>
    setWaypoints((wps) =>
      wps.map((w) => (w.id === id ? { ...w, legProfile: profile } : w)),
    );

  const toggleDayEnd = (id: string) =>
    setWaypoints((wps) =>
      wps.map((w) => (w.id === id ? { ...w, dayEnd: !w.dayEnd } : w)),
    );

  const setDayMeta = (id: string, patch: { dayName?: string; dayDate?: string }) =>
    setWaypoints((wps) => wps.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const reorderWaypoint = (id: string, direction: -1 | 1) =>
    setWaypoints((wps) => {
      const i = wps.findIndex((w) => w.id === id);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= wps.length) return wps;
      const copy = [...wps];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const clearAll = () => {
    setPendingDay(false);
    setWaypoints([]);
  };

  const onSearchSelect = (r: GeoResult) => {
    addWaypoint(r.lng, r.lat, r.name);
    setFocus({ lng: r.lng, lat: r.lat, key: Date.now() });
  };

  // Build the whole route at once from the quick-plan dialog.
  const applyQuickPlan = (stops: QuickStop[]) => {
    setPendingDay(false);
    setWaypoints(
      stops.map((s) => ({
        id: makeId(),
        lng: s.lng,
        lat: s.lat,
        name: s.name,
        legProfile: s.legProfile,
        dayEnd: s.dayEnd,
      })),
    );
    setShowQuickPlan(false);
    setFitSignal((n) => n + 1);
  };

  // Load a saved/imported route (fresh ids to avoid collisions).
  const loadRoute = (saved: Waypoint[]) => {
    setPendingDay(false);
    setWaypoints(saved.map((w) => ({ ...w, id: makeId() })));
    setFitSignal((n) => n + 1);
  };

  // Recompute the route whenever the waypoints change (coords, order or
  // per-leg profile). A short debounce avoids hammering the server.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (waypoints.length < 2) {
      setRoute(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchRoute(waypoints, controller.signal);
        setRoute(result);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setRoute(null);
          setError((err as Error).message);
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(debounceRef.current);
    };
  }, [waypoints]);

  return (
    <div className="app">
      <header className="topbar">
        <img src="./icon.svg" alt="" />
        <h1>
          <span className="brand">Motorbike</span>{" "}
          <span className="tag">Routenplaner</span>
        </h1>
      </header>

      <SearchBox onSelect={onSearchSelect} />

      <MapView
        waypoints={waypoints}
        route={route}
        focus={focus}
        fitSignal={fitSignal}
        pois={pois}
        onAddWaypoint={addWaypoint}
        onMoveWaypoint={moveWaypoint}
        onInsertWaypoint={insertWaypoint}
        onAddPoiStop={addPoiStop}
      />

      <RoutePanel
        waypoints={waypoints}
        defaultProfile={defaultProfile}
        route={route}
        loading={loading}
        error={error}
        pendingDay={pendingDay}
        bookingPrefs={bookingPrefs}
        onOpenDetails={() => setShowDetails(true)}
        onOpenQuickPlan={() => setShowQuickPlan(true)}
        onOpenRoutes={() => setShowRoutes(true)}
        onOpenBookingPrefs={() => setShowBookingPrefs(true)}
        onOpenHotel={openHotel}
        poiCats={poiCats}
        poiLoading={poiLoading}
        poiError={poiError}
        poiCount={pois.length}
        onTogglePoiCat={togglePoiCat}
        onDefaultProfileChange={setDefaultProfile}
        onSetLegProfile={setLegProfile}
        onToggleDayEnd={toggleDayEnd}
        onSetDayMeta={setDayMeta}
        onAddDay={addDay}
        onRemoveWaypoint={removeWaypoint}
        onReorderWaypoint={reorderWaypoint}
        onClear={clearAll}
      />

      {showDetails && route && (
        <RouteModal
          waypoints={waypoints}
          route={route}
          onClose={() => setShowDetails(false)}
        />
      )}

      {showRoutes && (
        <RoutesModal
          currentWaypoints={waypoints}
          onLoad={loadRoute}
          onClose={() => setShowRoutes(false)}
        />
      )}

      {showBookingPrefs && (
        <BookingPrefsModal
          prefs={bookingPrefs}
          onSave={updateBookingPrefs}
          onClose={() => setShowBookingPrefs(false)}
        />
      )}

      {showQuickPlan && (
        <QuickPlanModal
          defaultProfile={defaultProfile}
          initialStops={
            waypoints.length >= 2
              ? waypoints.map((w) => ({
                  name: w.name,
                  lng: w.lng,
                  lat: w.lat,
                  legProfile: w.legProfile,
                  dayEnd: w.dayEnd,
                }))
              : undefined
          }
          onApply={applyQuickPlan}
          onClose={() => setShowQuickPlan(false)}
        />
      )}
    </div>
  );
}
