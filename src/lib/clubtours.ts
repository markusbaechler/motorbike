// Club tours: tours the club publishes on the website (maintained in the
// Pages CMS, exported by the Astro build as /touren.json). The planner lists
// them and loads one like a shared link. Everything here treats the JSON as
// untrusted input: a broken entry is dropped, never shown half-empty.

import { CLUB_TOURS_URL } from "../config";
import { computeDays } from "./days";
import { decodeRoute } from "./share";
import type { Waypoint } from "../types";

export interface ClubTour {
  slug: string;
  title: string;
  region?: string;
  level?: string;
  description?: string;
  highlights: string[];
  distanceKm?: number;
  durationMin?: number;
  days: number;
  waypoints: Waypoint[];
  // Share-link payload (the part after "#r="), kept for building links.
  code: string;
  // Next club ride of this tour, if one is in the calendar.
  next?: { date: string; label: string };
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const pos = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;

/** Strict parse of the website's JSON (an array, or `{ tours: [...] }`). */
export function parseClubTours(data: unknown): ClubTour[] {
  let list: unknown[] | null = null;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object" && Array.isArray((data as { tours?: unknown }).tours)) {
    list = (data as { tours: unknown[] }).tours;
  }
  if (!list) return [];

  const out: ClubTour[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const slug = str(o.slug, 80);
    const title = str(o.title, 120);
    const code = str(o.code, 200_000);
    if (!slug || !title || !code || seen.has(slug)) continue;
    const waypoints = decodeRoute(code);
    if (!waypoints || waypoints.length < 2) continue;
    seen.add(slug);

    const highlights = Array.isArray(o.highlights)
      ? o.highlights.map((h) => str(h, 80)).filter((h): h is string => !!h).slice(0, 12)
      : [];
    const n = o.next && typeof o.next === "object" ? (o.next as Record<string, unknown>) : null;
    const nextDate = n ? str(n.date, 10) : undefined;
    const nextLabel = n ? str(n.label, 80) : undefined;

    out.push({
      slug,
      title,
      region: str(o.region, 80),
      level: str(o.level, 40),
      description: str(o.description, 1000),
      highlights,
      distanceKm: pos(o.distanceKm),
      durationMin: pos(o.durationMin),
      days: computeDays(waypoints).length || 1,
      waypoints,
      code,
      next: nextDate && nextLabel ? { date: nextDate, label: nextLabel } : undefined,
    });
  }
  return out;
}

let cache: Promise<ClubTour[]> | null = null;

/** Load the club tours once per session; a failed load can be retried. */
export function fetchClubTours(force = false): Promise<ClubTour[]> {
  if (!cache || force) {
    cache = fetch(CLUB_TOURS_URL, { headers: { accept: "application/json" } })
      .then((r) => {
        // No feed yet (website not updated): that is "no tours", not an error.
        if (r.status === 404) return [];
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(parseClubTours)
      .catch((e: unknown) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}
