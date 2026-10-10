// 3-day outlook for one place (the map centre): daily values plus the best
// dry riding window per day. Open-Meteo, like lib/weather.ts.

export interface Hour {
  prob: number | null; // precipitation probability, %
  precip: number | null; // mm in that hour
}

export interface OutlookDay {
  date: string; // yyyy-mm-dd (Swiss time)
  code: number;
  tMax: number;
  tMin: number;
  probMax: number | null;
  precipSum: number; // mm, one decimal
  hours: Hour[]; // 24, index = local hour
}

// Riding day and what counts as a dry hour.
export const RIDE_FROM = 8;
export const RIDE_TO = 19;
const DRY_PROB = 30; // %
const DRY_MM = 0.2;
const MIN_WINDOW_H = 2;

const isDry = (h: Hour) =>
  (h.prob == null || h.prob < DRY_PROB) && (h.precip == null || h.precip < DRY_MM);

/**
 * Longest run of dry hours within the riding day, starting no earlier than
 * `fromHour` (today: the current hour). `to` is exclusive (16 = until 16:00).
 * Null when no window of at least 2 h exists.
 */
export function bestWindow(hours: Hour[], fromHour = RIDE_FROM): { from: number; to: number } | null {
  const start = Math.max(RIDE_FROM, fromHour);
  let best: { from: number; to: number } | null = null;
  let runFrom = -1;
  for (let h = start; h <= RIDE_TO; h++) {
    const dry = h < RIDE_TO && hours[h] != null && isDry(hours[h]);
    if (dry && runFrom < 0) runFrom = h;
    if (!dry && runFrom >= 0) {
      if (h - runFrom >= MIN_WINDOW_H && (!best || h - runFrom > best.to - best.from)) best = { from: runFrom, to: h };
      runFrom = -1;
    }
  }
  return best;
}

/** Text for the best window; today after the last possible window: "Fahrtag vorbei". */
export function windowLabel(hours: Hour[], fromHour = RIDE_FROM): string {
  if (fromHour > RIDE_TO - MIN_WINDOW_H) return "Fahrtag vorbei";
  const w = bestWindow(hours, fromHour);
  return w ? `trocken ${w.from}–${w.to} Uhr` : "kaum trocken";
}

export function outlookUrl(lat: number, lng: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum` +
    `&hourly=precipitation_probability,precipitation` +
    `&forecast_days=3&timezone=Europe%2FZurich`
  );
}

type Arr = (number | null)[];
const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function parseOutlook(json: unknown): OutlookDay[] | null {
  const o = json as { daily?: Record<string, unknown>; hourly?: Record<string, Arr> } | null;
  const d = o?.daily;
  const time = d?.time;
  if (!d || !Array.isArray(time) || time.length === 0) return null;
  const col = (k: string) => (Array.isArray(d[k]) ? (d[k] as Arr) : []);
  const prob = o?.hourly?.precipitation_probability ?? [];
  const precip = o?.hourly?.precipitation ?? [];
  const out: OutlookDay[] = [];
  for (let i = 0; i < time.length; i++) {
    const code = num(col("weather_code")[i]);
    const tMax = num(col("temperature_2m_max")[i]);
    const tMin = num(col("temperature_2m_min")[i]);
    if (code == null || tMax == null || tMin == null) return null;
    out.push({
      date: String(time[i]),
      code,
      tMax: Math.round(tMax),
      tMin: Math.round(tMin),
      probMax: num(col("precipitation_probability_max")[i]),
      precipSum: Math.round((num(col("precipitation_sum")[i]) ?? 0) * 10) / 10,
      hours: Array.from({ length: 24 }, (_, h) => ({ prob: num(prob[i * 24 + h]), precip: num(precip[i * 24 + h]) })),
    });
  }
  return out;
}

// Small map moves reuse the answer: cache per ~5 km cell for 30 min.
const CACHE_MS = 30 * 60_000;
const CELL = 0.05;
const cache = new Map<string, { at: number; days: OutlookDay[] }>();
export function clearOutlookCache(): void {
  cache.clear();
}

export async function fetchOutlook(lat: number, lng: number, signal?: AbortSignal): Promise<OutlookDay[]> {
  const key = `${Math.round(lat / CELL)},${Math.round(lng / CELL)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.days;
  const res = await fetch(outlookUrl(lat, lng), { signal });
  if (!res.ok) throw new Error(`Prognose HTTP ${res.status}`);
  const days = parseOutlook(await res.json());
  if (!days) throw new Error("Prognose: unerwartete Antwort");
  cache.set(key, { at: Date.now(), days });
  return days;
}
