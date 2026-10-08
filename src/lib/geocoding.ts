// Geocoding via Photon (komoot) – free, key-less place search with
// autocomplete, based on OpenStreetMap data. https://photon.komoot.io/
const PHOTON_URL = "https://photon.komoot.io/api/";

export interface GeoResult {
  name: string;
  lng: number;
  lat: number;
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
  type?: string;
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

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  bias?: { lat: number; lng: number },
): Promise<GeoResult[]> {
  const biasParam = bias ? `&lat=${bias.lat}&lon=${bias.lng}` : "";
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=5&lang=de${biasParam}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Ortssuche fehlgeschlagen (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as {
    features?: {
      properties?: PhotonProps;
      geometry?: { coordinates?: [number, number] };
    }[];
  };

  return (data.features ?? [])
    .filter((f) => f.geometry?.coordinates)
    .map((f) => ({
      name: buildLabel(f.properties ?? {}),
      lng: f.geometry!.coordinates![0],
      lat: f.geometry!.coordinates![1],
    }));
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
