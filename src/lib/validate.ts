import type { RouteProfile, Waypoint } from "../types";

// Defensive parsing of waypoint data that comes from outside the running app:
// share links, imported files, localStorage (draft + saved routes). Anything
// that could crash the map (NaN / out-of-range coordinates) or the UI is
// rejected instead of being passed through.

const PROFILES: readonly RouteProfile[] = ["kurvig", "kurvig_plus", "schnell"];

export function isRouteProfile(v: unknown): v is RouteProfile {
  return typeof v === "string" && (PROFILES as readonly string[]).includes(v);
}

const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

let nextId = 1;

/** One waypoint from untrusted input, or null when it is unusable. */
export function sanitizeWaypoint(raw: unknown, idPrefix = "v"): Waypoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!inRange(o.lng, -180, 180) || !inRange(o.lat, -90, 90)) return null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : `${idPrefix}-${nextId++}`,
    lng: o.lng,
    lat: o.lat,
    legProfile: isRouteProfile(o.legProfile) ? o.legProfile : "kurvig",
    name: text(o.name, 200),
    dayEnd: o.dayEnd === true || undefined,
    dayName: text(o.dayName, 80),
    dayDate: isIsoDate(o.dayDate) ? o.dayDate : undefined,
  };
}

/**
 * A whole waypoint list from untrusted input. Strict on purpose: a single
 * broken point invalidates the list (silently dropping it would change the
 * route the sender meant to share).
 */
export function sanitizeWaypoints(raw: unknown, idPrefix?: string): Waypoint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Waypoint[] = [];
  for (const r of raw) {
    const w = sanitizeWaypoint(r, idPrefix);
    if (!w) return null;
    out.push(w);
  }
  return out;
}
