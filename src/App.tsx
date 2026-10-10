import { useEffect, useRef, useState } from "react";
import MapView, { type PassPoint } from "./components/MapView";
import PassPlannerModal, { type PassSession } from "./components/PassPlannerModal";
import PassSelectPanel from "./components/PassSelectPanel";
import {
  orderByNearestNeighbour,
  orderForLoop,
  type PassMark,
} from "./lib/passplanner";
import { optimizeLoop } from "./lib/passopt";
import RoutePanel from "./components/RoutePanel";
import RouteModal from "./components/RouteModal";
import NavRail, { type Section } from "./components/NavRail";
import DesktopWelcome from "./components/DesktopWelcome";
import QuickPlanModal, { planSlotId, type MapPick, type QuickStop } from "./components/QuickPlanModal";
import TourGeniusModal from "./components/TourGeniusModal";
import TourGeniusPreview from "./components/TourGeniusPreview";
import type { TourCandidate } from "./lib/tourgen";
import RoutesModal from "./components/RoutesModal";
import ClubToursModal from "./components/ClubToursModal";
import BookingPrefsModal from "./components/BookingPrefsModal";
import Home from "./components/Home";
import ShareModal from "./components/ShareModal";
import SearchBox from "./components/SearchBox";
import ConfirmDialog from "./components/ConfirmDialog";
import Icon from "./components/Icon";
import { readSharedRoute } from "./lib/share";
import { applyMigration, readMigrationFromHash, type MigrationResult } from "./lib/migrate";
import {
  getBookingPrefs,
  saveBookingPrefs,
  listRoutes,
  saveDraft,
  loadDraft,
  clearDraft,
  type BookingPrefs,
  type RouteDraft,
} from "./lib/storage";
import { addDays, buildBookingUrl } from "./lib/booking";
import { computeDays } from "./lib/days";
import { useRouteWeather } from "./lib/useRouteWeather";
import { fetchRoute, primeLegs } from "./lib/routing";
import { APP_NAME, CLUB_NAME, DEFAULT_CENTER, MOVED_TO } from "./config";
import { reverseGeocode, type GeoResult } from "./lib/geocoding";
import { DESKTOP_QUERY, useMediaQuery } from "./lib/useMediaQuery";
import {
  addDayEnd,
  appendWaypoint,
  closeLoop,
  insertWaypoint as insertWaypointAt,
  isClosedLoop,
  prependWaypoint as prependWaypointTo,
  reorderWaypoint as reorderWaypointIn,
  replaceEnd,
  reverseWaypoints,
} from "./lib/waypoints";
import type { RouteProfile, RouteResult, Waypoint } from "./types";

let nextId = 1;
const makeId = () => `wp-${nextId++}`;

// The "moved" card only makes sense while the new address is another origin:
// storage is per origin, so a same-origin move would have nothing to carry.
const movedTo: string | undefined = (() => {
  if (!MOVED_TO) return undefined;
  try {
    const t = new URL(MOVED_TO, window.location.href);
    return t.origin === window.location.origin ? undefined : t.href;
  } catch {
    return undefined;
  }
})();

// The club tours feed lives on the website; only the planner served from
// there can read it (same origin). The old address shows the moved card instead.
const clubToursEnabled = !movedTo;

