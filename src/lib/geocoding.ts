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
  county?: string;
  state?: string;
  country?: string;
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
): Promise<GeoResult[]> {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=5&lang=de`;
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
