// Weather at the estimated passing time along the route: plans the timed
// stations (lib/schedule.ts) and fetches their hourly forecast (lib/weather.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import type { RouteResult, Waypoint } from "../types";
import type { KnownPass } from "./analysis";
import { ensureEuroPasses } from "./passplanner";
import { computeDays } from "./days";
import { dayDates, isoDate, planDays, type DayPlan, type Station } from "./schedule";
import { fetchDayWeather, FORECAST_DAYS, type HourWx } from "./weather";

export type DayWxState =
  | { status: "none" } // outside the forecast window
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; values: (HourWx | null)[] }; // parallel to plan.stations

export interface RouteWeather {
  plans: DayPlan[];
  wx: DayWxState[]; // parallel to plans
}

/** What the route was computed from: positions and riding styles only. */
export function routeKeyOf<T extends Pick<Waypoint, "lng" | "lat" | "legProfile">>(waypoints: T[]): string {
  return waypoints.map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)},${w.legProfile}`).join("|");
}

const inWindow = (p: DayPlan) => p.daysAhead >= 0 && p.daysAhead <= FORECAST_DAYS && p.stations.length > 0;
const sameStations = (a: DayPlan, b: DayPlan) =>
  a.date === b.date &&
  a.stations.length === b.stations.length &&
  a.stations.every((s, i) => {
    const t = b.stations[i];
    return s.lat === t.lat && s.lng === t.lng && s.arriveMin === t.arriveMin;
  });

/**
 * Initial weather state for new plans: a day whose stations did not change
 * (rename, day name, clock tick) keeps its values instead of flashing
 * "loading" and rebuilding every map chip.
 */
export function carryOver(prev: RouteWeather, plans: DayPlan[]): DayWxState[] {
  return plans.map((p, i) => {
    if (!inWindow(p)) return { status: "none" };
    const old = prev.plans[i];
    const st = prev.wx[i];
    if (old && st?.status === "ok" && sameStations(old, p)) return st;
    return { status: "loading" };
  });
}

const STABLE_MS = 1000;
const TICK_MS = 5 * 60_000; // "jetzt" as default start moves with the clock

/**
 * `pending`: the route on screen was computed for older waypoints (routing in
 * flight) – keep the last result instead of planning against the old track.
 */
export function useRouteWeather(
  waypoints: Waypoint[],
  route: RouteResult | null,
  pending = false,
): RouteWeather {
  // Named passes (same list as the Pässeplaner); without it no pass stations.
  const [passes, setPasses] = useState<KnownPass[] | undefined>();
  useEffect(() => {
    let alive = true;
    ensureEuroPasses()
      .then((l) => alive && setPasses(l))
      .catch(() => {
        /* offline: samples and waypoints only */
      });
    return () => {
      alive = false;
    };
  }, []);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // The clock only matters while a day of today starts at the default "now";
  // otherwise only the date counts, so the 5-minute tick changes nothing.
  const today = isoDate(now);
  const spans = computeDays(waypoints);
  const needsClock = dayDates(waypoints, spans, today).some(
    (d, i) => d.date === today && !waypoints[spans[i].endIdx]?.dayStart,
  );
  const clockKey = needsClock ? now.getTime() : today;

  const lastPlans = useRef<DayPlan[]>([]);
  const plans = useMemo(() => {
    if (!pending) {
      lastPlans.current = route && waypoints.length >= 2 ? planDays(waypoints, route, passes, now) : [];
    }
    return lastPlans.current;
    // `now` enters via clockKey; while pending the last plans stay.
  }, [waypoints, route, passes, clockKey, pending]);

  const [state, setState] = useState<RouteWeather>({ plans: [], wx: [] });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const initial = carryOver(stateRef.current, plans);
    setState({ plans, wx: initial });
    if (initial.every((s) => s.status !== "loading")) return;
    const ctrl = new AbortController();
    const setDay = (i: number, s: DayWxState) =>
      setState((prev) =>
        prev.plans === plans ? { plans, wx: prev.wx.map((x, j) => (j === i ? s : x)) } : prev,
      );
    // Wait until the route is stable (dragging, typing) before asking.
    const timer = setTimeout(async () => {
      for (let i = 0; i < plans.length; i++) {
        if (initial[i].status !== "loading") continue;
        try {
          const values = await fetchDayWeather(plans[i].stations, plans[i].date, ctrl.signal);
          if (ctrl.signal.aborted) return;
          setDay(i, { status: "ok", values });
        } catch (e) {
          if ((e as Error).name === "AbortError" || ctrl.signal.aborted) return;
          setDay(i, { status: "error" });
        }
      }
    }, STABLE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [plans]);

  // Same object as long as nothing changed (map chips depend on its identity);
  // in the render before the effect runs, show what carries over.
  return state.plans === plans ? state : { plans, wx: carryOver(state, plans) };
}

/** Weather at each waypoint (by id). A shared overnight point belongs to the day it ends. */
export function stationWx(
  rw: RouteWeather,
): Map<string, { st: Station; wx: HourWx | null; plan: DayPlan }> {
  const out = new Map<string, { st: Station; wx: HourWx | null; plan: DayPlan }>();
  rw.plans.forEach((plan, i) => {
    const state = rw.wx[i];
    plan.stations.forEach((st, k) => {
      if (!st.wpId) return;
      if (st.kind === "start" && out.has(st.wpId)) return;
      out.set(st.wpId, { st, wx: state?.status === "ok" ? state.values[k] : null, plan });
    });
  });
  return out;
}
