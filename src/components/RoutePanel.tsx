import type { RouteProfile, RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  profile: RouteProfile;
  route: RouteResult | null;
  loading: boolean;
  error: string | null;
  onProfileChange: (p: RouteProfile) => void;
  onRemoveWaypoint: (id: string) => void;
  onClear: () => void;
}

const PROFILES: { id: RouteProfile; label: string; hint: string }[] = [
  { id: "car-eco", label: "Kurvig", hint: "bevorzugt kleine Land- & Nebenstraßen" },
  { id: "car-fast", label: "Schnell", hint: "direkte Strecke" },
];

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function RoutePanel({
  waypoints,
  profile,
  route,
  loading,
  error,
  onProfileChange,
  onRemoveWaypoint,
  onClear,
}: Props) {
  return (
    <div className="panel">
      <div className="panel-row profiles">
        {PROFILES.map((p) => (
          <button
            key={p.id}
            className={`profile-btn ${profile === p.id ? "active" : ""}`}
            onClick={() => onProfileChange(p.id)}
            title={p.hint}
          >
            {p.label}
          </button>
        ))}
        {waypoints.length > 0 && (
          <button className="clear-btn" onClick={onClear}>
            Zurücksetzen
          </button>
        )}
      </div>

      <div className="panel-row summary">
        {waypoints.length === 0 && (
          <span className="hint">
            Tippe auf die Karte, um Start, Zwischenstopps und Ziel zu setzen.
          </span>
        )}
        {waypoints.length === 1 && (
          <span className="hint">Tippe erneut, um das Ziel zu setzen.</span>
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
        <ol className="wp-list">
          {waypoints.map((wp, i) => (
            <li key={wp.id}>
              <span className="wp-dot" data-role={i === 0 ? "start" : i === waypoints.length - 1 ? "end" : "via"}>
                {i + 1}
              </span>
              <span className="wp-coords">
                {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}
              </span>
              <button
                className="wp-remove"
                onClick={() => onRemoveWaypoint(wp.id)}
                aria-label="Wegpunkt entfernen"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
