// Geocoding via Photon (komoot) – free, key-less place search with
// autocomplete, based on OpenStreetMap data. https://photon.komoot.io/
const PHOTON_URL = "https://photon.komoot.io/api/";

export interface GeoResult {
  name: string;
  lng: number;
  lat: number;
  // What the hit is ("Pass", "Ort", "Strasse" …), shown next to the name in
  // the result list. Not part of the waypoint name.
  kind?: string;
}

interface PhotonProps {
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
}

interface PhotonFeature {
  properties?: PhotonProps;
  geometry?: { coordinates?: [number, number] };
}

// OSM features nobody rides to: info boards, guideposts, land use areas
// (military grounds, forests), railway and power infrastructure. They crowd
// out the useful hits ("Monte Ceneri" returns two info boards).
const NOT_A_DESTINATION = new Set(["information", "landuse", "railway", "power", "man_made", "emergency", "barrier", "military"]);

// Short kind label per OSM tag, so four "Monte Ceneri, Tessin, Schweiz" can
// be told apart (pass, camping, tunnel …).
function kindOf(p: PhotonProps): string | undefined {
  const k = p.osm_key ?? "";
  const v = p.osm_value ?? "";
  if (k === "mountain_pass" || (k === "natural" && v === "saddle")) return "Pass";
  if (k === "place") {
    if (v === "city" || v === "town") return "Stadt";
    if (["state", "region", "province", "county", "district"].includes(v)) return "Region";
    if (v === "country") return "Land";
    return "Ort";
  }
  if (k === "boundary") return "Gemeinde";
  if (k === "highway") return "Strasse";
  if (k === "tunnel") return "Tunnel";
  if (k === "natural" && v === "peak") return "Gipfel";
  if (k === "tourism") {
    if (v === "caravan_site" || v === "camp_site") return "Camping";
    if (["hotel", "motel", "guest_house", "hostel", "chalet", "apartment"].includes(v)) return "Unterkunft";
    if (v === "viewpoint") return "Aussicht";
    return undefined;
  }
  if (k === "amenity") {
    if (v === "restaurant") return "Restaurant";
    if (v === "cafe") return "Café";
    if (v === "fuel") return "Tankstelle";
    if (v === "parking") return "Parkplatz";
  }
  return undefined;
}

// Same label and kind within this distance → one hit (e.g. both portals of
// a tunnel, or a pass node and its saddle).
const DUPLICATE_M = 1500;

function roughMetres(a: GeoResult, b: GeoResult): number {
  const dx = (a.lng - b.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

/**
 * Turn Photon features into result rows: drop what can't be a destination,
 * label each hit with its kind and merge near-identical duplicates. Keeps
 * Photon's ranking otherwise.
 */
export function toResults(features: PhotonFeature[], max = 6): GeoResult[] {
  const out: GeoResult[] = [];
  for (const f of features) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || NOT_A_DESTINATION.has(p.osm_key ?? "")) continue;
    const r: GeoResult = { name: buildLabel(p), lng: c[0], lat: c[1], kind: kindOf(p) };
    if (!r.name) continue;
    const dup = out.some((o) => o.name === r.name && o.kind === r.kind && roughMetres(o, r) < DUPLICATE_M);
    if (dup) continue;
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

function buildLabel(p: PhotonProps): string {
  const primary =
    p.name ||
    [p.street, p.housenumber].filter(Boolean).join(" ") ||
    p.city ||
    p.county ||
    "";
  const parts = [primary, p.city, p.state, p.country].filter(Boolean) as string[];
  // De-duplicate while preserving order (e.g. city === name).
  return Array.from(new Set(parts)).join(", ");
}

/**
 * What Enter does in a place field. The result list lags behind the typing
 * (debounce + network), so a list may still belong to an older, shorter
 * input: "Monte Ce" lists "Monte Cerignone, Marken" first. Taking its first
 * hit would put a wrong place into the tour; search the current text instead.
 * A hit the rider highlighted with the arrow keys was seen and is taken.
 */
export function enterAction(s: {
  active: number;
  count: number;
  resultsFor: string;
  query: string;
}): "pick-active" | "pick-first" | "search-now" | "none" {
  if (s.active >= 0 && s.active < s.count) return "pick-active";
  const q = s.query.trim();
  if (q.length < 3) return "none";
  if (s.count > 0 && s.resultsFor === q) return "pick-first";
  return "search-now";
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  bias?: { lat: number; lng: number },
): Promise<GeoResult[]> {
  const biasParam = bias ? `&lat=${bias.lat}&lon=${bias.lng}` : "";
  // Ask for more than we show: filtering and merging duplicates thin it out.
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=12&lang=de${biasParam}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Ortssuche fehlgeschlagen (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { features?: PhotonFeature[] };
  return toResults(data.features ?? []);
}

/**
 * Nearest place name for a coordinate (Photon reverse geocoding). Used to
 * name points the Tour-Genius placed on the map. Null when nothing sensible
 * comes back; the caller then keeps showing the coordinates.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${PHOTON_URL.replace(/\/api\/$/, "/reverse")}?lat=${lat}&lon=${lng}&lang=de&limit=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: { properties?: PhotonProps }[] };
  return reverseLabel(data.features?.[0]?.properties ?? {});
}

/**
 * Label for a reverse-geocoded point. The nearest OSM feature to a point on
 * the road is often a house; a via point is then named after the village,
 * not after "Gotthardstrasse 32". Named places (a pass, a hamlet) win.
 */
export function reverseLabel(p: PhotonProps): string | null {
  const isAddress = p.osm_key === "building" || p.type === "house" || !!p.housenumber;
  const primary = isAddress ? p.city || p.district || p.county : p.name || p.city || p.district || p.county;
  if (!primary) return null;
  const parts = [primary, p.state, p.country].filter(Boolean) as string[];
  return Array.from(new Set(parts)).join(", ");
}
