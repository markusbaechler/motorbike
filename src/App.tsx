import { useEffect, useRef, useState } from "react";
import MapView from "./components/MapView";
import RoutePanel from "./components/RoutePanel";
import { fetchRoute } from "./lib/routing";
import type { RouteProfile, RouteResult, Waypoint } from "./types";

let nextId = 1;
const makeId = () => `wp-${nextId++}`;

export default function App() {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  // Profile assigned to a newly added leg; per-leg overrides happen in the list.
  const [defaultProfile, setDefaultProfile] = useState<RouteProfile>("car-eco");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addWaypoint = (lng: number, lat: number) =>
    setWaypoints((wps) => [
      ...wps,
      { id: makeId(), lng, lat, legProfile: defaultProfile },
    ]);

  const moveWaypoint = (id: string, lng: number, lat: number) =>
    setWaypoints((wps) =>
      wps.map((w) => (w.id === id ? { ...w, lng, lat } : w)),
    );

  const removeWaypoint = (id: string) =>
    setWaypoints((wps) => wps.filter((w) => w.id !== id));

  const setLegProfile = (id: string, profile: RouteProfile) =>
    setWaypoints((wps) =>
      wps.map((w) => (w.id === id ? { ...w, legProfile: profile } : w)),
    );

  const clearAll = () => setWaypoints([]);

  // Recompute the route whenever the waypoints change (coords or per-leg
  // profile). A short debounce avoids hammering the server while dragging.
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
    }, 350);

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

      <MapView
        waypoints={waypoints}
        route={route}
        onAddWaypoint={addWaypoint}
        onMoveWaypoint={moveWaypoint}
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
        onClear={clearAll}
      />
    </div>
  );
}
