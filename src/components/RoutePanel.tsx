import { useRef, useState } from "react";
import Icon, { type IconName } from "./Icon";
import { computeDays, dayStats, dayNumbers } from "../lib/days";
import type { BookingPrefs } from "../lib/storage";
import { isFair, type WeatherDay } from "../lib/weather";
import type { RouteProfile, RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  defaultProfile: RouteProfile;
  route: RouteResult | null;
  loading: boolean;
  error: string | null;
  pendingDay: boolean;
  bookingPrefs: BookingPrefs;
  onOpenDetails: () => void;
  onOpenShare: () => void;
  onOpenQuickPlan: () => void;
  onOpenTourGenius: () => void;
  onOpenPassPlanner: () => void;
  onOpenRoutes: () => void;
  onOpenBookingPrefs: () => void;
  onOpenHotel: (place: string, checkin?: string) => void;
  onDefaultProfileChange: (p: RouteProfile) => void;
  onSetLegProfile: (waypointId: string, p: RouteProfile) => void;
  onToggleDayEnd: (id: string) => void;
  onSetDayMeta: (id: string, patch: { dayName?: string; dayDate?: string }) => void;
  weather: Record<string, WeatherDay | null>;
  onAddDay: () => void;
  onRemoveWaypoint: (id: string) => void;
  onReorderWaypoint: (id: string, direction: -1 | 1) => void;
  onClear: () => void;
}

