// Weather at the estimated passing time along the route: plans the timed
// stations (lib/schedule.ts) and fetches their hourly forecast (lib/weather.ts).
import { useEffect, useMemo, useState } from "react";
import type { RouteResult, Waypoint } from "../types";
import type { KnownPass } from "./analysis";
import { ensureEuroPasses } from "./passplanner";
import { planDays, type DayPlan, type Station } from "./schedule";
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

const STABLE_MS = 1000;
const TICK_MS = 5 * 60_000; // "jetzt" as default start moves with the clock

export function useRouteWeather(waypoints: Waypoint[], route: RouteResult | null): RouteWeather {
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

  const plans = useMemo(
    () => (route && waypoints.length >= 2 ? planDays(waypoints, route, passes, now) : []),
    [waypoints, route, passes, now],
  );

  const [wx, setWx] = useState<DayWxState[]>([]);
  useEffect(() => {
    const inWindow = (p: DayPlan) =>
      p.daysAhead >= 0 && p.daysAhead <= FORECAST_DAYS && p.stations.length > 0;
    setWx(plans.map((p) => (inWindow(p) ? { status: "loading" } : { status: "none" })));
    if (plans.length === 0) return;
    const ctrl = new AbortController();
    // Wait until the route is stable (dragging, typing) before asking.
    const timer = setTimeout(async () => {
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i];
        if (!inWindow(p)) continue;
        try {
          const values = await fetchDayWeather(p.stations, p.date, ctrl.signal);
          setWx((prev) => prev.map((s, j) => (j === i ? { status: "ok", values } : s)));
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          setWx((prev) => prev.map((s, j) => (j === i ? { status: "error" } : s)));
        }
      }
    }, STABLE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [plans]);

  return { plans, wx };
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
