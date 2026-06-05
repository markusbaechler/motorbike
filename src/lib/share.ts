import type { RouteProfile, Waypoint } from "../types";

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

export function encodeRoute(waypoints: Waypoint[]): string {
  const w: Row[] = waypoints.map((p) => [
    Number(p.lng.toFixed(5)),
    Number(p.lat.toFixed(5)),
    PROF_TO_CODE[p.legProfile] ?? "k",
    p.dayEnd ? 1 : 0,
    p.name ?? "",
    p.dayName ?? "",
    p.dayDate ?? "",
  ]);
  return b64urlEncode(JSON.stringify({ v: 1, w }));
}

let decodeId = 1;
export function decodeRoute(code: string): Waypoint[] | null {
  try {
    const data = JSON.parse(b64urlDecode(code)) as { v: number; w: Row[] };
    if (!data || !Array.isArray(data.w)) return null;
    return data.w.map((r) => ({
      id: `sh-${decodeId++}`,
      lng: r[0],
      lat: r[1],
      legProfile: CODE_TO_PROF[r[2]] ?? "kurvig",
      dayEnd: r[3] === 1 || undefined,
      name: r[4] || undefined,
      dayName: r[5] || undefined,
      dayDate: r[6] || undefined,
    }));
  } catch {
    return null;
  }
}

export function buildShareUrl(waypoints: Waypoint[]): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#r=${encodeRoute(waypoints)}`;
}

/** Read a shared route from the current URL hash, if present. */
export function readSharedRoute(): Waypoint[] | null {
  const h = window.location.hash;
  if (!h.startsWith("#r=")) return null;
  return decodeRoute(h.slice(3));
}
