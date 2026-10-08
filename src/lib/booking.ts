import { BOOKING_AID } from "../config";
import type { BookingPrefs } from "./storage";

// Add n days to an ISO yyyy-mm-dd date string.
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a Booking.com search deep link with pre-filled location, dates and
 * traveller preferences. No API/affiliation required. The club's affiliate id
 * comes from the build (VITE_BOOKING_AID); an id stored on the device by an
 * older version is still honoured as a fallback.
 */
export function buildBookingUrl(
  place: string,
  checkin: string | undefined,
  checkout: string | undefined,
  prefs: BookingPrefs,
): string {
  const p = new URLSearchParams();
  p.set("ss", place);
  if (checkin) p.set("checkin", checkin);
  if (checkout) p.set("checkout", checkout);
  p.set("group_adults", String(prefs.adults));
  p.set("group_children", String(prefs.children));
  p.set("no_rooms", String(prefs.rooms));
  p.set("lang", "de");
  const aid = BOOKING_AID ?? prefs.affiliateId?.trim();
  if (aid) p.set("aid", aid);
  return `https://www.booking.com/searchresults.html?${p.toString()}`;
}
