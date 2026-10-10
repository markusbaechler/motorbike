// Rain radar via RainViewer – free, key-less, attribution required.
// https://www.rainviewer.com/api.html
// The free tier serves the past ~2 h in 10-minute frames, tiles only up to
// zoom 7 (beyond that it returns a "Zoom Level Not Supported" image), and no
// nowcast. MapLibre overscales the zoom-7 tiles when zooming further in.

export const RADAR_LIST_URL = "https://api.rainviewer.com/public/weather-maps.json";
export const RADAR_MAX_ZOOM = 7;
export const RADAR_ATTRIBUTION = 'Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>';

export interface RadarFrame {
  time: number; // unix seconds
  tiles: string; // tile URL template for MapLibre
}

/** Past radar frames from the RainViewer list, oldest first. */
export function parseFrames(json: unknown): RadarFrame[] {
  const o = json as { host?: unknown; radar?: { past?: unknown } } | null;
  if (!o || typeof o.host !== "string" || !Array.isArray(o.radar?.past)) return [];
  const host = o.host;
  const out: RadarFrame[] = [];
  for (const f of o.radar.past as unknown[]) {
    const e = f as { time?: unknown; path?: unknown } | null;
    if (!e || typeof e.time !== "number" || typeof e.path !== "string") continue;
    // 256 px tiles, colour scheme 2 ("Universal Blue"), smoothed, snow shown.
    out.push({ time: e.time, tiles: `${host}${e.path}/256/{z}/{x}/{y}/2/1_1.png` });
  }
  return out.sort((a, b) => a.time - b.time);
}

export async function fetchRadarFrames(signal?: AbortSignal): Promise<RadarFrame[]> {
  const res = await fetch(RADAR_LIST_URL, { signal });
  if (!res.ok) throw new Error(`Radar HTTP ${res.status}`);
  const frames = parseFrames(await res.json());
  if (frames.length === 0) throw new Error("Radar: keine Bilder");
  return frames;
}

/** Next frame index of the loop. */
export function nextFrame(i: number, count: number): number {
  return count > 0 ? (i + 1) % count : 0;
}
