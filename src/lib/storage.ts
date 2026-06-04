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
