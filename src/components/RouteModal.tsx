import { useMemo } from "react";
import ElevationChart from "./ElevationChart";
import { analyse, type RouteAnalysis } from "../lib/analysis";
import { buildGpx, downloadGpx } from "../lib/gpx";
import { computeDays, dayStats } from "../lib/days";
import type { RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  route: RouteResult;
  onClose: () => void;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function ratingLabel(score: number): string {
  if (score >= 8) return "Traumstrecke";
  if (score >= 6) return "Sehr reizvoll";
  if (score >= 4) return "Solide";
  return "Eher Verbindungsstrecke";
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <span className="score-track">
        <span className="score-fill" style={{ width: `${value * 10}%` }} />
      </span>
      <span className="score-val">{value.toFixed(1)}</span>
    </div>
  );
}

function placeName(wp: Waypoint): string {
  return wp.name ?? `${wp.lat.toFixed(3)}, ${wp.lng.toFixed(3)}`;
}

export default function RouteModal({ waypoints, route, onClose }: Props) {
  const analysis = useMemo(() => analyse(route.geojson.features), [route]);
  const days = useMemo(() => computeDays(waypoints), [waypoints]);

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

  const exportWhole = () => {
    downloadGpx("motorradtour", buildGpx("Motorradtour", waypoints, route.geojson.features));
  };

  const exportDay = (startIdx: number, endIdx: number, day: number) => {
    const features = route.geojson.features.filter((f) => {
      const i = (f.properties?.legIndex ?? -1) as number;
      return i >= startIdx && i < endIdx;
    });
    const wps = waypoints.slice(startIdx, endIdx + 1);
    downloadGpx(`tag-${day}`, buildGpx(`Tag ${day}`, wps, features));
  };

  const stats = (a: RouteAnalysis) => (
    <div className="stat-grid">
      <div className="stat">
        <span className="stat-val">{a.roadKm.autobahn.toFixed(0)}</span>
        <span className="stat-lbl">km Autobahn</span>
      </div>
      <div className="stat">
        <span className="stat-val">{a.roadKm.schnell.toFixed(0)}</span>
        <span className="stat-lbl">km Schnellstr.</span>
      </div>
      <div className="stat">
        <span className="stat-val">{a.roadKm.neben.toFixed(0)}</span>
        <span className="stat-lbl">km Nebenstr.</span>
      </div>
      <div className="stat">
        <span className="stat-val">{a.passes}</span>
        <span className="stat-lbl">Pässe</span>
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Routen-Details</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        <div className="modal-body">
          <p className="modal-summary">
            {days.length > 1 && <strong>{days.length} Tage · </strong>}
            <strong>{route.distanceKm.toFixed(1)} km</strong> ·{" "}
            <strong>{formatDuration(route.durationMin)}</strong>
          </p>

          {/* Overall rating */}
          <section className="modal-section">
            <h3>
              Bewertung <span className="overall">{analysis.scores.overall}/10</span>
            </h3>
            <p className="rating-label">{ratingLabel(analysis.scores.overall)}</p>
            <ScoreBar label="Attraktivität der Strecke" value={analysis.scores.attractiveness} />
            <ScoreBar label="Höhenmeter / Bergigkeit" value={analysis.scores.bergigkeit} />
            <p className="modal-note">
              Attraktivität = Anteil kleiner Straßen + Kurvendichte ({analysis.cornersPerKm}/km),
              abzüglich Autobahnanteil. Bergigkeit aus Passhöhe, Anzahl Pässe und Höhenmetern.
            </p>
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

          {/* Per-day rating */}
          {days.length > 1 && (
            <section className="modal-section">
              <h3>Pro Tag</h3>
              {dayAnalyses.map(({ span, a, overnight }) => (
                <div className="day-rating" key={span.day}>
                  <div className="day-rating-head">
                    <strong>Tag {span.day}</strong>
                    <span className="day-rating-dest">→ {placeName(overnight)}</span>
                    <span className="day-rating-score">{a.scores.overall}/10</span>
                  </div>
                  <div className="day-rating-meta">
                    {dayStats(span, route).distanceKm.toFixed(0)} km · Attraktivität{" "}
                    {a.scores.attractiveness} · Bergigkeit {a.scores.bergigkeit} · {a.passes} Pässe
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Elevation profile */}
          <section className="modal-section">
            <h3>Höhenprofil</h3>
            <ElevationChart
              profile={analysis.profile}
              minEle={analysis.minEle}
              maxEle={analysis.maxEle}
            />
            {analysis.hasElevation && (
              <p className="elev-stats">
                ↗ {analysis.ascentM} m · ↘ {analysis.descentM} m · höchster Punkt {analysis.maxEle} m
              </p>
            )}
          </section>

          {/* Export */}
          <section className="modal-section">
            <h3>Export fürs Navi (GPX)</h3>
            <button className="export-btn primary" onClick={exportWhole}>
              ⬇ Gesamte Tour (GPX)
            </button>
            {days.length > 1 && (
              <div className="export-days">
                {days.map((d) => (
                  <button
                    key={d.day}
                    className="export-btn"
                    onClick={() => exportDay(d.startIdx, d.endIdx, d.day)}
                  >
                    Tag {d.day} ({dayStats(d, route).distanceKm.toFixed(0)} km)
                  </button>
                ))}
              </div>
            )}
            <p className="modal-note">
              GPX funktioniert mit Garmin, TomTom, calimoto, kurviger, OsmAnd u. a.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
