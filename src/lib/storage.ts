import type { Waypoint } from "../types";

export interface SavedRoute {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  waypoints: Waypoint[];
}

const KEY = "motorbike.routes.v1";

export function listRoutes(): SavedRoute[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(data) ? (data as SavedRoute[]) : [];
  } catch {
    return [];
  }
}

function persist(routes: SavedRoute[]): void {
  localStorage.setItem(KEY, JSON.stringify(routes));
}

export function saveRoute(name: string, waypoints: Waypoint[], id?: string): SavedRoute {
  const routes = listRoutes();
  const now = Date.now();
  if (id) {
    const idx = routes.findIndex((r) => r.id === id);
    if (idx >= 0) {
      routes[idx] = { ...routes[idx], name, waypoints, updatedAt: now };
      persist(routes);
      return routes[idx];
    }
  }
  const route: SavedRoute = {
    id: `r-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: now,
    updatedAt: now,
    waypoints,
  };
  routes.unshift(route);
  persist(routes);
  return route;
}

export function deleteRoute(id: string): void {
  persist(listRoutes().filter((r) => r.id !== id));
}

export function renameRoute(id: string, name: string): void {
  const routes = listRoutes();
  const r = routes.find((x) => x.id === id);
  if (r) {
    r.name = name;
    r.updatedAt = Date.now();
    persist(routes);
  }
}

// --- Auto-saved draft of the route currently being planned ---
// Protects work-in-progress against an accidental reload / app close (the live
// route otherwise only exists in memory).

export interface RouteDraft {
  waypoints: Waypoint[];
  defaultProfile: string;
  savedAt: number;
}

const DRAFT_KEY = "motorbike.draft.v1";

export function saveDraft(waypoints: Waypoint[], defaultProfile: string): void {
  try {
    if (waypoints.length === 0) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const draft: RouteDraft = { waypoints, defaultProfile, savedAt: Date.now() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage full / unavailable → ignore */
  }
}

export function loadDraft(): RouteDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as RouteDraft;
    return Array.isArray(d.waypoints) && d.waypoints.length > 0 ? d : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}

// --- File export / import (device transfer & sharing) ---

export function exportRouteFile(name: string, waypoints: Waypoint[]): void {
  const data = { app: "motorbike", version: 1, name, waypoints };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = name.trim().replace(/[^\w\-]+/g, "_") || "route";
  a.href = url;
  a.download = `${safe}.motorbike.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseRouteFile(text: string): { name: string; waypoints: Waypoint[] } {
  const d = JSON.parse(text);
  if (!d || !Array.isArray(d.waypoints)) {
    throw new Error("Keine gültige Motorbike-Routendatei.");
  }
  return { name: typeof d.name === "string" ? d.name : "Importierte Route", waypoints: d.waypoints };
}

// --- Recently used places (search convenience) ---

export interface RecentPlace {
  name: string;
  lat: number;
  lng: number;
}

const RECENT_KEY = "motorbike.recent.v1";
const RECENT_MAX = 8;

export function getRecentPlaces(): RecentPlace[] {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(data) ? (data as RecentPlace[]) : [];
  } catch {
    return [];
  }
}

export function addRecentPlace(p: RecentPlace): void {
  try {
    const list = getRecentPlaces().filter(
      (r) => r.name !== p.name || Math.abs(r.lat - p.lat) > 1e-4 || Math.abs(r.lng - p.lng) > 1e-4,
    );
    list.unshift({ name: p.name, lat: p.lat, lng: p.lng });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* ignore */
  }
}

// --- Booking / accommodation preferences (once per device) ---

export interface BookingPrefs {
  adults: number;
  children: number;
  rooms: number;
  affiliateId?: string;
}

const BOOKING_KEY = "motorbike.booking.v1";
const DEFAULT_PREFS: BookingPrefs = { adults: 2, children: 0, rooms: 1 };

export function getBookingPrefs(): BookingPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(BOOKING_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveBookingPrefs(prefs: BookingPrefs): void {
  localStorage.setItem(BOOKING_KEY, JSON.stringify(prefs));
}

