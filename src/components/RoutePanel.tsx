import { useState } from "react";
import { computeDays, dayStats } from "../lib/days";
import type { RouteProfile, RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  defaultProfile: RouteProfile;
  route: RouteResult | null;
  loading: boolean;
  error: string | null;
  pendingDay: boolean;
  onOpenDetails: () => void;
  onOpenQuickPlan: () => void;
  onDefaultProfileChange: (p: RouteProfile) => void;
  onSetLegProfile: (waypointId: string, p: RouteProfile) => void;
  onToggleDayEnd: (id: string) => void;
  onAddDay: () => void;
  onRemoveWaypoint: (id: string) => void;
  onReorderWaypoint: (id: string, direction: -1 | 1) => void;
  onClear: () => void;
}

const PROFILE_LABEL: Record<RouteProfile, string> = {
  kurvig: "Kurvig",
  kurvig_plus: "Kurvig+",
  schnell: "Schnell",
};

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function placeName(wp: Waypoint): string {
  return wp.name ?? `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`;
}

function ProfileToggle({
  value,
  onChange,
}: {
  value: RouteProfile;
  onChange: (p: RouteProfile) => void;
}) {
  return (
    <span className="toggle">
      {(["kurvig", "kurvig_plus", "schnell"] as RouteProfile[]).map((p) => (
        <button
          key={p}
          className={`toggle-btn ${value === p ? "active" : ""} ${p}`}
          onClick={() => onChange(p)}
        >
          {PROFILE_LABEL[p]}
        </button>
      ))}
    </span>
  );
}

