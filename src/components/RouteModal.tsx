import { useMemo } from "react";
import ElevationChart from "./ElevationChart";
import { analyseRoute } from "../lib/analysis";
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
  if (score >= 8) return "Top-Motorradstrecke";
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

export default function RouteModal({ waypoints, route, onClose }: Props) {
  const analysis = useMemo(() => analyseRoute(route), [route]);
  const days = useMemo(() => computeDays(waypoints), [waypoints]);

  const exportWhole = () => {
    const gpx = buildGpx("Motorradtour", waypoints, route.geojson.features);
    downloadGpx("motorradtour", gpx);
  };

  const exportDay = (startIdx: number, endIdx: number, day: number) => {
    const features = route.geojson.features.filter((f) => {
      const i = (f.properties?.legIndex ?? -1) as number;
      return i >= startIdx && i < endIdx;
    });
    const wps = waypoints.slice(startIdx, endIdx + 1);
    downloadGpx(`tag-${day}`, buildGpx(`Tag ${day}`, wps, features));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Routen-Details</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-summary">
            {days.length > 1 && <strong>{days.length} Tage · </strong>}
            <strong>{route.distanceKm.toFixed(1)} km</strong> ·{" "}
            <strong>{formatDuration(route.durationMin)}</strong>
          </p>

          {/* Quality ranking (computed heuristic) */}
          <section className="modal-section">
            <h3>
              Bewertung <span className="overall">{analysis.scores.overall}/10</span>
            </h3>
            <p className="rating-label">{ratingLabel(analysis.scores.overall)}</p>
            <ScoreBar label="Kurvenreichtum" value={analysis.scores.curves} />
            <ScoreBar label="Höhenmeter / Bergigkeit" value={analysis.scores.climb} />
            <p className="modal-note">
              Berechnete Einschätzung aus Kurvendichte ({analysis.curvatureDegPerKm}°/km)
              und Höhenprofil – kein externes Rating. Sehenswürdigkeiten fließen
              später mit ein.
            </p>
          </section>

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
                ↗ {analysis.ascentM} m · ↘ {analysis.descentM} m · höchster Punkt{" "}
                {analysis.maxEle} m
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
