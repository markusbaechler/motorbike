import { haversine, type Coord } from "./geo";

const CACHE = "map-openfreemap";

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function thin(coords: Coord[], minGap: number): Coord[] {
  if (!coords.length) return [];
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (haversine(out[out.length - 1], coords[i]) >= minGap) out.push(coords[i]);
  }
  return out;
}

async function resolveTileTemplate(styleUrl: string): Promise<{ tmpl: string; minZ: number; maxZ: number } | null> {
  const style = (await (await fetch(styleUrl)).json()) as {
    sources: Record<string, { type: string; tiles?: string[]; url?: string }>;
  };
  const src = Object.values(style.sources).find((s) => s.type === "vector");
  if (!src) return null;
  let tiles = src.tiles;
  let minZ = 0;
  let maxZ = 14;
  if (!tiles && src.url) {
    const tj = (await (await fetch(src.url)).json()) as { tiles?: string[]; minzoom?: number; maxzoom?: number };
    tiles = tj.tiles;
    if (tj.minzoom != null) minZ = tj.minzoom;
    if (tj.maxzoom != null) maxZ = tj.maxzoom;
  }
  if (!tiles || !tiles[0]) return null;
  return { tmpl: tiles[0], minZ, maxZ };
}

export interface PrefetchProgress {
  done: number;
  total: number;
}

/**
 * Pre-download the vector tiles along a route corridor into the same cache the
 * service worker serves from, so the route works offline. Bounded by a tile cap.
 */
export async function prefetchRouteTiles(
  styleUrl: string,
  coords: Coord[],
  onProgress: (p: PrefetchProgress) => void,
  opts: { minZoom?: number; maxZoom?: number; cap?: number } = {},
): Promise<{ cached: number; capped: boolean }> {
  const resolved = await resolveTileTemplate(styleUrl);
  if (!resolved) throw new Error("Kachel-Quelle nicht gefunden.");
  const cap = opts.cap ?? 2200;
  const lo = Math.max(resolved.minZ, opts.minZoom ?? 8);
  const hiWanted = Math.min(resolved.maxZ, opts.maxZoom ?? 13);

  const pts = thin(coords, 600); // a point roughly every 600 m
  let capped = false;

  // Build a tile set, adding zoom levels from low to high until the cap is hit.
  const tileKeys = new Set<string>();
  for (let z = lo; z <= hiWanted; z++) {
    const before = tileKeys.size;
    const atZoom = new Set<string>();
    for (const c of pts) {
      const x = lon2tile(c[0], z);
      const y = lat2tile(c[1], z);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) atZoom.add(`${z}/${x + dx}/${y + dy}`);
    }
    if (before + atZoom.size > cap) {
      capped = true;
      break; // stop adding deeper zooms to respect the cap
    }
    atZoom.forEach((k) => tileKeys.add(k));
  }

  const urls = [...tileKeys].map((k) => {
    const [z, x, y] = k.split("/");
    return resolved.tmpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  });

  const cache = await caches.open(CACHE);
  let done = 0;
  const total = urls.length;
  onProgress({ done, total });

  const CONC = 6;
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const u = urls[idx++];
      try {
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res.clone());
      } catch {
        /* skip failed tile */
      }
      done++;
      if (done % 5 === 0 || done === total) onProgress({ done, total });
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  return { cached: done, capped };
}