export default function RoutePanel({
  waypoints,
  defaultProfile,
  route,
  loading,
  error,
  pendingDay,
  onOpenDetails,
  onOpenQuickPlan,
  onDefaultProfileChange,
  onSetLegProfile,
  onToggleDayEnd,
  onAddDay,
  onRemoveWaypoint,
  onReorderWaypoint,
  onClear,
}: Props) {
  const days = computeDays(waypoints);

  // Collapse inactive days by default; only the last (active) day is open.
  // The user can toggle any day open/closed.
  const [openOverrides, setOpenOverrides] = useState<Record<number, boolean>>({});
  const lastDay = days.length;
  const isDayOpen = (d: number) => openOverrides[d] ?? d === lastDay;
  const toggleDay = (d: number) =>
    setOpenOverrides((o) => ({ ...o, [d]: !isDayOpen(d) }));

  const renderWaypoint = (i: number) => {
    const wp = waypoints[i];
    const leg = i > 0 ? route?.legs[i - 1] : undefined;
    const isLast = i === waypoints.length - 1;
    return (
      <li key={wp.id} className="wp-item">
        {i > 0 && (
          <div className="segment">
            <span className="segment-arrow">↳ Etappe {i}→{i + 1}</span>
            <ProfileToggle
              value={wp.legProfile}
              onChange={(p) => onSetLegProfile(wp.id, p)}
            />
            {leg && <span className="segment-stats">{leg.distanceKm.toFixed(0)} km</span>}
          </div>
        )}

        <div className="wp-row">
          <span
            className="wp-dot"
            data-role={i === 0 ? "start" : isLast ? "end" : "via"}
          >
            {i + 1}
          </span>
          <span className="wp-name">
            {placeName(wp)}
            {wp.dayEnd && <span className="bed-tag" title="Übernachtung">🛏</span>}
          </span>
          <span className="wp-actions">
            {i > 0 && !isLast && (
              <button
                className={`wp-btn bed ${wp.dayEnd ? "active" : ""}`}
                onClick={() => onToggleDayEnd(wp.id)}
                aria-label="Übernachtung / Tagesende"
                title="Hier übernachten (Tag beenden)"
              >
                🛏
              </button>
            )}
            <button
              className="wp-btn"
              disabled={i === 0}
              onClick={() => onReorderWaypoint(wp.id, -1)}
              aria-label="Nach oben"
            >
              ↑
            </button>
            <button
              className="wp-btn"
              disabled={isLast}
              onClick={() => onReorderWaypoint(wp.id, 1)}
              aria-label="Nach unten"
            >
              ↓
            </button>
            <button
              className="wp-btn remove"
              onClick={() => onRemoveWaypoint(wp.id)}
              aria-label="Entfernen"
            >
              ✕
            </button>
          </span>
        </div>
      </li>
    );
  };

  return (
    <div className="panel">
      <div className="panel-row top">
        <button className="quickplan-btn" onClick={onOpenQuickPlan}>
          ⚡ Schnell planen
        </button>
        <span className="default-label">Neue Etappe:</span>
        <ProfileToggle value={defaultProfile} onChange={onDefaultProfileChange} />
        {waypoints.length > 0 && (
          <button className="clear-btn" onClick={onClear}>
            Zurücksetzen
          </button>
        )}
      </div>

      <div className="panel-row summary">
        {waypoints.length === 0 && (
          <span className="hint">
            Ort suchen oder auf die Karte tippen, um Start, Stopps und Ziel zu setzen.
          </span>
        )}
        {waypoints.length === 1 && (
          <span className="hint">Nächsten Punkt setzen, um die Route zu berechnen.</span>
        )}
        {loading && <span className="hint">Route wird berechnet …</span>}
        {error && <span className="error">⚠ {error}</span>}
        {route && !loading && !error && (
          <span className="stats">
            {days.length > 1 && <strong>{days.length} Tage</strong>}
            {days.length > 1 && <span className="dot">·</span>}
            <strong>{route.distanceKm.toFixed(1)} km</strong>
            <span className="dot">·</span>
            <strong>{formatDuration(route.durationMin)}</strong>
            <button className="details-btn" onClick={onOpenDetails}>
              📊 Details &amp; Export
            </button>
          </span>
        )}
      </div>

      {days.length > 0 ? (
        days.map((span) => {
          const stats = dayStats(span, route);
          const overnight = waypoints[span.endIdx];
          const isFinalDay = span.endIdx === waypoints.length - 1;
          // Day 1 shows its start; later days start from the shared overnight
          // point of the previous day, so skip rendering it again.
          const firstIdx = span.day === 1 ? span.startIdx : span.startIdx + 1;
          const indices: number[] = [];
          for (let i = firstIdx; i <= span.endIdx; i++) indices.push(i);

          const open = isDayOpen(span.day);
          return (
            <div key={span.day} className={`day-group ${open ? "" : "collapsed"}`}>
              <button
                className="day-header"
                onClick={() => toggleDay(span.day)}
                aria-expanded={open}
              >
                <span className="day-chevron">{open ? "▾" : "▸"}</span>
                <span className="day-title">Tag {span.day}</span>
                {route && (
                  <span className="day-stats">
                    {stats.distanceKm.toFixed(0)} km · {formatDuration(stats.durationMin)}
                  </span>
                )}
                <span className="day-overnight">
                  {isFinalDay ? "🏁 " : "🛏 "}
                  {placeName(overnight)}
                </span>
              </button>
              {open && <ul className="wp-list">{indices.map(renderWaypoint)}</ul>}
            </div>
          );
        })
      ) : (
        waypoints.length > 0 && (
          <ul className="wp-list">{waypoints.map((_, i) => renderWaypoint(i))}</ul>
        )
      )}

      {pendingDay && (
        <div className="day-group pending">
          <div className="day-header">
            <span className="day-title">Tag {days.length + 1}</span>
            <span className="day-overnight">noch offen</span>
          </div>
          <p className="pending-hint">
            Ort oben suchen oder auf die Karte tippen – er wird zum Ziel von Tag{" "}
            {days.length + 1}.
          </p>
        </div>
      )}

      {waypoints.length >= 2 && !pendingDay && (
        <button className="add-day-btn" onClick={onAddDay}>
          + Tag hinzufügen
        </button>
      )}

      {waypoints.length >= 2 && (
        <p className="edit-hint">
          „+ Tag hinzufügen" beendet den Tag am letzten Punkt (Übernachtung).
          Alternativ 🛏 an einem Stopp antippen. Streckenlinie ziehen fügt einen
          Zwischenpunkt ein.
        </p>
      )}
    </div>
  );
}
