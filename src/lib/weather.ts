// Weather forecast via Open-Meteo – free, key-less, CORS-enabled.
// https://open-meteo.com/
import type { Station } from "./schedule";

// WMO weather code → short German label.
export function codeLabel(code: number): string {
  if (code === 0) return "Klar";
  if (code <= 2) return "Heiter";
  if (code === 3) return "Bewölkt";
  if (code === 45 || code === 48) return "Nebel";
  if (code >= 51 && code <= 57) return "Niesel";
  if (code >= 61 && code <= 67) return "Regen";
  if (code >= 71 && code <= 77) return "Schnee";
  if (code >= 80 && code <= 82) return "Schauer";
  if (code >= 85 && code <= 86) return "Schneeschauer";
  if (code >= 95) return "Gewitter";
  return "—";
}

// true = good biking weather (for colour cues).
export function isFair(code: number): boolean {
  return code <= 3;
}

// --- Hourly forecast at the passing time along the route ---

// Forecast window in days ahead of today (Open-Meteo goes to 16).
export const FORECAST_DAYS = 14;

export interface HourWx {
  code: number;
  temp: number;
  precipProb: number | null;
  precip: number;
  wind: number;
}
type Arr = (number | null)[];
// One location's hourly values for one day, index = local hour 0–23.
export interface Series {
  temp: Arr;
  prob: Arr;
  precip: Arr;
  code: Arr;
  wind: Arr;
}

export function hourlyUrl(pts: { lat: number; lng: number; ele?: number }[], date: string): string {
  const lat = pts.map((p) => p.lat.toFixed(4)).join(",");
  const lng = pts.map((p) => p.lng.toFixed(4)).join(",");
  // Elevation lets Open-Meteo correct the temperature for passes. It is a
  // per-request list, so send it only when every point has one.
  const allEle = pts.every((p) => p.ele != null && Number.isFinite(p.ele));
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    (allEle ? `&elevation=${pts.map((p) => Math.round(p.ele!)).join(",")}` : "") +
    `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m` +
    `&timezone=Europe%2FZurich&start_date=${date}&end_date=${date}`
  );
}

/** Open-Meteo answers with an array for several locations, an object for one. */
export function parseHourly(json: unknown): Series[] | null {
  const list = Array.isArray(json) ? json : [json];
  const out: Series[] = [];
  for (const item of list) {
    const h = (item as { hourly?: Record<string, Arr> } | null)?.hourly;
    if (!h || !Array.isArray(h.temperature_2m)) return null;
    out.push({
      temp: h.temperature_2m,
      prob: h.precipitation_probability ?? [],
      precip: h.precipitation ?? [],
      code: h.weather_code ?? [],
      wind: h.wind_speed_10m ?? [],
    });
  }
  return out;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Values at a clock minute: temperature/wind interpolated, rain of that hour. */
export function valueAt(s: Series, minute: number): HourWx | null {
  const last = s.temp.length - 1;
  if (last < 0) return null;
  const pos = Math.min(Math.max(minute / 60, 0), last);
  const h0 = Math.floor(pos);
  const h1 = Math.min(h0 + 1, last);
  const f = pos - h0;
  const lerp = (a: Arr) => {
    const x = num(a[h0]);
    const y = num(a[h1]);
    return x == null ? y : y == null ? x : x + (y - x) * f;
  };
  const temp = lerp(s.temp);
  const code = num(s.code[h0]);
  if (temp == null || code == null) return null;
  return {
    code,
    temp,
    precipProb: num(s.prob[h0]),
    precip: num(s.precip[h0]) ?? 0,
    wind: lerp(s.wind) ?? 0,
  };
}

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; s: Series }>();
const keyOf = (lat: number, lng: number, date: string) => `${lat.toFixed(2)},${lng.toFixed(2)}:${date}`;
export function clearWeatherCache(): void {
  cache.clear();
}

/** Hourly forecast for every station of one day (one request for the uncached ones). */
export async function fetchDayWeather(
  stations: Station[],
  date: string,
  signal?: AbortSignal,
): Promise<(HourWx | null)[]> {
  const now = Date.now();
  const missing = stations.filter((s) => {
    const c = cache.get(keyOf(s.lat, s.lng, date));
    return !c || now - c.at > CACHE_MS;
  });
  if (missing.length > 0) {
    const res = await fetch(hourlyUrl(missing, date), { signal });
    if (!res.ok) throw new Error(`Wetter HTTP ${res.status}`);
    const series = parseHourly(await res.json());
    if (!series || series.length !== missing.length) throw new Error("Wetter: unerwartete Antwort");
    missing.forEach((s, i) => cache.set(keyOf(s.lat, s.lng, date), { at: now, s: series[i] }));
  }
  return stations.map((s) => {
    const c = cache.get(keyOf(s.lat, s.lng, date));
    return c ? valueAt(c.s, s.arriveMin) : null;
  });
}

export interface DaySummary {
  tMin: number;
  tMax: number;
  maxProb: number | null;
  maxPrecip: number;
  worstCode: number;
}

export function summarize(values: (HourWx | null)[]): DaySummary | null {
  const v = values.filter((x): x is HourWx => x != null);
  if (v.length === 0) return null;
  const probs = v.map((x) => x.precipProb).filter((p): p is number => p != null);
  return {
    tMin: Math.round(Math.min(...v.map((x) => x.temp))),
    tMax: Math.round(Math.max(...v.map((x) => x.temp))),
    maxProb: probs.length ? Math.max(...probs) : null,
    maxPrecip: Math.max(...v.map((x) => x.precip)),
    worstCode: Math.max(...v.map((x) => x.code)),
  };
}
