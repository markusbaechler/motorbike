import type { SavedRoute, SavedRouteMeta } from "./types";

// Persistence layer for saved plans (M6 "Speichern & PWA").
//
// The interface is intentionally async and storage-agnostic so the same UI can
// later run against a cloud backend (Supabase, see M7) without changes: a
// future `SupabaseRouteStore` implements the same methods, and switching/merging
// happens behind this seam. Today the only implementation is local-first and
// backed by localStorage.

export interface RouteStore {
  /** All saved routes, newest first. */
  list(): Promise<SavedRouteMeta[]>;
  /** Load a single route, or null if it no longer exists. */
  load(id: string): Promise<SavedRoute | null>;
  /** Create or overwrite a route (matched by id). */
  save(route: SavedRoute): Promise<void>;
  /** Delete a route; a no-op if the id is unknown. */
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = "mb-routes-v1";

function readAll(): Record<string, SavedRoute> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeAll(routes: Record<string, SavedRoute>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
}

/** Local-first implementation backed by localStorage. */
export class LocalRouteStore implements RouteStore {
  async list(): Promise<SavedRouteMeta[]> {
    return Object.values(readAll())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
  }

  async load(id: string): Promise<SavedRoute | null> {
    return readAll()[id] ?? null;
  }

  async save(route: SavedRoute): Promise<void> {
    const all = readAll();
    all[route.id] = route;
    writeAll(all);
  }

  async remove(id: string): Promise<void> {
    const all = readAll();
    if (id in all) {
      delete all[id];
      writeAll(all);
    }
  }
}

/** Generate a stable id, falling back when crypto.randomUUID is unavailable. */
export function newRouteId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The store the app uses. Swap or wrap this to enable cloud sync later. */
export const routeStore: RouteStore = new LocalRouteStore();
