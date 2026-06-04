import { useEffect, useRef, useState } from "react";
import MapView from "./components/MapView";
import RoutePanel from "./components/RoutePanel";
import SearchBox from "./components/SearchBox";
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

  const addWaypoint = (lng: number, lat: number, name?: string) =>
    setWaypoints((wps) => [
      ...wps,
      { id: makeId(), lng, lat, name, legProfile: defaultProfile },
    ]);

  // Insert a shaping point into a specific leg (legIndex = index of the leg
  // being reshaped). The new point keeps that leg's profile.
  const insertWaypoint = (legIndex: number, lng: number, lat: number) =>
    setWaypoints((wps) => {
      const dest = wps[legIndex + 1];
      const newWp: Waypoint = {
        id: makeId(),
        lng,
        lat,
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

  const reorderWaypoint = (id: string, direction: -1 | 1) =>
    setWaypoints((wps) => {
      const i = wps.findIndex((w) => w.id === id);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= wps.length) return wps;
      const copy = [...wps];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const clearAll = () => setWaypoints([]);

  const onSearchSelect = (r: GeoResult) => {
    addWaypoint(r.lng, r.lat, r.name);
    setFocus({ lng: r.lng, lat: r.lat, key: Date.now() });
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
          Motorbike <span className="tag">Routenplaner</span>
        </h1>
      </header>

      <SearchBox onSelect={onSearchSelect} />

      <MapView
        waypoints={waypoints}
        route={route}
        focus={focus}
        onAddWaypoint={addWaypoint}
        onMoveWaypoint={moveWaypoint}
        onInsertWaypoint={insertWaypoint}
      />

      <RoutePanel
        waypoints={waypoints}
        defaultProfile={defaultProfile}
        route={route}
        loading={loading}
        error={error}
        onDefaultProfileChange={setDefaultProfile}
        onSetLegProfile={setLegProfile}
        onRemoveWaypoint={removeWaypoint}
        onReorderWaypoint={reorderWaypoint}
        onClear={clearAll}
      />
    </div>
  );
}
