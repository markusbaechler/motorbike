// Central place for the free, key-less services the app relies on and for the
// club identity. Swapping any of these (e.g. to a self-hosted instance) happens
// here.

// OpenFreeMap – free vector tiles, no API key, no usage limit.
// https://openfreemap.org/
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Default map view: centre of the Alps – prime motorcycle territory.
export const DEFAULT_CENTER: [number, number] = [9.0, 46.8];
export const DEFAULT_ZOOM = 7;

// --- Identity: the planner is part of the Pudgilly Riders website ---------
// Links are absolute on purpose: the app runs under pudgilly.ch/planer/, on
// GitHub Pages and inside an iframe, and must reach the site from all three.
export const CLUB_NAME = "Pudgilly Riders";
export const APP_NAME = "Routenplaner";
export const SITE_URL = "https://pudgilly.ch";
export const SITE_LINKS = {
  home: `${SITE_URL}/`,
  touren: `${SITE_URL}/touren/`,
  impressum: `${SITE_URL}/impressum/`,
  datenschutz: `${SITE_URL}/datenschutz/`,
};

// Club tours published by the website (Pages CMS → Astro endpoint). Same
// origin as the planner in production; overridable for local development.
export const CLUB_TOURS_URL: string =
  import.meta.env.VITE_CLUB_TOURS_URL?.trim() || `${SITE_URL}/touren.json`;

// Booking.com affiliate id of the club (optional). Set at build time via
// VITE_BOOKING_AID so members never have to enter it themselves.
export const BOOKING_AID: string | undefined = import.meta.env.VITE_BOOKING_AID?.trim() || undefined;

// Set on the OLD hosting (GitHub Pages) once the planner is reachable at its
// new address: the Home screen then shows a "moved" card with a link that
// carries the device's saved tours along (see lib/migrate.ts). Empty on the
// new hosting itself, so the card never shows there.
export const MOVED_TO: string | undefined = import.meta.env.VITE_MOVED_TO?.trim() || undefined;
