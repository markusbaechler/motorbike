// Moving house: the planner used to live on GitHub Pages and now lives under
// pudgilly.ch/planer/. Browser storage is per origin, so saved tours would be
// left behind. The old origin therefore offers a link that carries everything
// worth keeping in the URL hash (#migrate=…); the new origin reads it once,
// merges it into its own storage and drops the hash.

import {
  addRecentPlace,
  getBookingPrefs,
  getRecentPlaces,
  listRoutes,
  loadDraft,
  saveBookingPrefs,
  saveDraft,
  saveRoute,
  type BookingPrefs,
  type RecentPlace,
  type RouteDraft,
  type SavedRoute,
} from "./storage";
import { isRouteProfile, sanitizeWaypoints } from "./validate";

export interface MigrationPayload {
  v: 1;
  routes: SavedRoute[];
  draft: RouteDraft | null;
  booking: BookingPrefs;
  recent: RecentPlace[];
}

export interface MigrationResult {
  routesAdded: number;
  routesSkipped: number;
  draftRestored: boolean;
}

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

/** Everything on this device that is worth taking along. */
export function collectMigration(): MigrationPayload {
  return {
    v: 1,
    routes: listRoutes(),
    draft: loadDraft(),
    booking: getBookingPrefs(),
    recent: getRecentPlaces(),
  };
}

export function hasAnythingToMigrate(p: MigrationPayload): boolean {
  return p.routes.length > 0 || p.draft !== null;
}

export function encodeMigration(p: MigrationPayload): string {
  return b64urlEncode(JSON.stringify(p));
}

/** Link to the new home that carries this device's data. */
export function buildMigrationUrl(target: string, p: MigrationPayload = collectMigration()): string {
  const base = target.endsWith("/") ? target : `${target}/`;
  return `${base}#migrate=${encodeMigration(p)}`;
}

const num = (v: unknown, fallback: number, min: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min ? Math.round(v) : fallback;

/** Strict parse of a payload from a link; null for anything unusable. */
export function decodeMigration(code: string): MigrationPayload | null {
  try {
    const d = JSON.parse(b64urlDecode(code)) as Record<string, unknown> | null;
    if (!d || d.v !== 1) return null;

    const routes: SavedRoute[] = [];
    if (Array.isArray(d.routes)) {
      for (const r of d.routes) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        const waypoints = sanitizeWaypoints(o.waypoints, "m");
        if (!waypoints || waypoints.length < 2) continue;
        routes.push({
          id: typeof o.id === "string" && o.id ? o.id : `m-${routes.length}`,
          name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 80) : "Tour",
          createdAt: num(o.createdAt, 0, 0),
          updatedAt: num(o.updatedAt, 0, 0),
          waypoints,
        });
      }
    }

    let draft: RouteDraft | null = null;
    if (d.draft && typeof d.draft === "object") {
      const o = d.draft as Record<string, unknown>;
      const waypoints = sanitizeWaypoints(o.waypoints, "md");
      if (waypoints && waypoints.length > 0) {
        draft = {
          waypoints,
          defaultProfile: isRouteProfile(o.defaultProfile) ? o.defaultProfile : "kurvig",
          savedAt: num(o.savedAt, 0, 0),
        };
      }
    }

    const b = (d.booking && typeof d.booking === "object" ? d.booking : {}) as Record<string, unknown>;
    const booking: BookingPrefs = {
      adults: num(b.adults, 2, 1),
      children: num(b.children, 0, 0),
      rooms: num(b.rooms, 1, 1),
      affiliateId: typeof b.affiliateId === "string" && b.affiliateId.trim() ? b.affiliateId.trim() : undefined,
    };

    const recent: RecentPlace[] = [];
    if (Array.isArray(d.recent)) {
      for (const r of d.recent) {
        const o = (r ?? {}) as Record<string, unknown>;
        if (
          typeof o.name === "string" &&
          o.name.trim() &&
          typeof o.lat === "number" &&
          typeof o.lng === "number" &&
          Number.isFinite(o.lat) &&
          Number.isFinite(o.lng)
        ) {
          recent.push({ name: o.name.trim().slice(0, 200), lat: o.lat, lng: o.lng });
        }
      }
    }

    return { v: 1, routes, draft, booking, recent };
  } catch {
    return null;
  }
}

export function readMigrationFromHash(hash: string = window.location.hash): MigrationPayload | null {
  if (!hash.startsWith("#migrate=")) return null;
  return decodeMigration(hash.slice("#migrate=".length));
}

// A tour is "the same" when name and point sequence match; ids differ per
// origin and must not be compared.
const fingerprint = (r: SavedRoute): string =>
  `${r.name}|${r.waypoints
    .map((w) => `${w.lng.toFixed(5)},${w.lat.toFixed(5)},${w.legProfile},${w.dayEnd ? 1 : 0}`)
    .join(";")}`;

/**
 * Merge a payload into this origin's storage. Tours already present are
 * skipped, so following the link twice does not duplicate anything.
 */
export function applyMigration(p: MigrationPayload): MigrationResult {
  const have = new Set(listRoutes().map(fingerprint));
  let routesAdded = 0;
  let routesSkipped = 0;
  // saveRoute puts the newest first; walk oldest→newest to keep the order.
  for (const r of [...p.routes].reverse()) {
    const f = fingerprint(r);
    if (have.has(f)) {
      routesSkipped++;
      continue;
    }
    saveRoute(r.name, r.waypoints);
    have.add(f);
    routesAdded++;
  }

  let draftRestored = false;
  if (p.draft && !loadDraft()) {
    saveDraft(p.draft.waypoints, p.draft.defaultProfile);
    draftRestored = true;
  }

  // Traveller preferences: take them over only while the local ones are
  // still the defaults, never overwrite a choice made on this device.
  const local = getBookingPrefs();
  if (local.adults === 2 && local.children === 0 && local.rooms === 1 && !local.affiliateId) {
    saveBookingPrefs(p.booking);
  }

  for (const r of [...p.recent].reverse()) addRecentPlace(r);

  return { routesAdded, routesSkipped, draftRestored };
}