function migrationText(r: MigrationResult): string {
  const parts: string[] = [];
  if (r.routesAdded > 0) parts.push(`${r.routesAdded} ${r.routesAdded === 1 ? "Tour" : "Touren"} übernommen`);
  if (r.routesSkipped > 0) parts.push(`${r.routesSkipped} schon vorhanden`);
  if (r.draftRestored) parts.push("letzte Tour wiederhergestellt");
  return parts.length ? `Umzug abgeschlossen: ${parts.join(", ")}.` : "Umzug abgeschlossen – nichts Neues zu übernehmen.";
}

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
  // Wide screens show "Tour planen" in the sidebar instead of a dialog over
  // the map. While it is open there, the search box (it would add points to
  // the route behind the form) is hidden and the map can't edit the route.
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const sidePlanner = desktop && showQuickPlan;
  // Sidebar planner <-> map: picks go into the form, its points come back.
  const [mapPick, setMapPick] = useState<MapPick | null>(null);
  const [planPoints, setPlanPoints] = useState<Waypoint[]>([]);
  const pickSeq = useRef(0);
  const onPlanPick = (lng: number, lat: number, target?: "start" | "via" | "end") =>
    setMapPick({ seq: ++pickSeq.current, lng, lat, target });
  const onPlanMove = (id: string, lng: number, lat: number) => {
    const slotId = planSlotId(id);
    if (slotId !== null) setMapPick({ seq: ++pickSeq.current, lng, lat, slotId });
  };
  const [showTourGenius, setShowTourGenius] = useState(false);
  // Tour-Genius map preview: candidates being previewed (round trips), the
  // currently shown one, and the waypoints to restore if the user discards.
  const [geniusCands, setGeniusCands] = useState<TourCandidate[] | null>(null);
  const [geniusIdx, setGeniusIdx] = useState(0);
  const geniusPrev = useRef<Waypoint[]>([]);
  const geniusProfile = useRef<RouteProfile>("kurvig");
  const [showRoutes, setShowRoutes] = useState(false);
  const [showClubTours, setShowClubTours] = useState(false);
  const [showBookingPrefs, setShowBookingPrefs] = useState(false);
  // Pässeplaner: input dialog + active pass-picking session.
  const [showPassPlanner, setShowPassPlanner] = useState(false);
  const [passSession, setPassSession] = useState<PassSession | null>(null);
  const [passMarks, setPassMarks] = useState<Record<string, PassMark>>({});
  const [passBusy, setPassBusy] = useState(false);
  // Inviting start screen, shown on launch.
  const [showHome, setShowHome] = useState(true);
  const [showShare, setShowShare] = useState(false);
  // Auto-saved route from the previous session. It is offered on the Home
  // screen ("Letzte Route fortsetzen") rather than loaded silently: opening
  // the app should start clean, not resurrect stray waypoints.
  const [draft, setDraft] = useState<RouteDraft | null>(() => loadDraft());
  const [confirmReset, setConfirmReset] = useState(false);
  // Outcome of a "#migrate=" import (tours carried over from the old address),
  // shown once as a toast.
  const [migration, setMigration] = useState<MigrationResult | null>(null);
  // Cancels a running Pässeplaner optimisation when the session is left.
  const passAbortRef = useRef<AbortController | null>(null);
  const [passProgress, setPassProgress] = useState<string | null>(null);

  // On first launch only a shared route (#r=…) opens directly. A migration
  // link (#migrate=…, from the old address) is merged into storage and lands on
  // the Home screen, where the imported tours are now listed.
  useEffect(() => {
    const mig = readMigrationFromHash();
    if (mig) {
      setMigration(applyMigration(mig));
      setDraft(loadDraft());
      history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }
    const shared = readSharedRoute();
    if (shared && shared.length >= 2) {
      setWaypoints(shared.map((w) => ({ ...w, id: makeId() })));
      setShowHome(false);
      setFitSignal((n) => n + 1);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  // Auto-save the current route as a draft on every change. The very first run
  // (empty map right after launch) must not touch storage, otherwise it would
  // wipe the draft we are offering to resume on the Home screen.
  const draftTouched = useRef(false);
  useEffect(() => {
    if (waypoints.length === 0 && !draftTouched.current) return;
    draftTouched.current = true;
    saveDraft(waypoints, defaultProfile);
  }, [waypoints, defaultProfile]);

  useEffect(() => {
    if (!migration) return;
    const t = window.setTimeout(() => setMigration(null), 12000);
    return () => window.clearTimeout(t);
  }, [migration]);

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
  // iPadOS 13+ Safari reports a desktop "Macintosh" user agent by default, so a
  // plain UA test misses the iPad. A touch-capable Mac is really an iPad.
  const isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  // Weather at the estimated passing time along the route (lib/schedule.ts).
  const routeWx = useRouteWeather(waypoints, route);

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

  // Search, map tap and "Punkt anhängen" all land here. On a round trip the
  // point goes in front of the closing copy of the start (see lib/waypoints).
  const addWaypoint = (lng: number, lat: number, name?: string) => {
    setPendingDay(false);
    setWaypoints((wps) => appendWaypoint(wps, { id: makeId(), lng, lat, name }, defaultProfile));
  };

  // "Ziel hier" from the map's context menu: the point becomes the
  // destination. On a round trip this replaces the closing copy, i.e. the
  // loop opens on purpose ("Rundtour" closes it again).
  const setDestination = (lng: number, lat: number) => {
    setPendingDay(false);
    setWaypoints((wps) => replaceEnd(wps, { id: makeId(), lng, lat }, defaultProfile));
  };

  // "Start hier" from the map's context menu: the point becomes the first
  // waypoint; the old start turns into a regular stop reached with the
  // default profile. A round trip stays closed (its end moves along).
  const prependWaypoint = (lng: number, lat: number) => {
    setPendingDay(false);
    setWaypoints((wps) => prependWaypointTo(wps, { id: makeId(), lng, lat }, defaultProfile));
  };

  // End the current day at the last real stop (overnight). On an open tour
  // the next point added then begins a new day (pendingDay). On a round trip
  // the new day "overnight → back to start" exists right away and every
  // point added lands in it, so no pending state is needed.
  const addDay = () => {
    if (waypoints.length < 2) return;
    const next = addDayEnd(waypoints);
    if (next !== waypoints) setWaypoints(next);
    if (!isClosedLoop(waypoints)) setPendingDay(true);
  };

  // Insert a shaping point into a specific leg (legIndex = index of the leg
  // being reshaped). The new point keeps that leg's profile.
  const insertWaypoint = (legIndex: number, lng: number, lat: number, name?: string) =>
    setWaypoints((wps) =>
      insertWaypointAt(wps, legIndex, { id: makeId(), lng, lat, name }, defaultProfile),
    );

  const moveWaypoint = (id: string, lng: number, lat: number) =>
    setWaypoints((wps) =>
      wps.map((w) => (w.id === id ? { ...w, lng, lat, name: w.nameEdited ? w.name : undefined } : w)),
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

  const setDayMeta = (id: string, patch: { dayName?: string; dayDate?: string; dayStart?: string }) =>
    setWaypoints((wps) => wps.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  // Only the place moves; leg profile and day flags stay with the list
  // position. The ends of a round trip are fixed.
  const reorderWaypoint = (id: string, direction: -1 | 1) =>
    setWaypoints((wps) => reorderWaypointIn(wps, id, direction));

  const clearAll = () => {
    setPendingDay(false);
    setWaypoints([]);
    setRoute(null);
    setError(null);
    clearDraft(); // hard reset: forget the saved draft too
    setDraft(null);
    setConfirmReset(false);
  };
  // Resetting throws the whole route away → ask first once there is one.
  const requestClear = () => (waypoints.length >= 2 ? setConfirmReset(true) : clearAll());

  // Leave the Home screen for another tool. On wide screens the logo (→ Home)
  // stays reachable while "Tour planen" is open in the sidebar, so starting
  // something else closes that form instead of leaving it next to the new
  // tool.
  const leaveHomeFor = () => {
    setShowHome(false);
    setShowQuickPlan(false);
  };

  // Desktop nav rail: which tool fills the sidebar ("tour" = route panel or
  // the "Tour planen" form). Choosing one closes whatever was open there.
  const section: Section = showTourGenius
    ? "genius"
    : showPassPlanner
      ? "passes"
      : showClubTours
        ? "club"
        : showRoutes
          ? "routes"
          : "tour";
  const selectSection = (s: Section) => {
    setShowQuickPlan(false);
    setShowTourGenius(s === "genius");
    setShowPassPlanner(s === "passes");
    setShowClubTours(s === "club");
    setShowRoutes(s === "routes");
  };
  // Something other than the route panel covers the sidebar (desktop).
  const sideOpen = desktop && (showQuickPlan || section !== "tour");
  const sideVariant = desktop ? ("sidebar" as const) : ("modal" as const);
  // The full start screen is for phones; desktop starts in the sidebar. Only
  // the old hosting keeps it on desktop too, for its "moved" notice.
  const homeVisible = showHome && (!desktop || !!movedTo);

  const resumeDraft = () => {
    if (!draft) return;
    setPendingDay(false);
    setDefaultProfile(draft.defaultProfile);
    setWaypoints(draft.waypoints.map((w) => ({ ...w, id: makeId() })));
    leaveHomeFor();
    setFitSignal((n) => n + 1);
  };

  // Reverse the route direction (also flips per-leg profiles correctly and
  // drops day metadata, which doesn't map cleanly when reversed).
  const reverseRoute = () => {
    setPendingDay(false);
    setWaypoints((wps) => reverseWaypoints(wps));
    setFitSignal((nn) => nn + 1);
  };

  // Close the route into a loop by appending the start as the final waypoint.
  const makeRoundTrip = () => {
    setPendingDay(false);
    setWaypoints((wps) => closeLoop(wps, makeId(), defaultProfile));
    setFitSignal((nn) => nn + 1);
  };

  const onSearchSelect = (r: GeoResult) => {
    addWaypoint(r.lng, r.lat, r.name);
    setFocus({ lng: r.lng, lat: r.lat, key: Date.now() });
  };

  // The top search ranks hits near the tour first: the last real stop (on a
  // round trip the one before the return), else the map's home area. Without
  // it "Monte Ceneri" also lists streets in Milan and Monza.
  const biasWp = waypoints[waypoints.length - (isClosedLoop(waypoints) ? 2 : 1)];
  const searchBias = biasWp
    ? { lat: biasWp.lat, lng: biasWp.lng }
    : { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] };

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
    // The Genius already routed this loop: hand its legs to the router's
    // cache, so showing it costs no request (right after the Genius burst a
    // new request would only run into the server's limit).
    if (cand.feature) primeLegs(cand.stops, cand.feature, profile);
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

  // Give points without a name (map taps, drags, Tour-Genius points once the
  // tour is kept) a real place name, one lookup at a time. Names only ever
  // fill a gap at the same spot, so an edit or a move meanwhile is never undone.
  const nameUnnamedPoints = async (list: Waypoint[]) => {
    for (const w of list) {
      if (w.name) continue;
      let name: string | null = null;
      try {
        name = await reverseGeocode(w.lat, w.lng);
      } catch {
        name = null;
      }
      if (!name) continue;
      setWaypoints((prev) =>
        prev.map((p) => (p.id === w.id && !p.name && p.lat === w.lat && p.lng === w.lng ? { ...p, name } : p)),
      );
    }
  };
  // Each point is looked up once per position (a move asks again).
  const namedKeys = useRef(new Set<string>());
  const nameKey = (w: Waypoint) => `${w.id}@${w.lat},${w.lng}`;
  useEffect(() => {
    // Previews (Tour-Genius) and the Pässeplaner don't keep their points yet.
    if (geniusCands || passSession) return;
    const todo = waypoints.filter((w) => !w.name && !namedKeys.current.has(nameKey(w)));
    if (todo.length === 0) return;
    todo.forEach((w) => namedKeys.current.add(nameKey(w)));
    void nameUnnamedPoints(todo);
  }, [waypoints, geniusCands, passSession]);

  // Name typed in the list. Empty brings the looked-up place name back.
  const renameWaypoint = (id: string, name: string) => {
    const w = waypoints.find((p) => p.id === id);
    if (w && !name) namedKeys.current.delete(nameKey(w));
    setWaypoints((wps) =>
      wps.map((p) => (p.id === id ? { ...p, name: name || undefined, nameEdited: !!name || undefined } : p)),
    );
  };

  const geniusAccept = () => {
    setGeniusCands(null); // keep the route as-is; its points get named above
  };

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
    // Also stops an optimisation that is still routing, so its result can't
    // land on the map after the rider backed out.
    passAbortRef.current?.abort();
    passAbortRef.current = null;
    setPassSession(null);
    setPassMarks({});
    setPassBusy(false);
    setPassProgress(null);
  };

  // Turn the marked passes into a normal route (start → passes → end/back).
  // With auto-fill on, a real router-scored optimiser (Tour-Genius principle)
  // strings the marked passes together and adds the scenic through-passes that
  // genuinely lie on the loop — every candidate judged by BRouter, not by
  // straight-line geometry — so it rides as many passes as possible while
  // minimising back-tracking (no eastward Oberalp-style spurs).
  const createPassRoute = async () => {
    if (!passSession || passBusy) return;
    setPassBusy(true);
    const { start, end } = passSession;
    const marked = passSession.passes.filter((p) => passMarks[p.key]);
    const startPt = { lat: start.lat, lng: start.lng, name: start.name };
    const endPt = end ? { lat: end.lat, lng: end.lng, name: end.name } : null;

    // Stops the route will run through. Default = the simple ordering (used when
    // auto-fill is off, there are no marked passes, or the router is unreachable).
    let stops: Array<{ name?: string; lat: number; lng: number }>;
    const orderedMarked = endPt
      ? orderByNearestNeighbour(startPt, marked)
      : orderForLoop(startPt, marked);
    const last = end ?? start;
    stops = [
      { name: start.name, lat: start.lat, lng: start.lng },
      ...orderedMarked.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
      { name: last.name, lat: last.lat, lng: last.lng },
    ];

    const ctrl = new AbortController();
    passAbortRef.current = ctrl;
    if (passSession.autoFill && marked.length > 0) {
      try {
        const opt = await optimizeLoop({
          start: startPt,
          end: endPt,
          marked,
          region: passSession.passes,
          profile: "kurvig_plus",
          signal: ctrl.signal,
          onProgress: (p) =>
            setPassProgress(`${p.label} ${Math.min(p.done + 1, p.total)}/${p.total} …`),
        });
        stops = opt.stops;
        // The optimiser already routed this tour: take its legs over instead
        // of asking the server again (see previewCandidate).
        primeLegs(opt.stops, opt.feature, "kurvig_plus");
      } catch (e) {
        if (ctrl.signal.aborted) return; // the rider cancelled the session
        // Router unreachable → fall back to the plain marked-only ordering.
        setError(
          `Pässe-Optimierer nicht erreichbar – einfache Reihenfolge verwendet. (${(e as Error).message})`,
        );
      }
    }
    if (ctrl.signal.aborted) return;
    passAbortRef.current = null;
    setPassProgress(null);

    setPendingDay(false);
    setWaypoints(
      stops.map((s) => ({
        id: makeId(),
        lng: s.lng,
        lat: s.lat,
        name: s.name,
        // Pässeplaner routes default to the twistiest style so the legs between
        // passes favour small scenic pass roads over the main valley axes.
        legProfile: "kurvig_plus",
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
  // Bumping routeAttempt re-runs the routing (manual "retry" after an error).
  const [routeAttempt, setRouteAttempt] = useState(0);
  const retryRoute = () => setRouteAttempt((n) => n + 1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Only positions and riding styles matter for routing. Names, day ends and
  // day labels change without a single new request.
  const routeKey = waypoints
    .map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)},${w.legProfile}`)
    .join("|");
  const waypointsRef = useRef(waypoints);
  waypointsRef.current = waypoints;
  useEffect(() => {
    const waypoints = waypointsRef.current;
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
  }, [routeKey, routeAttempt]);

  return (
    // pass-mode: on wide screens the sidebar is gone, so the map takes the
    // full width and the floating bars centre over it (see styles.css).
    <div className={`app ${passSession ? "pass-mode" : ""}`}>
      {/* The Pässeplaner is a dedicated mode: its own floating bar replaces the
          title bar, the search box and the route panel, so the whole map stays
          free for picking passes. */}
      {desktop && !passSession && (
        <NavRail
          active={section}
          onSelect={selectSection}
          clubTours={clubToursEnabled}
          canInstall={!!installEvt && !isStandalone}
          onInstall={doInstall}
        />
      )}

      {!passSession && !desktop && (
        <header className="topbar">
          <button
            className="topbar-home"
            onClick={() => setShowHome(true)}
            aria-label="Startseite des Routenplaners"
          >
            <img src="./logo.png" alt="" />
            <h1 className="topbar-brand">
              <span className="brand">{CLUB_NAME}</span>
              <span className="tag">{APP_NAME}</span>
            </h1>
          </button>
        </header>
      )}

      {!passSession && !sideOpen && <SearchBox onSelect={onSearchSelect} bias={searchBias} />}

      <MapView
        // The Pässeplaner is a dedicated mode (the SearchBox is hidden too):
        // don't clutter it with the normal route's waypoints/line, which may
        // include a restored draft from an earlier session.
        waypoints={passSession ? [] : sidePlanner ? planPoints : waypoints}
        route={passSession ? null : route}
        routeWx={passSession || sidePlanner ? null : routeWx}
        focus={focus}
        fitSignal={fitSignal}
        onAddWaypoint={addWaypoint}
        onPrependWaypoint={prependWaypoint}
        onSetDestination={setDestination}
        onMoveWaypoint={moveWaypoint}
        onInsertWaypoint={insertWaypoint}
        passPoints={passPoints}
        passEndpoints={passEndpoints}
        onSetPassMark={setPassMark}
        editLocked={sidePlanner}
        onPlanPick={sidePlanner ? onPlanPick : undefined}
        onPlanMove={sidePlanner ? onPlanMove : undefined}
      />

      {!passSession && (
      <RoutePanel
        waypoints={waypoints}
        defaultProfile={defaultProfile}
        route={route}
        loading={loading}
        error={error}
        onRetryRoute={retryRoute}
        onReverse={reverseRoute}
        onRoundTrip={makeRoundTrip}
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
        routeWx={routeWx}
        onAddDay={addDay}
        onRemoveWaypoint={removeWaypoint}
        onRenameWaypoint={renameWaypoint}
        onReorderWaypoint={reorderWaypoint}
        onInsertWaypoint={insertWaypoint}
        onAppendWaypoint={addWaypoint}
        onClear={requestClear}
        welcome={
          desktop ? (
            <DesktopWelcome
              draft={
                draft
                  ? { points: draft.waypoints.length, days: computeDays(draft.waypoints).length }
                  : null
              }
              onResume={resumeDraft}
              onPlan={() => setShowQuickPlan(true)}
              clubTours={
                clubToursEnabled
                  ? { onLoad: loadRoute, onShowAll: () => selectSection("club") }
                  : undefined
              }
            />
          ) : undefined
        }
      />
      )}

      {showDetails && route && (
        <RouteModal
          waypoints={waypoints}
          route={route}
          routeWx={routeWx}
          onClose={() => setShowDetails(false)}
        />
      )}

      {showRoutes && (
        <RoutesModal
          currentWaypoints={waypoints}
          onLoad={loadRoute}
          onClubTours={
            clubToursEnabled
              ? () => {
                  setShowRoutes(false);
                  setShowClubTours(true);
                }
              : undefined
          }
          onClose={() => setShowRoutes(false)}
          variant={sideVariant}
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
          variant={sideVariant}
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
          mapPick={desktop ? mapPick : null}
          onPointsChange={setPlanPoints}
        />
      )}

      {showTourGenius && (
        <TourGeniusModal
          onResults={onGeniusResults}
          onClose={() => setShowTourGenius(false)}
          variant={sideVariant}
        />
      )}

      {showPassPlanner && (
        <PassPlannerModal
          onReady={startPassSession}
          onClose={() => setShowPassPlanner(false)}
          variant={sideVariant}
        />
      )}

      {passSession && (
        <PassSelectPanel
          total={passSession.passes.length}
          needCount={passNeedCount}
          niceCount={passNiceCount}
          busy={passBusy}
          progress={passProgress}
          onCreate={createPassRoute}
          onCancel={cancelPassSession}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Tour zurücksetzen?"
          confirmLabel="Zurücksetzen"
          danger
          onConfirm={clearAll}
          onCancel={() => setConfirmReset(false)}
        >
          Alle {waypoints.length} Punkte und die Tagesaufteilung werden gelöscht. Unter „Meine
          Touren“ gespeicherte Touren bleiben erhalten.
        </ConfirmDialog>
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
        <ShareModal
          waypoints={waypoints}
          stats={route ? { distanceKm: route.distanceKm, durationMin: route.durationMin } : undefined}
          onClose={() => setShowShare(false)}
        />
      )}

      {showClubTours && (
        <ClubToursModal
          currentWaypoints={waypoints}
          onLoad={loadRoute}
          onClose={() => setShowClubTours(false)}
          variant={sideVariant}
        />
      )}

      {homeVisible && (
        <Home
          savedCount={listRoutes().length}
          canInstall={!!installEvt && !isStandalone}
          iosInstall={isIos && !isStandalone && !installEvt}
          draft={
            draft && waypoints.length === 0
              ? { points: draft.waypoints.length, days: computeDays(draft.waypoints).length }
              : null
          }
          hasRoute={waypoints.length > 0}
          movedTo={movedTo}
          onResume={resumeDraft}
          onBack={() => setShowHome(false)}
          onInstall={doInstall}
          onPlan={() => {
            setShowHome(false);
            setShowQuickPlan(true);
          }}
          onGenius={() => {
            leaveHomeFor();
            setShowTourGenius(true);
          }}
          onPasses={() => {
            leaveHomeFor();
            setShowPassPlanner(true);
          }}
          onRoutes={() => {
            leaveHomeFor();
            setShowRoutes(true);
          }}
          onClubTours={
            clubToursEnabled
              ? () => {
                  leaveHomeFor();
                  setShowClubTours(true);
                }
              : undefined
          }
        />
      )}

      {migration && (
        <div className={`toast ${homeVisible ? "on-home" : ""}`} role="status">
          <span>{migrationText(migration)}</span>
          <button className="toast-close" onClick={() => setMigration(null)} aria-label="Schliessen">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
