// Plausibility checks on a routed tour, per waypoint.
//
// The router has to pass exactly through every waypoint. A waypoint taken
// from the place search is usually the centre of a village; if that lies on
// a side street or at the end of a dead-end road, the route rides in and back
// out on the same road ("Stichfahrt"). On the map that looks like a tangle of
// lines, and BRouter is right to do it. The planner therefore detects it and
// offers to put the point onto the junction instead. The same goes for points
// placed away from any drivable road: the router snaps them to the nearest
// road, which can be far off.

import { haversine, type Coord } from "./geo";
import type { RouteResult, Waypoint } from "../types";

/** Out-and-back retrace from which a via point gets a hint. */
export const SPUR_MIN_M = 150;
/** Distance between a waypoint and the route's position for it. */
export const OFFROAD_MIN_M = 150;

// BRouter returns OSM node positions (6 decimals); the same road ridden back
// yields the very same coordinates. A little slack for rounding.
const SAME_POINT_M = 3;

export interface PointCheck {
  /** Index of the waypoint in the tour. */
  index: number;
  /** "spur": in and back out on the same road; "offroad": far from the road. */
  kind: "spur" | "offroad";
  /** Length of the retrace (spur) or distance to the road (offroad). */
  meters: number;
  /** Suggested position: the junction (spur) or the road position (offroad). */
  fix: [number, number];
}

const lngLat = (c: Coord): [number, number] => [c[0], c[1]];

/**
 * How far the next leg rides back along the previous one, starting at the
 * waypoint between them. Returns null if it leaves in another direction.
 */
export function findSpur(prevLeg: Coord[], nextLeg: Coord[]): { meters: number; base: [number, number] } | null {
  const back = [...prevLeg].reverse();
  let k = 0;
  while (k < back.length && k < nextLeg.length && haversine(back[k], nextLeg[k]) < SAME_POINT_M) k++;
  if (k < 2) return null;
  let meters = 0;
  for (let j = 1; j < k; j++) meters += haversine(back[j - 1], back[j]);
  return { meters, base: lngLat(back[k - 1]) };
}

/**
 * Check every waypoint of a routed tour. `legs` are the coordinates of each
 * routed leg in order (leg i runs from waypoint i to i+1). Returns nothing if
 * the legs don't match the waypoints (route still being recomputed).
 */
export function checkRoute(waypoints: Waypoint[], legs: Coord[][]): PointCheck[] {
  if (waypoints.length < 2 || legs.length !== waypoints.length - 1) return [];
  if (legs.some((l) => l.length === 0)) return [];
  const checks: PointCheck[] = [];
  const last = waypoints.length - 1;

  waypoints.forEach((w, i) => {
    // Where the route actually touches this waypoint.
    const routed = i < last ? legs[i][0] : legs[i - 1][legs[i - 1].length - 1];
    const off = haversine([w.lng, w.lat], routed);
    if (off >= OFFROAD_MIN_M) {
      checks.push({ index: i, kind: "offroad", meters: off, fix: lngLat(routed) });
    }

    // Only plain via points: start and end have no "in and back out", and
    // riding into the village of an overnight stop is exactly the plan.
    if (i === 0 || i === last || w.dayEnd) return;
    const spur = findSpur(legs[i - 1], legs[i]);
    if (spur && spur.meters >= SPUR_MIN_M) {
      checks.push({ index: i, kind: "spur", meters: spur.meters, fix: spur.base });
    }
  });
  return checks;
}

/** The routed line of every leg, in leg order (empty if a leg has none). */
export function legCoordinates(route: RouteResult): Coord[][] {
  return route.geojson.features.map((f) =>
    f.geometry?.type === "LineString" ? f.geometry.coordinates : [],
  );
}

/** Leg length for the list: metres below 1 km, one decimal below 10 km. */
export function formatLegDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${km.toFixed(0)} km`;
}
