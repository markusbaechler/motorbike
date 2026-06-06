import type { LngLat, Pass } from "./types";
import { COUNTRY_ISO } from "./countries";

// Browser-side geocoding via Nominatim (OpenStreetMap), key-less and free.
// Usage policy: max ~1 request/second, so all lookups go through a single
// serialised, throttled queue. Results are cached in localStorage so the slow
// first pass only ever happens once per device.
//
// https://operations.osmfoundation.org/policies/nominatim/

const NOMINATIM = "https://nominatim.openstreetmap.org";
const MIN_INTERVAL_MS = 1100;
const CACHE_KEY = "mb-geocode-v1";

type CacheEntry = LngLat | { failed: true };
type Cache = Record<string, CacheEntry>;

function loadCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

let cache: Cache = loadCache();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* storage full / unavailable – ignore, we keep the in-memory cache */
    }
  }, 400);
}

// --- throttled request queue ------------------------------------------------

let lastRequest = 0;
let chain: Promise<unknown> = Promise.resolve();

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return task();
  };
  const result = chain.then(run, run);
  // Keep the chain alive regardless of individual failures.
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function nominatim(path: string): Promise<unknown> {
  const res = await fetch(`${NOMINATIM}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

// --- public API -------------------------------------------------------------

/** Free-form place search (used for the start/destination inputs). */
export async function geocodePlace(
  query: string,
): Promise<(LngLat & { label: string }) | null> {
  const q = encodeURIComponent(query.trim());
  if (!q) return null;
  const data = (await schedule(() =>
    nominatim(`/search?format=jsonv2&limit=1&accept-language=de&q=${q}`),
  )) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!data.length) return null;
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    label: data[0].display_name,
  };
}

/** Reverse geocode a coordinate to its country (German name). */
export async function reverseCountry(point: LngLat): Promise<string | null> {
  const data = (await schedule(() =>
    nominatim(
      `/reverse?format=jsonv2&zoom=3&accept-language=de&lat=${point.lat}&lon=${point.lon}`,
    ),
  )) as { address?: { country_code?: string } };
  const iso = data.address?.country_code?.toLowerCase();
  if (!iso) return null;
  const entry = Object.entries(COUNTRY_ISO).find(([, code]) => code === iso);
  return entry ? entry[0] : null;
}

/** Cached coordinate for a pass, or undefined if not yet looked up. */
export function cachedCoord(pass: Pass): LngLat | undefined {
  const e = cache[pass.id];
  return e && !("failed" in e) ? e : undefined;
}

export function isCached(pass: Pass): boolean {
  return pass.id in cache;
}

/**
 * Geocode a single pass, using its country to constrain the search and the
 * cache to avoid repeat lookups. Returns null when nothing usable was found.
 */
export async function geocodePass(pass: Pass): Promise<LngLat | null> {
  const cached = cache[pass.id];
  if (cached) return "failed" in cached ? null : cached;

  const codes = pass.countries
    .map((c) => COUNTRY_ISO[c])
    .filter(Boolean)
    .join(",");
  const q = encodeURIComponent(pass.query);
  const cc = codes ? `&countrycodes=${codes}` : "";
  try {
    const data = (await schedule(() =>
      nominatim(`/search?format=jsonv2&limit=1&accept-language=de${cc}&q=${q}`),
    )) as Array<{ lat: string; lon: string }>;
    if (!data.length) {
      cache[pass.id] = { failed: true };
      persist();
      return null;
    }
    const coord = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    cache[pass.id] = coord;
    persist();
    return coord;
  } catch {
    // Network/HTTP error: do NOT cache as failed so it can be retried later.
    return null;
  }
}
