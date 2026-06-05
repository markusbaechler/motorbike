import { useMemo, useState } from "react";
import Icon from "./Icon";
import ElevationChart from "./ElevationChart";
import { analyse, type RouteAnalysis } from "../lib/analysis";
import { buildGpx, downloadGpx } from "../lib/gpx";
import { openRoadbook } from "../lib/roadbook";
import { prefetchRouteTiles } from "../lib/offline";
import { MAP_STYLE_URL } from "../config";
import { computeDays, dayStats } from "../lib/days";
import type { WeatherDay } from "../lib/weather";
import type { RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  route: RouteResult;
  weather: Record<string, WeatherDay | null>;
  onClose: () => void;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function ratingLabel(score: number): string {
  if (score >= 8) return "Traumstrecke";
  if (score >= 6.5) return "Sehr reizvoll";
  if (score >= 5) return "Reizvoll";
  if (score >= 3.5) return "Solide";
  return "Verbindungsstrecke";
}

function placeName(wp: Waypoint): string {
  const n = wp.name ?? `${wp.lat.toFixed(3)}, ${wp.lng.toFixed(3)}`;
  return n.split(",")[0].trim();
}

// Circular gauge for the overall score.
function Gauge({ value }: { value: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / 10));
  return (
    <div className="gauge">
      <svg viewBox="0 0 130 130" width="130" height="130">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-from)" />
            <stop offset="100%" stopColor="var(--brand-to)" />
          </linearGradient>
        </defs>
        <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="11" />
        <circle
          cx="65"
          cy="65"
          r={r}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform="rotate(-90 65 65)"
        />
      </svg>
      <div className="gauge-center">
        <span className="gauge-val">{value.toFixed(1)}</span>
        <span className="gauge-max">/10</span>
      </div>
    </div>
  );
}

function ScoreBar({ icon, label, value }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; value: number }) {
  return (
    <div className="score-row">
      <span className="score-icon"><Icon name={icon} size={16} /></span>
      <span className="score-label">{label}</span>
      <span className="score-track">
        <span className="score-fill" style={{ width: `${value * 10}%` }} />
      </span>
      <span className="score-val">{value.toFixed(1)}</span>
    </div>
  );
}

