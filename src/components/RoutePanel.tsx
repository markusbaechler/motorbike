import type { RouteProfile, RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  defaultProfile: RouteProfile;
  route: RouteResult | null;
  loading: boolean;
  error: string | null;
  onDefaultProfileChange: (p: RouteProfile) => void;
  onSetLegProfile: (waypointId: string, p: RouteProfile) => void;
  onRemoveWaypoint: (id: string) => void;
  onReorderWaypoint: (id: string, direction: -1 | 1) => void;
  onClear: () => void;
}

const PROFILE_LABEL: Record<RouteProfile, string> = {
  "car-eco": "Kurvig",
  "car-fast": "Schnell",
};

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
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
      {(["car-eco", "car-fast"] as RouteProfile[]).map((p) => (
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
  onDefaultProfileChange,
  onSetLegProfile,
  onRemoveWaypoint,
  onReorderWaypoint,
  onClear,
}: Props) {
  return (
    <div className="panel">
      <div className="panel-row top">
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
            <strong>{route.distanceKm.toFixed(1)} km</strong>
            <span className="dot">·</span>
            <strong>{formatDuration(route.durationMin)}</strong>
          </span>
        )}
      </div>

      {waypoints.length > 0 && (
        <ul className="wp-list">
          {waypoints.map((wp, i) => {
            const leg = i > 0 ? route?.legs[i - 1] : undefined;
            return (
              <li key={wp.id} className="wp-item">
                {i > 0 && (
                  <div className="segment">
                    <span className="segment-arrow">↳ Etappe {i}→{i + 1}</span>
                    <ProfileToggle
                      value={wp.legProfile}
                      onChange={(p) => onSetLegProfile(wp.id, p)}
                    />
                    {leg && (
                      <span className="segment-stats">{leg.distanceKm.toFixed(0)} km</span>
                    )}
                  </div>
                )}

                <div className="wp-row">
                  <span
                    className="wp-dot"
                    data-role={
                      i === 0 ? "start" : i === waypoints.length - 1 ? "end" : "via"
                    }
                  >
                    {i + 1}
                  </span>
                  <span className="wp-name">
                    {wp.name ?? `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`}
                  </span>
                  <span className="wp-actions">
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
                      disabled={i === waypoints.length - 1}
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
          })}
        </ul>
      )}

      {waypoints.length >= 2 && (
        <p className="edit-hint">
          Tipp: Streckenlinie ziehen, um einen Zwischenpunkt einzufügen · Marker
          ziehen zum Verschieben.
        </p>
      )}
    </div>
  );
}
