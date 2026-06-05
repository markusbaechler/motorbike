import { haversine, type Coord } from "./geo";

export type PoiCategory = "natur" | "motorrad" | "gastro";

export interface Poi {
  id: string;
  lat: number;
  lng: number;
  name: string;
  category: PoiCategory;
  kind: string;
}

// Overpass tag filters per category (OpenStreetMap, free & key-less).
const FILTERS: Record<PoiCategory, string[]> = {
  natur: [
    '["tourism"="viewpoint"]',
    '["natural"="peak"]',
    '["natural"="saddle"]',
    '["mountain_pass"="yes"]',
    '["natural"="waterfall"]',
  ],
  motorrad: ['["amenity"="fuel"]', '["shop"="motorcycle"]'],
  gastro: ['["amenity"="restaurant"]', '["amenity"="cafe"]'],
};

const KIND_LABEL: Record<string, string> = {
  viewpoint: "Aussichtspunkt",
  peak: "Gipfel",
  saddle: "Pass",
  pass: "Pass",
  waterfall: "Wasserfall",
  fuel: "Tankstelle",
  motorcycle: "Motorrad-Shop",
  restaurant: "Restaurant",
  cafe: "Café",
};

type Tags = Record<string, string>;

function classify(tags: Tags): { category: PoiCategory; kind: string } | null {
  if (tags.tourism === "viewpoint") return { category: "natur", kind: "viewpoint" };
  if (tags.natural === "peak") return { category: "natur", kind: "peak" };
  if (tags.natural === "saddle" || tags.mountain_pass === "yes")
    return { category: "natur", kind: "saddle" };
  if (tags.natural === "waterfall") return { category: "natur", kind: "waterfall" };
  if (tags.amenity === "fuel") return { category: "motorrad", kind: "fuel" };
  if (tags.shop === "motorcycle") return { category: "motorrad", kind: "motorcycle" };
  if (tags.amenity === "restaurant") return { category: "gastro", kind: "restaurant" };
  if (tags.amenity === "cafe") return { category: "gastro", kind: "cafe" };
  return null;
}

// Reduce the route to points spaced ~stepM apart (caps query size).
function downsample(coords: Coord[], stepM: number): Coord[] {
  if (coords.length === 0) return [];
  const out: Coord[] = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversine(coords[i - 1], coords[i]);
    if (acc >= stepM) {
      out.push(coords[i]);
      acc = 0;
    }
  }
  return out;
}

export interface PoiResult {
  pois: Poi[];
  points: number; // around-polyline points used
  raw: number; // raw OSM elements returned
}

/**
 * Fetch POIs of the given categories near the route via Overpass. The route is
 * downsampled and used as the centre-line of an `around` buffer.
 */
export async function fetchPois(
  coords: Coord[],
  categories: PoiCategory[],
  signal?: AbortSignal,
): Promise<PoiResult> {
  if (coords.length < 2 || categories.length === 0) return { pois: [], points: 0, raw: 0 };

  // Keep the around-list bounded (longer routes use a bigger step).
  let totalM = 0;
  for (let i = 1; i < coords.length; i++) totalM += haversine(coords[i - 1], coords[i]);
  const step = Math.max(3000, totalM / 50);
  const pts = downsample(coords, step);
  const around = pts.map((c) => `${c[1].toFixed(5)},${c[0].toFixed(5)}`).join(",");

  const parts: string[] = [];
  for (const cat of categories) {
    for (const f of FILTERS[cat]) parts.push(`node(around:800,${around})${f};`);
  }
  const query = `[out:json][timeout:25];(${parts.join("")});out body 300;`;

  const ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  type OverpassData = {
    elements?: { id: number; lat: number; lon: number; tags?: Tags }[];
    remark?: string;
  };

  let data: OverpassData | null = null;
  let lastError = "Overpass nicht erreichbar";
  for (const url of ENDPOINTS) {
    // Hard per-server timeout so a slow mirror never hangs the UI.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 14000);
    const forward = () => ctrl.abort();
    signal?.addEventListener("abort", forward);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json()) as OverpassData;
      // Overpass reports query/timeout problems via "remark" with HTTP 200.
      if (json.remark && (!json.elements || json.elements.length === 0)) {
        lastError = json.remark.slice(0, 120);
        continue;
      }
      data = json;
      break;
    } catch (e) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      lastError = "Zeitüberschreitung";
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    }
  }
  if (!data) {
    throw new Error(lastError);
  }

  const seen = new Set<string>();
  const pois: Poi[] = [];
  const raw = (data.elements ?? []).length;
  for (const el of data.elements ?? []) {
    if (el.lat == null || el.lon == null) continue;
    const tags = el.tags ?? {};
    const c = classify(tags);
    if (!c) continue;
    const id = `n${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    pois.push({
      id,
      lat: el.lat,
      lng: el.lon,
      name: tags.name || KIND_LABEL[c.kind] || "POI",
      category: c.category,
      kind: KIND_LABEL[c.kind] || c.kind,
    });
  }
  return { pois, points: pts.length, raw };
}
