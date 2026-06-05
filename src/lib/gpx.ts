import { haversine, type Coord } from "./geo";
import type { Waypoint } from "../types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectCoords(features: GeoJSON.Feature[]): Coord[] {
  const coords: Coord[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type !== "LineString") continue;
    for (const c of g.coordinates) {
      const last = coords[coords.length - 1];
      if (last && last[0] === c[0] && last[1] === c[1]) continue;
      coords.push(c);
    }
  }
  return coords;
}

// Keep points at least `minGap` metres apart (reduces a dense track to a
// route of manageable size for navigation apps).
function thin(coords: Coord[], minGap: number): Coord[] {
  if (coords.length === 0) return coords;
  const out: Coord[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (haversine(out[out.length - 1], coords[i]) >= minGap) out.push(coords[i]);
  }
  const last = coords[coords.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function pt(tag: string, c: Coord): string {
  const ele = c.length > 2 ? `<ele>${c[2].toFixed(1)}</ele>` : "";
  return `<${tag} lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${ele}</${tag}>`;
}

export type GpxMode = "track" | "route";

/**
 * Build a GPX 1.1 document.
 * - "track": the exact line as a <trk> (precise, but some nav apps can't
 *   derive turn instructions from it).
 * - "route": a <rte> of shaping points (~250 m apart) that navigation apps
 *   (Beeline, Garmin …) snap to roads and turn into turn-by-turn directions.
 */
export function buildGpx(
  name: string,
  waypoints: Waypoint[],
  features: GeoJSON.Feature[],
  mode: GpxMode = "route",
): string {
  const wpts = waypoints
    .map((w, i) => {
      const label = w.name?.split(",")[0].trim() ?? `Punkt ${i + 1}`;
      return `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lng.toFixed(6)}"><name>${esc(label)}</name></wpt>`;
    })
    .join("\n");

  const coords = collectCoords(features);

  let body: string;
  if (mode === "route") {
    const pts = thin(coords, 250)
      .map((c) => "    " + pt("rtept", c))
      .join("\n");
    body = `  <rte><name>${esc(name)}</name>\n${pts}\n  </rte>`;
  } else {
    const pts = coords.map((c) => "      " + pt("trkpt", c)).join("\n");
    body = `  <trk><name>${esc(name)}</name><trkseg>\n${pts}\n  </trkseg></trk>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Motorbike Routenplaner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
${wpts}
${body}
</gpx>
`;
}

/** Trigger a browser download of the given text as a .gpx file. */
export function downloadGpx(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".gpx") ? filename : `${filename}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