export default function RouteModal({ waypoints, route, weather, onClose }: Props) {
  const analysis = useMemo(() => analyse(route.geojson.features), [route]);
  const days = useMemo(() => computeDays(waypoints), [waypoints]);
  const multiDay = days.length > 1;
  const [showWhole, setShowWhole] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [offline, setOffline] = useState<{ running: boolean; done: number; total: number; msg: string }>({
    running: false,
    done: 0,
    total: 0,
    msg: "",
  });

  const runPrefetch = async () => {
    const coords: number[][] = [];
    for (const f of route.geojson.features) {
      if (f.geometry.type === "LineString") for (const c of f.geometry.coordinates) coords.push(c);
    }
    setOffline({ running: true, done: 0, total: 0, msg: "Bereite vor …" });
    try {
      const r = await prefetchRouteTiles(MAP_STYLE_URL, coords, (p) =>
        setOffline({ running: true, done: p.done, total: p.total, msg: "" }),
      );
      setOffline({
        running: false,
        done: r.cached,
        total: r.cached,
        msg: `${r.cached} Kacheln offline gespeichert${r.capped ? " (Limit erreicht – Detailzoom teils gekürzt)" : ""}.`,
      });
    } catch (e) {
      setOffline({ running: false, done: 0, total: 0, msg: "Fehler: " + (e as Error).message });
    }
  };

  const dayAnalyses = useMemo(
    () =>
      days.map((d) => {
        const feats = route.geojson.features.filter((f) => {
          const i = (f.properties?.legIndex ?? -1) as number;
          return i >= d.startIdx && i < d.endIdx;
        });
        return { span: d, a: analyse(feats), overnight: waypoints[d.endIdx] };
      }),
    [days, route, waypoints],
  );

  const exportWhole = (mode: "waypoints" | "route" | "track") =>
    downloadGpx("motorradtour", buildGpx("Motorradtour", waypoints, route.geojson.features, mode));

  const exportDay = (startIdx: number, endIdx: number, day: number) => {
    const features = route.geojson.features.filter((f) => {
      const i = (f.properties?.legIndex ?? -1) as number;
      return i >= startIdx && i < endIdx;
    });
    downloadGpx(`tag-${day}`, buildGpx(`Tag ${day}`, waypoints.slice(startIdx, endIdx + 1), features, "route"));
  };

  const stats = (a: RouteAnalysis) => {
    const items: [string, string][] = [
      [a.roadKm.neben.toFixed(0), "km Landstr."],
      [a.roadKm.haupt.toFixed(0), "km Hauptstr."],
      [a.roadKm.schnell.toFixed(0), "km Schnellstr."],
      [a.roadKm.autobahn.toFixed(0), "km Autobahn"],
      [String(a.passes), "Pässe"],
      [`${a.maxEle}`, "höchster Pkt (m)"],
      [`${a.ascentM}`, "Anstieg (m)"],
      [a.cornersPerKm.toFixed(1), "Kurven / km"],
    ];
    return (
      <div className="stat-grid">
        {items.map(([v, l]) => (
          <div className="stat" key={l}>
            <span className="stat-val">{v}</span>
            <span className="stat-lbl">{l}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Routen-Details</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Hero rating */}
          <section className="rating-hero">
            <Gauge value={analysis.scores.overall} />
            <div className="rating-hero-info">
              <span className="rating-badge">{ratingLabel(analysis.scores.overall)}</span>
              <p className="rating-summary">
                {multiDay && <strong>{days.length} Tage · </strong>}
                <strong>{route.distanceKm.toFixed(0)} km</strong> ·{" "}
                <strong>{formatDuration(route.durationMin)}</strong>
              </p>
              <button className="info-link" onClick={() => setShowInfo(true)}>
                <Icon name="info" size={15} /> Wie wird bewertet?
              </button>
            </div>
          </section>

          {/* Criteria */}
          <section className="modal-section card">
            <ScoreBar icon="zap" label="Kurvenreichtum" value={analysis.scores.curves} />
            <ScoreBar icon="flag" label="Bergigkeit & Pässe" value={analysis.scores.mountains} />
            <ScoreBar icon="chart" label="Landschaft (kleine Straßen)" value={analysis.scores.scenic} />
          </section>

          {/* Statistics */}
          <section className="modal-section">
            <h3>Statistik</h3>
            {analysis.hasRoadData ? (
              stats(analysis)
            ) : (
              <p className="modal-note">Straßentyp-Daten für diese Route nicht verfügbar.</p>
            )}
          </section>

          {/* Per-day */}
          {multiDay && (
            <section className="modal-section">
              <h3>Pro Tag</h3>
              {dayAnalyses.map(({ span, a, overnight }) => (
                <div className="day-rating card" key={span.day}>
                  <div className="day-rating-head">
                    <span className="day-rating-score">{a.scores.overall.toFixed(1)}</span>
                    <div className="day-rating-text">
                      <strong>
                        Tag {span.day}
                        {overnight.dayName ? `: ${overnight.dayName}` : ""}
                      </strong>
                      <span className="day-rating-dest">→ {placeName(overnight)}</span>
                    </div>
                  </div>
                  <div className="day-rating-meta">
                    {dayStats(span, route).distanceKm.toFixed(0)} km · Kurven {a.scores.curves} ·
                    Berg {a.scores.mountains} · {a.passes} Pässe
                  </div>
                  <ElevationChart profile={a.profile} minEle={a.minEle} maxEle={a.maxEle} />
                </div>
              ))}
            </section>
          )}

          {/* Whole-tour elevation */}
          {!multiDay ? (
            <section className="modal-section">
              <h3>Höhenprofil</h3>
              <ElevationChart profile={analysis.profile} minEle={analysis.minEle} maxEle={analysis.maxEle} />
              {analysis.hasElevation && (
                <p className="elev-stats">
                  ↗ {analysis.ascentM} m · ↘ {analysis.descentM} m · höchster Punkt {analysis.maxEle} m
                </p>
              )}
            </section>
          ) : (
            <section className="modal-section">
              <button className="export-btn" style={{ width: "100%" }} onClick={() => setShowWhole((v) => !v)}>
                {showWhole ? "Gesamtprofil ausblenden" : "Gesamtprofil der Tour anzeigen"}
              </button>
              {showWhole && (
                <ElevationChart profile={analysis.profile} minEle={analysis.minEle} maxEle={analysis.maxEle} />
              )}
            </section>
          )}

          {/* Roadbook */}
          <section className="modal-section">
            <h3>Roadbook</h3>
            <button
              className="export-btn"
              style={{ width: "100%" }}
              onClick={() => openRoadbook("Motorradtour", waypoints, route, weather)}
            >
              <Icon name="chart" size={16} /> Roadbook drucken / als PDF
            </button>
            <p className="modal-note">
              Druckfertige Tagesübersicht (Etappen, Zeiten, Übernachtung, Wetter). Im
              Druckdialog „Als PDF speichern" wählen.
            </p>
          </section>

          {/* Offline maps */}
          <section className="modal-section">
            <h3>Offline-Karten</h3>
            <button
              className="export-btn"
              style={{ width: "100%" }}
              disabled={offline.running}
              onClick={runPrefetch}
            >
              <Icon name="download" size={16} />{" "}
              {offline.running
                ? `Lädt … ${offline.done}/${offline.total || "…"}`
                : "Karten dieser Route offline laden"}
            </button>
            {offline.msg && <p className="modal-note">{offline.msg}</p>}
            <p className="modal-note">
              Lädt die Kacheln entlang der Strecke in den Cache – danach ist die Route
              auch ohne Empfang sichtbar. (Routing/Wetter brauchen weiterhin Internet.)
            </p>
          </section>

          {/* Export */}
          <section className="modal-section">
            <h3>Export fürs Navi (GPX)</h3>
            <button className="export-btn primary" onClick={() => exportWhole("waypoints")}>
              <Icon name="download" size={17} /> Beeline-Route (saubere Abbiegehinweise)
            </button>
            <button className="export-btn" style={{ width: "100%", marginTop: 8 }} onClick={() => exportWhole("route")}>
              <Icon name="download" size={16} /> Detail-Route (folgt unserer Linie)
            </button>
            <button className="export-btn" style={{ width: "100%", marginTop: 8 }} onClick={() => exportWhole("track")}>
              <Icon name="download" size={16} /> Track (exakte Linie)
            </button>
            {multiDay && (
              <div className="export-days">
                {days.map((d) => (
                  <button key={d.day} className="export-btn" onClick={() => exportDay(d.startIdx, d.endIdx, d.day)}>
                    Tag {d.day} ({dayStats(d, route).distanceKm.toFixed(0)} km)
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Criteria explanation popup */}
      {showInfo && (
        <div className="modal-backdrop info-backdrop" onClick={(e) => { e.stopPropagation(); setShowInfo(false); }}>
          <div className="modal info-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>So wird bewertet</h2>
              <button className="modal-close" onClick={() => setShowInfo(false)} aria-label="Schließen">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="modal-body">
              <ul className="info-list">
                <li><strong>Gesamt</strong> = Kurven 40 % + Bergigkeit 30 % + Landschaft 30 %.</li>
                <li><strong>Kurvenreichtum</strong>: echte Richtungswechsel ({">"}25°) pro km. Schon ~2 Kurven/km = Maximum.</li>
                <li><strong>Bergigkeit & Pässe</strong>: höchster Punkt (Passhöhe), Anzahl Pässe und Höhenmeter pro km.</li>
                <li><strong>Landschaft</strong>: Anteil kleiner Neben-/Landstraßen, abzüglich Autobahnanteil.</li>
              </ul>
              <p className="modal-note">
                Es handelt sich um eine berechnete Einschätzung aus Geometrie, Höhenprofil und
                Straßentypen – kein externes Landschafts-Rating.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
