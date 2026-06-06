import { useEffect, useRef, useState } from "react";
import MapView, { type PassPoint } from "./components/MapView";
import PassPlannerModal, { type PassSession } from "./components/PassPlannerModal";
import PassSelectPanel from "./components/PassSelectPanel";
import { orderByNearestNeighbour, type PassMark } from "./lib/passplanner";
import RoutePanel from "./components/RoutePanel";
import RouteModal from "./components/RouteModal";
import QuickPlanModal, { type QuickStop } from "./components/QuickPlanModal";
import TourGeniusModal from "./components/TourGeniusModal";
import TourGeniusPreview from "./components/TourGeniusPreview";
import type { TourCandidate } from "./lib/tourgen";
import RoutesModal from "./components/RoutesModal";
import BookingPrefsModal from "./components/BookingPrefsModal";
import Home from "./components/Home";
import ShareModal from "./components/ShareModal";
import SearchBox from "./components/SearchBox";
import { readSharedRoute } from "./lib/share";
import { getBookingPrefs, saveBookingPrefs, listRoutes, type BookingPrefs } from "./lib/storage";
import { addDays, buildBookingUrl } from "./lib/booking";
import { computeDays } from "./lib/days";
import { fetchWeather, type WeatherDay } from "./lib/weather";
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
  const [showTourGenius, setShowTourGenius] = useState(false);
  // Tour-Genius map preview: candidates being previewed (round trips), the
  // currently shown one, and the waypoints to restore if the user discards.
  const [geniusCands, setGeniusCands] = useState<TourCandidate[] | null>(null);
  const [geniusIdx, setGeniusIdx] = useState(0);
  const geniusPrev = useRef<Waypoint[]>([]);
  const geniusProfile = useRef<RouteProfile>("kurvig");
  const [showRoutes, setShowRoutes] = useState(false);
  const [showBookingPrefs, setShowBookingPrefs] = useState(false);
  // Pässeplaner: input dialog + active pass-picking session.
  const [showPassPlanner, setShowPassPlanner] = useState(false);
  const [passSession, setPassSession] = useState<PassSession | null>(null);
  const [passMarks, setPassMarks] = useState<Record<string, PassMark>>({});
  const [passBusy, setPassBusy] = useState(false);
  // Inviting start screen, shown on launch.
  const [showHome, setShowHome] = useState(true);
  const [showShare, setShowShare] = useState(false);

  // Load a route shared via URL hash (#r=…) on first launch.
  useEffect(() => {
    const shared = readSharedRoute();
    if (shared && shared.length >= 2) {
      setWaypoints(shared.map((w) => ({ ...w, id: makeId() })));
      setShowHome(false);
      setFitSignal((n) => n + 1);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PWA install handling (Android/Chrome native prompt; iOS shows a hint).
  type InstallPrompt = { prompt: () => void; userChoice: Promise<unknown> };
  const [installEvt, setInstallEvt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as unknown as InstallPrompt);
    };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  // Weather per day (overnight location + date) via Open-Meteo.
  const [weather, setWeather] = useState<Record<string, WeatherDay | null>>({});
  const weatherFetched = useRef<Set<string>>(new Set());
  useEffect(() => {
    const days = computeDays(waypoints);
    const targets: { wp: Waypoint; date: string }[] = [];
    for (const span of days) {
      const date = waypoints[span.endIdx]?.dayDate;
      if (!date) continue;
      const firstIdx = span.day === 1 ? span.startIdx : span.startIdx + 1;
      for (let i = firstIdx; i <= span.endIdx; i++) {
        targets.push({ wp: waypoints[i], date });
      }
    }
    const controller = new AbortController();
    (async () => {
      for (const { wp, date } of targets) {
        const key = `${wp.id}:${date}`;
        if (weatherFetched.current.has(key)) continue;
        weatherFetched.current.add(key);
        try {
          const r = await fetchWeather(wp.lat, wp.lng, date, controller.signal);
          setWeather((prev) => ({ ...prev, [key]: r }));
        } catch (e) {
          if ((e as Error).name !== "AbortError") {
            weatherFetched.current.delete(key);
          }
        }
      }
    })();
    return () => controller.abort();
  }, [waypoints]);

  const doInstall = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try {
      await installEvt.userChoice;
    } catch {
      /* ignore */
    }
    setInstallEvt(null);
  };
  const [bookingPrefs, setBookingPrefsState] = useState<BookingPrefs>(() => getBookingPrefs());

  const updateBookingPrefs = (p: BookingPrefs) => {
    saveBookingPrefs(p);
    setBookingPrefsState(p);
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
    setShowTourGenius(false);
    setFitSignal((n) => n + 1);
  };

  // Put a Tour-Genius candidate (a round trip) onto the map as the working
  // route so the user can see it before deciding.
  const previewCandidate = (cand: TourCandidate, profile: RouteProfile) => {
    setPendingDay(false);
    setWaypoints(
      cand.stops.map((s) => ({
        id: makeId(),
        lng: s.lng,
        lat: s.lat,
        name: s.name,
        legProfile: profile,
      })),
    );
    setFitSignal((n) => n + 1);
  };

  const onGeniusResults = (cands: TourCandidate[], profile: RouteProfile) => {
    geniusPrev.current = waypoints; // snapshot to restore on discard
    geniusProfile.current = profile;
    setGeniusCands(cands);
    setGeniusIdx(0);
    setShowTourGenius(false);
    previewCandidate(cands[0], profile);
  };

  const geniusNext = () => {
    if (!geniusCands) return;
    const next = (geniusIdx + 1) % geniusCands.length;
    setGeniusIdx(next);
    previewCandidate(geniusCands[next], geniusProfile.current);
  };

  const geniusAccept = () => setGeniusCands(null); // keep the route as-is

  const geniusDiscard = () => {
    setWaypoints(geniusPrev.current);
    setGeniusCands(null);
    setFitSignal((n) => n + 1);
  };

  // --- Pässeplaner ---
  const startPassSession = (session: PassSession) => {
    setPassSession(session);
    setPassMarks({});
    setShowPassPlanner(false);
  };

  const setPassMark = (key: string, mark: PassMark | null) =>
    setPassMarks((prev) => {
      const next: Record<string, PassMark> = { ...prev };
      if (mark) next[key] = mark;
      else delete next[key];
      return next;
    });

  // Pass dots handed to the map (data + current mark per pass).
  const passPoints: PassPoint[] | null = passSession
    ? passSession.passes.map((p) => ({
        key: p.key,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        surface: p.surface,
        height: p.height,
        mark: passMarks[p.key] ?? "none",
      }))
    : null;

  const passEndpoints = passSession
    ? {
        start: {
          lat: passSession.start.lat,
          lng: passSession.start.lng,
          name: passSession.start.name,
        },
        end: passSession.end
          ? {
              lat: passSession.end.lat,
              lng: passSession.end.lng,
              name: passSession.end.name,
            }
          : null,
      }
    : null;

  const passNeedCount = Object.values(passMarks).filter((m) => m === "need").length;
  const passNiceCount = Object.values(passMarks).filter((m) => m === "nice").length;

  const cancelPassSession = () => {
    setPassSession(null);
    setPassMarks({});
  };

  // Turn the marked passes into a normal route (start → passes → end/back).
  const createPassRoute = () => {
    if (!passSession) return;
    setPassBusy(true);
    const { start, end } = passSession;
    const picked = passSession.passes.filter((p) => passMarks[p.key]);
    const ordered = orderByNearestNeighbour({ lat: start.lat, lng: start.lng }, picked);
    const last = end ?? start; // round trip ends at the start
    const stops = [
      { name: start.name, lat: start.lat, lng: start.lng },
      ...ordered.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
      { name: last.name, lat: last.lat, lng: last.lng },
    ];
    setPendingDay(false);
    setWaypoints(
      stops.map((s) => ({
        id: makeId(),
        lng: s.lng,
        lat: s.lat,
        name: s.name,
        legProfile: defaultProfile,
      })),
    );
    cancelPassSession();
    setPassBusy(false);
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
        <button className="topbar-home" onClick={() => setShowHome(true)} aria-label="Startseite">
          <img src="./icon.svg" alt="" />
          <h1>
            <span className="brand">Motorbike</span>{" "}
            <span className="tag">Routenplaner</span>
          </h1>
        </button>
      </header>

      {!passSession && <SearchBox onSelect={onSearchSelect} />}

      <MapView
        waypoints={waypoints}
        route={route}
        focus={focus}
        fitSignal={fitSignal}
        onAddWaypoint={addWaypoint}
        onMoveWaypoint={moveWaypoint}
        onInsertWaypoint={insertWaypoint}
        passPoints={passPoints}
        passEndpoints={passEndpoints}
        onSetPassMark={setPassMark}
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
        onOpenShare={() => setShowShare(true)}
        onOpenQuickPlan={() => setShowQuickPlan(true)}
        onOpenTourGenius={() => setShowTourGenius(true)}
        onOpenPassPlanner={() => setShowPassPlanner(true)}
        onOpenRoutes={() => setShowRoutes(true)}
        onOpenBookingPrefs={() => setShowBookingPrefs(true)}
        onOpenHotel={openHotel}
        onDefaultProfileChange={setDefaultProfile}
        onSetLegProfile={setLegProfile}
        onToggleDayEnd={toggleDayEnd}
        onSetDayMeta={setDayMeta}
        weather={weather}
        onAddDay={addDay}
        onRemoveWaypoint={removeWaypoint}
        onReorderWaypoint={reorderWaypoint}
        onClear={clearAll}
      />

      {showDetails && route && (
        <RouteModal
          waypoints={waypoints}
          route={route}
          weather={weather}
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

      {showTourGenius && (
        <TourGeniusModal
          onResults={onGeniusResults}
          onClose={() => setShowTourGenius(false)}
        />
      )}

      {showPassPlanner && (
        <PassPlannerModal
          onReady={startPassSession}
          onClose={() => setShowPassPlanner(false)}
        />
      )}

      {passSession && (
        <PassSelectPanel
          total={passSession.passes.length}
          needCount={passNeedCount}
          niceCount={passNiceCount}
          busy={passBusy}
          onCreate={createPassRoute}
          onCancel={cancelPassSession}
        />
      )}

      {geniusCands && (
        <TourGeniusPreview
          candidates={geniusCands}
          idx={geniusIdx}
          onNext={geniusNext}
          onAccept={geniusAccept}
          onDiscard={geniusDiscard}
        />
      )}

      {showShare && waypoints.length >= 2 && (
        <ShareModal waypoints={waypoints} onClose={() => setShowShare(false)} />
      )}

      {showHome && (
        <Home
          savedCount={listRoutes().length}
          canInstall={!!installEvt && !isStandalone}
          iosInstall={isIos && !isStandalone && !installEvt}
          onInstall={doInstall}
          onPlan={() => {
            setShowHome(false);
            setShowQuickPlan(true);
          }}
          onGenius={() => {
            setShowHome(false);
            setShowTourGenius(true);
          }}
          onPasses={() => {
            setShowHome(false);
            setShowPassPlanner(true);
          }}
          onRoutes={() => {
            setShowHome(false);
            setShowRoutes(true);
          }}
          onMap={() => setShowHome(false)}
        />
      )}
    </div>
  );
}
