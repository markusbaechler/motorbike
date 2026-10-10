// Pure helpers for editing the waypoint list. All functions return a new
// array (or the SAME array when nothing changes, so callers can bail out).
//
// Round trips ("Rundtour") are a closed loop: the last waypoint is a copy of
// the first (same coordinates, own id). Everything that "adds a point" must
// then insert BEFORE that closing copy, otherwise the tour reads
// Start → A → B → Start → NEU and the loop is broken.

import type { RouteProfile, Waypoint } from "../types";

/**
 * Short label of a point for lists, markers, roadbook and GPX: the first part
 * of a looked-up place ("Andermatt, Uri, Schweiz" → "Andermatt"); a name the
 * rider typed stays whole; no name → the coordinates (or `fallback`).
 */
export function pointLabel(wp: Pick<Waypoint, "name" | "nameEdited" | "lat" | "lng">, fallback?: string): string {
  if (!wp.name) return fallback ?? `${wp.lat.toFixed(3)}, ${wp.lng.toFixed(3)}`;
  if (wp.nameEdited) return wp.name;
  return wp.name.split(",")[0].trim();
}

// A point about to become a waypoint: position, optional name, fresh id.
export type NewPoint = Pick<Waypoint, "id" | "lng" | "lat" | "name">;

/**
 * True when the tour ends where it starts. Exact coordinate equality is
 * enough because the closing point is always a copy of the start. Two
 * points alone (Start → Start) do not count as a loop.
 */
export function isClosedLoop(wps: Waypoint[]): boolean {
  if (wps.length < 3) return false;
  const first = wps[0];
  const last = wps[wps.length - 1];
  return first.lat === last.lat && first.lng === last.lng;
}

/**
 * Add a point at the end of the tour. On a closed loop the point goes in
 * front of the closing copy (the leg "new point → start" keeps the closing
 * point's profile; the new leg gets the default profile). Day flags stay
 * where they are.
 */
export function appendWaypoint(
  wps: Waypoint[],
  point: NewPoint,
  defaultProfile: RouteProfile,
): Waypoint[] {
  const wp: Waypoint = { ...point, legProfile: defaultProfile };
  if (!isClosedLoop(wps)) return [...wps, wp];
  const copy = [...wps];
  copy.splice(wps.length - 1, 0, wp);
  return copy;
}

/**
 * Insert a shaping point into a specific leg (legIndex = index of the leg
 * being reshaped, i.e. the point lands after wps[legIndex]). The new point
 * keeps that leg's profile.
 */
export function insertWaypoint(
  wps: Waypoint[],
  legIndex: number,
  point: NewPoint,
  defaultProfile: RouteProfile,
): Waypoint[] {
  const dest = wps[legIndex + 1];
  const wp: Waypoint = {
    ...point,
    legProfile: dest ? dest.legProfile : defaultProfile,
  };
  const copy = [...wps];
  copy.splice(legIndex + 1, 0, wp);
  return copy;
}

/**
 * Make the point the tour's destination ("Ziel hier").
 * - Open tour: appended; the old end becomes a regular stop (as before).
 * - Closed loop: the closing copy of the start is REPLACED by the point, so
 *   the loop opens on purpose. "Rundtour" can close it again afterwards.
 */
export function replaceEnd(
  wps: Waypoint[],
  point: NewPoint,
  defaultProfile: RouteProfile,
): Waypoint[] {
  const wp: Waypoint = { ...point, legProfile: defaultProfile };
  if (!isClosedLoop(wps)) return [...wps, wp];
  return [...wps.slice(0, -1), wp];
}

/**
 * Make the point the tour's start ("Start hier"). The old start turns into
 * a regular stop reached with the default profile.
 * Decision for closed loops: the loop STAYS closed – the closing copy moves
 * to the new start as well (a round trip that starts here also ends here).
 * Its leg profile and day flags are untouched.
 */
export function prependWaypoint(
  wps: Waypoint[],
  point: NewPoint,
  defaultProfile: RouteProfile,
): Waypoint[] {
  const closed = isClosedLoop(wps);
  const start: Waypoint = { ...point, legProfile: defaultProfile };
  const rest = wps.map((w, i) => {
    if (i === 0) return { ...w, legProfile: defaultProfile };
    if (closed && i === wps.length - 1) {
      return { ...w, lng: point.lng, lat: point.lat, name: point.name };
    }
    return w;
  });
  return [start, ...rest];
}

/**
 * "Tag hinzufügen": end the current day at the tour's last real stop.
 * - Open tour: the last waypoint (the next point added starts a new day).
 * - Closed loop: the point BEFORE the closing copy, so the new day is
 *   "overnight → back to start" and every point added lands in it.
 * Returns the same array when the tour is too short or that point already
 * ends a day.
 */
export function addDayEnd(wps: Waypoint[]): Waypoint[] {
  if (wps.length < 2) return wps;
  const idx = isClosedLoop(wps) ? wps.length - 2 : wps.length - 1;
  if (wps[idx].dayEnd) return wps;
  return wps.map((w, i) => (i === idx ? { ...w, dayEnd: true } : w));
}

/**
 * Whether the waypoint at `index` may swap with its neighbour in
 * `direction`. On a closed loop the start and the closing copy are fixed, so
 * neither they nor their neighbours may swap across them.
 */
export function canReorder(wps: Waypoint[], index: number, direction: -1 | 1): boolean {
  const j = index + direction;
  if (index < 0 || j < 0 || j >= wps.length) return false;
  if (isClosedLoop(wps)) {
    const lastIdx = wps.length - 1;
    if (index === 0 || index === lastIdx || j === 0 || j === lastIdx) return false;
  }
  return true;
}

/**
 * Move a waypoint one position up (-1) or down (+1). Only the PLACE moves
 * (id, position, name); leg profile and day flags belong to the list
 * position and stay put. Returns the same array when the move is not
 * allowed.
 */
export function reorderWaypoint(wps: Waypoint[], id: string, direction: -1 | 1): Waypoint[] {
  const i = wps.findIndex((w) => w.id === id);
  if (!canReorder(wps, i, direction)) return wps;
  const j = i + direction;
  const place = (w: Waypoint) => ({ id: w.id, lng: w.lng, lat: w.lat, name: w.name });
  const copy = [...wps];
  copy[i] = { ...wps[i], ...place(wps[j]) };
  copy[j] = { ...wps[j], ...place(wps[i]) };
  return copy;
}

/**
 * "Rundtour": close the tour by appending a copy of the start (new id, no
 * day data). No-op when already closed or shorter than two points.
 */
export function closeLoop(wps: Waypoint[], id: string, defaultProfile: RouteProfile): Waypoint[] {
  if (wps.length < 2) return wps;
  const first = wps[0];
  const last = wps[wps.length - 1];
  if (first.lat === last.lat && first.lng === last.lng) return wps;
  return [
    ...wps,
    {
      ...first,
      id,
      legProfile: defaultProfile,
      dayEnd: undefined,
      dayName: undefined,
      dayDate: undefined,
    },
  ];
}

/**
 * "Umkehren": reverse the direction. Per-leg profiles are flipped so each
 * road segment keeps its riding style; day data is dropped because it does
 * not map cleanly when reversed. A closed loop stays closed.
 */
export function reverseWaypoints(wps: Waypoint[]): Waypoint[] {
  if (wps.length < 2) return wps;
  const n = wps.length;
  const rev = [...wps]
    .reverse()
    .map((w) => ({ ...w, dayEnd: undefined, dayName: undefined, dayDate: undefined }));
  for (let k = 1; k < n; k++) rev[k].legProfile = wps[n - k].legProfile;
  return rev;
}
