import { computeDays, dayStats } from "./days";
import { analyse, type ElevationPoint, type RouteAnalysis } from "./analysis";
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

function svgProfile(profile: ElevationPoint[], minEle: number, maxEle: number): string {
  if (profile.length < 2) return "";
  const W = 600;
  const H = 90;
  const total = profile[profile.length - 1].km || 1;
  const span = Math.max(1, maxEle - minEle);
  const x = (km: number) => (km / total) * W;
  const y = (e: number) => H - ((e - minEle) / span) * (H - 6) - 3;
  const line = profile.map((p) => `${x(p.km).toFixed(1)},${y(p.ele).toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return `<svg class="prof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polygon points="${area}" fill="#fde6d3"/>
    <polyline points="${line}" fill="none" stroke="#ea580c" stroke-width="2"/>
  </svg>
  <div class="prof-ax"><span>${minEle} m</span><span>${maxEle} m</span></div>`;
}

function statBlock(a: RouteAnalysis): string {
  const cells: [string, string][] = [
    [a.roadKm.neben.toFixed(0), "km Landstr."],
    [a.roadKm.haupt.toFixed(0), "km Hauptstr."],
    [a.roadKm.schnell.toFixed(0), "km Schnellstr."],
    [a.roadKm.autobahn.toFixed(0), "km Autobahn"],
    [String(a.passes), "Pässe"],
    [`${a.maxEle}`, "höchster Pkt (m)"],
    [`${a.ascentM}`, "Anstieg (m)"],
    [a.cornersPerKm.toFixed(1), "Kurven/km"],
  ];
  return `<div class="stats">${cells
    .map((c) => `<div><b>${c[0]}</b><span>${c[1]}</span></div>`)
    .join("")}</div>`;
}

function ratingBlock(a: RouteAnalysis): string {
  const bar = (label: string, v: number) =>
    `<div class="rate"><span>${label}</span><span class="track"><span style="width:${v * 10}%"></span></span><b>${v.toFixed(1)}</b></div>`;
  return `
    <div class="rating">
      <div class="overall">${a.scores.overall.toFixed(1)}<small>/10</small></div>
      <div class="bars">
        ${bar("Kurven", a.scores.curves)}
        ${bar("Bergigkeit", a.scores.mountains)}
        ${bar("Landschaft", a.scores.scenic)}
      </div>
    </div>`;
}

export function openRoadbook(
  title: string,
  waypoints: Waypoint[],
  route: RouteResult,
  weather: Record<string, WeatherDay | null>,
): void {
  const days = computeDays(waypoints);
  const whole = analyse(route.geojson.features);

  const dayBlocks = days
    .map((span) => {
      const overnight = waypoints[span.endIdx];
      const isFinal = span.endIdx === waypoints.length - 1;
      const st = dayStats(span, route);
      const feats = route.geojson.features.filter((f) => {
        const i = (f.properties?.legIndex ?? -1) as number;
        return i >= span.startIdx && i < span.endIdx;
      });
      const a = analyse(feats);
      const wx = overnight.dayDate ? weather[`${overnight.id}:${overnight.dayDate}`] : null;
      const firstIdx = span.day === 1 ? span.startIdx : span.startIdx + 1;

      const rows: string[] = [];
      for (let i = firstIdx; i <= span.endIdx; i++) {
        const wp = waypoints[i];
        const leg = i > 0 ? route.legs[i - 1] : undefined;
        const legInfo = leg ? `${PROF_LABEL[wp.legProfile]} · ${leg.distanceKm.toFixed(0)} km` : "Start";
        rows.push(
          `<tr><td class="num">${i === 0 ? "S" : i === waypoints.length - 1 ? "Z" : i}</td>` +
            `<td>${esc(short(wp))}</td><td class="leg">${esc(legInfo)}</td></tr>`,
        );
      }

      return `
        <section class="day">
          <div class="dhead">
            <h2>Tag ${span.day}${overnight.dayName ? ": " + esc(overnight.dayName) : ""}</h2>
            <span class="dscore">${a.scores.overall.toFixed(1)}/10</span>
          </div>
          <p class="meta">
            ${overnight.dayDate ? fmtDate(overnight.dayDate) + " · " : ""}
            ${st.distanceKm.toFixed(0)} km · ${fmtDur(st.durationMin)} ·
            ${isFinal ? "Ziel" : "Übernachtung"}: <strong>${esc(short(overnight))}</strong>
            ${wx ? ` · Wetter ${esc(wx.label)} ${wx.tMax}°/${wx.tMin}°, ${wx.precipProb}% Regen` : ""}
          </p>
          ${statBlock(a)}
          ${a.hasElevation ? svgProfile(a.profile, a.minEle, a.maxEle) : ""}
          <table>${rows.join("")}</table>
        </section>`;
    })
    .join("");

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
  <title>${esc(title)} – Roadbook</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #111; margin: 30px; }
    h1 { font-size: 24px; margin: 0 0 2px; }
    .sub { color: #555; margin: 0 0 16px; font-size: 14px; }
    .summary { border: 1px solid #e2e2e2; border-radius: 10px; padding: 14px 16px; margin-bottom: 18px; break-inside: avoid; }
    .rating { display: flex; align-items: center; gap: 18px; margin-bottom: 12px; }
    .overall { font-size: 34px; font-weight: 800; color: #ea580c; line-height: 1; }
    .overall small { font-size: 14px; color: #999; }
    .bars { flex: 1; }
    .rate { display: flex; align-items: center; gap: 8px; font-size: 12px; margin: 3px 0; }
    .rate > span:first-child { width: 92px; color: #444; }
    .rate .track { flex: 1; height: 7px; background: #eee; border-radius: 99px; overflow: hidden; }
    .rate .track > span { display: block; height: 100%; background: linear-gradient(90deg,#ff8a1e,#f0392b); }
    .stats { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; margin: 8px 0; }
    .stats > div { text-align: center; background: #f7f7f7; border-radius: 8px; padding: 7px 4px; }
    .stats b { display: block; font-size: 15px; }
    .stats span { font-size: 10px; color: #777; }
    .prof { width: 100%; height: 90px; display: block; background: #fafafa; border-radius: 8px; margin-top: 6px; }
    .prof-ax { display: flex; justify-content: space-between; font-size: 10px; color: #999; }
    .day { break-inside: avoid; border: 1px solid #ddd; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
    .dhead { display: flex; align-items: baseline; justify-content: space-between; }
    h2 { font-size: 16px; margin: 0 0 4px; color: #c2410c; }
    .dscore { font-weight: 800; color: #ea580c; }
    .meta { font-size: 12.5px; color: #444; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    td { padding: 5px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
    td.num { width: 34px; color: #888; font-weight: 700; }
    td.leg { width: 36%; color: #666; text-align: right; white-space: nowrap; }
    .foot { margin-top: 16px; color: #999; font-size: 11px; }
    @media print { body { margin: 12mm; } }
  </style></head><body>
    <h1>${esc(title)}</h1>
    <p class="sub">${days.length} Tag${days.length === 1 ? "" : "e"} · ${route.distanceKm.toFixed(0)} km · ${fmtDur(route.durationMin)}</p>
    <div class="summary">
      ${ratingBlock(whole)}
      ${statBlock(whole)}
      ${whole.hasElevation ? svgProfile(whole.profile, whole.minEle, whole.maxEle) : ""}
    </div>
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
  setTimeout(() => w.print(), 400);
}
