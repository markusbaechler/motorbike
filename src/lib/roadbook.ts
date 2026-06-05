import { computeDays, dayStats } from "./days";
import type { RouteResult, RouteProfile, Waypoint } from "../types";
import type { WeatherDay } from "./weather";

const PROF_LABEL: Record<RouteProfile, string> = {
  kurvig: "Fun 1",
  kurvig_plus: "Fun 2",
  schnell: "Schnell",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("de-CH");
}
function short(wp: Waypoint): string {
  return (wp.name ?? `${wp.lat.toFixed(3)}, ${wp.lng.toFixed(3)}`).split(",")[0].trim();
}

export function openRoadbook(
  title: string,
  waypoints: Waypoint[],
  route: RouteResult,
  weather: Record<string, WeatherDay | null>,
): void {
  const days = computeDays(waypoints);
  const totalKm = route.distanceKm.toFixed(0);
  const totalTime = fmtDur(route.durationMin);

  const dayBlocks = days
    .map((span) => {
      const overnight = waypoints[span.endIdx];
      const isFinal = span.endIdx === waypoints.length - 1;
      const st = dayStats(span, route);
      const wx = overnight.dayDate ? weather[`${overnight.id}:${overnight.dayDate}`] : null;
      const firstIdx = span.day === 1 ? span.startIdx : span.startIdx + 1;

      const rows: string[] = [];
      for (let i = firstIdx; i <= span.endIdx; i++) {
        const wp = waypoints[i];
        const leg = i > 0 ? route.legs[i - 1] : undefined;
        const legInfo = leg
          ? `${PROF_LABEL[wp.legProfile]} · ${leg.distanceKm.toFixed(0)} km`
          : "Start";
        rows.push(
          `<tr><td class="num">${i === 0 ? "Start" : i === waypoints.length - 1 ? "Ziel" : i}</td>` +
            `<td>${esc(short(wp))}</td><td class="leg">${esc(legInfo)}</td></tr>`,
        );
      }

      return `
        <section class="day">
          <h2>Tag ${span.day}${overnight.dayName ? ": " + esc(overnight.dayName) : ""}</h2>
          <p class="meta">
            ${overnight.dayDate ? fmtDate(overnight.dayDate) + " · " : ""}
            ${st.distanceKm.toFixed(0)} km · ${fmtDur(st.durationMin)} ·
            ${isFinal ? "Ziel" : "Übernachtung"}: <strong>${esc(short(overnight))}</strong>
            ${wx ? ` · Wetter: ${esc(wx.label)} ${wx.tMax}°/${wx.tMin}°, ${wx.precipProb}% Regen` : ""}
          </p>
          <table>${rows.join("")}</table>
        </section>`;
    })
    .join("");

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
  <title>${esc(title)} – Roadbook</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #111; margin: 32px; }
    h1 { font-size: 24px; margin: 0 0 2px; }
    .sub { color: #555; margin: 0 0 20px; font-size: 14px; }
    .day { break-inside: avoid; border: 1px solid #ddd; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
    h2 { font-size: 16px; margin: 0 0 4px; color: #c2410c; }
    .meta { font-size: 12.5px; color: #444; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td { padding: 5px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
    td.num { width: 46px; color: #888; font-weight: 700; }
    td.leg { width: 38%; color: #666; text-align: right; white-space: nowrap; }
    .foot { margin-top: 18px; color: #999; font-size: 11px; }
    @media print { body { margin: 12mm; } .day { border-color: #ccc; } }
  </style></head><body>
    <h1>${esc(title)}</h1>
    <p class="sub">${days.length} Tag${days.length === 1 ? "" : "e"} · ${totalKm} km · ${totalTime}</p>
    ${dayBlocks}
    <p class="foot">Erstellt mit Motorbike Routenplaner</p>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Bitte Pop-ups erlauben, um das Roadbook zu drucken.");
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}
