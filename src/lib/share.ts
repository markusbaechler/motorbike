import type { RouteProfile, Waypoint } from "../types";
import { sanitizeWaypoints } from "./validate";

// Compact, URL-safe encoding of a route's waypoints (no server needed).
// Only waypoints are stored (not the dense geometry), so links stay short.

const PROF_TO_CODE: Record<RouteProfile, string> = {
  kurvig: "k",
  kurvig_plus: "p",
  schnell: "s",
};
const CODE_TO_PROF: Record<string, RouteProfile> = {
  k: "kurvig",
  p: "kurvig_plus",
  s: "schnell",
};

function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)));
}

type Row = [number, number, string, number, string, string, string];

// Routed distance/time, embedded so the website can show them for club tours
// without routing at build time. The planner itself ignores them on import.
export interface ShareStats {
  distanceKm: number;
  durationMin: number;
}

export function encodeRoute(waypoints: Waypoint[], stats?: ShareStats): string {
  const w: Row[] = waypoints.map((p) => [
    Number(p.lng.toFixed(5)),
    Number(p.lat.toFixed(5)),
    PROF_TO_CODE[p.legProfile] ?? "k",
    p.dayEnd ? 1 : 0,
    p.name ?? "",
    p.dayName ?? "",
    p.dayDate ?? "",
  ]);
  const payload: { v: 1; w: Row[]; s?: [number, number] } = { v: 1, w };
  if (stats && Number.isFinite(stats.distanceKm) && Number.isFinite(stats.durationMin)) {
    payload.s = [Math.round(stats.distanceKm), Math.round(stats.durationMin)];
  }
  return b64urlEncode(JSON.stringify(payload));
}

// Returns null for anything that isn't a complete, well-formed route: the link
// may be truncated, hand-edited or from a future format we don't understand.
export function decodeRoute(code: string): Waypoint[] | null {
  try {
    const data = JSON.parse(b64urlDecode(code)) as { v?: unknown; w?: unknown };
    if (!data || !Array.isArray(data.w)) return null;
    const rows = data.w.map((r: unknown) =>
      Array.isArray(r)
        ? {
            lng: r[0],
            lat: r[1],
            legProfile: CODE_TO_PROF[String(r[2])],
            dayEnd: r[3] === 1,
            name: r[4] || undefined,
            dayName: r[5] || undefined,
            dayDate: r[6] || undefined,
          }
        : null,
    );
    return sanitizeWaypoints(rows, "sh");
  } catch {
    return null;
  }
}

export function buildShareUrl(waypoints: Waypoint[], stats?: ShareStats): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#r=${encodeRoute(waypoints, stats)}`;
}

/** Read a shared route from the current URL hash, if present. */
export function readSharedRoute(): Waypoint[] | null {
  const h = window.location.hash;
  if (!h.startsWith("#r=")) return null;
  return decodeRoute(h.slice(3));
}