const PROFILE_LABEL: Record<RouteProfile, string> = {
  kurvig: "Fun 1",
  kurvig_plus: "Fun 2",
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

// Short display name: just the locality (drops region/country after the comma).
function shortName(wp: Waypoint): string {
  const n = placeName(wp);
  return n.split(",")[0].trim();
}

function weatherIcon(code: number): IconName {
  if (code === 0) return "sun";
  if (code <= 2) return "cloudSun";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "rain"; // 51–67 drizzle/rain, 80–82 showers
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-CH");
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
  bookingPrefs,
  onOpenDetails,
  onOpenShare,
  onOpenQuickPlan,
  onOpenTourGenius,
  onOpenPassPlanner,
  onOpenRoutes,
  onOpenBookingPrefs,
  onOpenHotel,
  onDefaultProfileChange,
  onSetLegProfile,
  onToggleDayEnd,
  onSetDayMeta,
  weather,
  onAddDay,
  onRemoveWaypoint,
  onReorderWaypoint,
  onClear,
}: Props) {
  const days = computeDays(waypoints);
  const nums = dayNumbers(waypoints, days);

  // A round trip ends where it starts (e.g. Tour-Genius loops). Such a tour has
  // no final overnight to book, so we hide the accommodation UI for it.
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  const isRoundTrip =
    waypoints.length >= 3 && !!first && !!last && first.lat === last.lat && first.lng === last.lng;

  // Collapse inactive days by default; only the last (active) day is open.
  // The user can toggle any day open/closed.
  const [openOverrides, setOpenOverrides] = useState<Record<number, boolean>>({});
  const lastDay = days.length;
  const isDayOpen = (d: number) => openOverrides[d] ?? d === lastDay;
  const toggleDay = (d: number) =>
    setOpenOverrides((o) => ({ ...o, [d]: !isDayOpen(d) }));

  // The whole bottom sheet can be minimised to free up the map.
  const [min, setMin] = useState(false);

  // Drag the grabber: pull down to minimise, up to expand (tap also toggles).
  const dragRef = useRef<{ y: number; moved: boolean } | null>(null);
  const onHandleDown = (e: React.PointerEvent) => {
    dragRef.current = { y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d && Math.abs(e.clientY - d.y) > 6) d.moved = true;
  };
  const onHandleUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (dy > 28) setMin(true);
    else if (dy < -28) setMin(false);
    else setMin((m) => !m);
  };

  const renderWaypoint = (i: number, dayDate?: string) => {
    const wp = waypoints[i];
    const leg = i > 0 ? route?.legs[i - 1] : undefined;
    const isLast = i === waypoints.length - 1;
    const wx = dayDate ? weather[`${wp.id}:${dayDate}`] : undefined;
    return (
      <li key={wp.id} className="wp-item">
        {i > 0 && (
          <div className="segment">
            <span className="segment-arrow">↳ Abschnitt {i}→{i + 1}</span>
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
            data-role={
              i === 0 ? "start" : isLast ? "end" : wp.dayEnd ? "bed" : "via"
            }
          >
            {nums[i]}
          </span>
          <div className="wp-main">
            <span className="wp-name">
              {shortName(wp)}
              {wp.dayEnd && (
                <span className="bed-tag" title="Übernachtung">
                  <Icon name="bed" size={13} />
                </span>
              )}
            </span>
            {wx && (
              <span
                className={`wp-weather ${isFair(wx.code) ? "fair" : "wet"}`}
                title={`${wx.label} · Wind ${wx.windMax} km/h`}
              >
                <Icon name={weatherIcon(wx.code)} size={14} /> {wx.tMax}° / {wx.tMin}° · {wx.precipProb}% Regen
              </span>
            )}
          </div>
          <span className="wp-actions">
            {i > 0 && !isLast && (
              <button
                className={`wp-btn bed ${wp.dayEnd ? "active" : ""}`}
                onClick={() => onToggleDayEnd(wp.id)}
                aria-label="Übernachtung / Tagesende"
                title="Hier übernachten (Tag beenden)"
              >
                <Icon name="bed" size={16} />
              </button>
            )}
            <button
              className="wp-btn"
              disabled={i === 0}
              onClick={() => onReorderWaypoint(wp.id, -1)}
              aria-label="Nach oben"
            >
              <Icon name="up" size={16} />
            </button>
            <button
              className="wp-btn"
              disabled={isLast}
              onClick={() => onReorderWaypoint(wp.id, 1)}
              aria-label="Nach unten"
            >
              <Icon name="down" size={16} />
            </button>
            <button
              className="wp-btn remove"
              onClick={() => onRemoveWaypoint(wp.id)}
              aria-label="Entfernen"
            >
              <Icon name="x" size={16} />
            </button>
          </span>
        </div>
      </li>
    );
  };

  return (
    <div className={`panel ${min ? "min" : ""}`}>
      <div
        className="panel-handle"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        title="Ziehen oder tippen zum Ein-/Ausklappen"
      >
        <span className="panel-handle-bar" />
        <button
          className="panel-handle-chevron"
          data-open={!min}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMin((m) => !m)}
          aria-label={min ? "Bedienfeld aufklappen" : "Bedienfeld minimieren"}
        >
          <Icon name="chevron" size={20} />
        </button>
      </div>

      {min ? (
        <button className="panel-minbar" onClick={() => setMin(false)}>
          <span>
            {route ? (
              <>
                <strong>{route.distanceKm.toFixed(0)} km</strong> ·{" "}
                {formatDuration(route.durationMin)}
                {days.length > 1 ? ` · ${days.length} Tage` : ""}
              </>
            ) : (
              "Route planen — antippen zum Aufklappen"
            )}
          </span>
        </button>
      ) : (
       <>
      <div className="panel-row top">
        <button className="quickplan-btn" onClick={onOpenQuickPlan}>
          <Icon name="zap" size={16} /> Route planen
        </button>
        <button className="quickplan-btn genius" onClick={onOpenTourGenius}>
          <Icon name="compass" size={16} /> Tour-Genius
        </button>
        <button className="quickplan-btn passes" onClick={onOpenPassPlanner}>
          <Icon name="mountain" size={16} /> Pässeplaner
        </button>
        <button className="quickplan-btn secondary" onClick={onOpenRoutes}>
          <Icon name="folder" size={16} /> Routen
        </button>
        <span className="default-label">Neuer Abschnitt:</span>
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
              <Icon name="chart" size={15} /> Details
            </button>
            <button className="details-btn" onClick={onOpenShare}>
              <Icon name="users" size={15} /> Teilen
            </button>
          </span>
        )}
      </div>

      {days.length > 0 && !(isRoundTrip && days.length === 1) && (
        <div className="booking-row">
          <span className="booking-summary">
            <Icon name="bed" size={15} /> {bookingPrefs.adults} Erw.
            {bookingPrefs.children > 0 ? `, ${bookingPrefs.children} Kinder` : ""} ·{" "}
            {bookingPrefs.rooms} Zimmer
          </span>
          <button className="booking-edit" onClick={onOpenBookingPrefs}>
            ändern
          </button>
        </div>
      )}

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
                <span className="day-chevron" data-open={open}>
                  <Icon name="chevron" size={16} />
                </span>
                <span className="day-title">
                  Tag {span.day}
                  {!open && overnight.dayName ? `: ${overnight.dayName}` : ""}
                </span>
                {!open && overnight.dayDate && (
                  <span className="day-date-tag">{formatDate(overnight.dayDate)}</span>
                )}
                {route && (
                  <span className="day-stats">
                    {stats.distanceKm.toFixed(0)} km · {formatDuration(stats.durationMin)}
                  </span>
                )}
                <span className="day-overnight">
                  <Icon name={isFinalDay ? "flag" : "bed"} size={13} />
                  {shortName(overnight)}
                </span>
              </button>
              {open && (
                <div className="day-meta">
                  <input
                    className="day-name-input"
                    type="text"
                    placeholder={`Tagesname (z. B. Tag ${span.day})`}
                    value={overnight.dayName ?? ""}
                    onChange={(e) => onSetDayMeta(overnight.id, { dayName: e.target.value })}
                  />
                  <input
                    className="day-date-input"
                    type="date"
                    value={overnight.dayDate ?? ""}
                    onChange={(e) => onSetDayMeta(overnight.id, { dayDate: e.target.value })}
                  />
                  {!(isFinalDay && isRoundTrip) && (
                    <button
                      className="hotel-btn"
                      onClick={() => onOpenHotel(placeName(overnight), overnight.dayDate)}
                      title="Hotels an diesem Übernachtungsort suchen"
                    >
                      <Icon name="bed" size={15} /> Hotels
                    </button>
                  )}
                </div>
              )}
              {open && overnight.dayDate && weather[`${overnight.id}:${overnight.dayDate}`] === null && (
                <p className="day-weather muted">Wetter: keine Vorhersage (Datum zu weit weg/vergangen).</p>
              )}
              {open && (
                <ul className="wp-list">
                  {indices.map((i) => renderWaypoint(i, overnight.dayDate))}
                </ul>
              )}
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
          <Icon name="plus" size={16} /> Tag hinzufügen
        </button>
      )}

      {waypoints.length >= 2 && (
        <p className="edit-hint">
          „Tag hinzufügen" beendet den Tag am letzten Punkt. Streckenlinie ziehen
          fügt einen Zwischenpunkt ein.
        </p>
      )}
       </>
      )}
    </div>
  );
}
