import type { Waypoint } from "../types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a GPX 1.1 document containing the given waypoints (as <wpt>) and the
 * given leg geometries as a single track. Works for the whole tour or one day
 * (pass that day's waypoints + leg features).
 */
export function buildGpx(
  name: string,
  waypoints: Waypoint[],
  features: GeoJSON.Feature[],
): string {
  const wpts = waypoints
    .map((w, i) => {
      const label = w.name ?? `Punkt ${i + 1}`;
      return `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lng.toFixed(6)}"><name>${esc(label)}</name></wpt>`;
    })
    .join("\n");

  const trkpts: string[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type !== "LineString") continue;
    for (const c of g.coordinates) {
      const ele = c.length > 2 ? `<ele>${c[2].toFixed(1)}</ele>` : "";
      trkpts.push(
        `      <trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${ele}</trkpt>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Motorbike Routenplaner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
${wpts}
  <trk><name>${esc(name)}</name><trkseg>
${trkpts.join("\n")}
  </trkseg></trk>
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
