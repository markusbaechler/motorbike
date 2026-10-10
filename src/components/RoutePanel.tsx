import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";
import WeatherStrip, { pct, weatherIcon } from "./WeatherStrip";
import Modal from "./Modal";
import PlaceInput from "./PlaceInput";
import { computeDays, dayStats, dayNumbers } from "../lib/days";
import { DESKTOP_QUERY, useMediaQuery } from "../lib/useMediaQuery";
import { canReorder, isClosedLoop, pointLabel } from "../lib/waypoints";
import { useThrottleWait } from "../lib/useThrottleWait";
import type { GeoResult } from "../lib/geocoding";
import type { BookingPrefs } from "../lib/storage";
import { isFair } from "../lib/weather";
import { stationWx, type RouteWeather } from "../lib/useRouteWeather";
import { fmtHhMm } from "../lib/schedule";
import type { RouteProfile, RouteResult, Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  defaultProfile: RouteProfile;
  route: RouteResult | null;
  loading: boolean;
  error: string | null;
  onRetryRoute: () => void;
  onReverse: () => void;
  onRoundTrip: () => void;
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
  onSetDayMeta: (id: string, patch: { dayName?: string; dayDate?: string; dayStart?: string }) => void;
  routeWx: RouteWeather;
  onAddDay: () => void;
  onRemoveWaypoint: (id: string) => void;
  onRenameWaypoint: (id: string, name: string) => void;
  onReorderWaypoint: (id: string, direction: -1 | 1) => void;
  // Inline place search in the list: insert into a leg, or append at the end.
  onInsertWaypoint: (legIndex: number, lng: number, lat: number, name?: string) => void;
  onAppendWaypoint: (lng: number, lat: number, name?: string) => void;
  onClear: () => void;
  // Desktop, empty map: start options shown instead of the planning controls.
  welcome?: ReactNode;
}

// Small inline place search shown where a point is about to be inserted.
function InlineAdd({
  placeholder,
  bias,
  onPick,
  onCancel,
}: {
  placeholder: string;
  bias?: { lat: number; lng: number };
  onPick: (r: GeoResult) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div
      className="wp-insert"
      onKeyDown={(e) => {
        // Escape with the suggestion list closed abandons the insert.
        if (e.key === "Escape") onCancel();
      }}
    >
      <PlaceInput
        value={text}
        placeholder={placeholder}
        bias={bias}
        autoFocus
        onChange={setText}
        onPick={onPick}
      />
      <button className="wp-btn" onClick={onCancel} aria-label="Abbrechen" title="Abbrechen">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

export const PROFILE_LABEL: Record<RouteProfile, string> = {
  kurvig: "Fun 1",
  kurvig_plus: "Fun 2",
  schnell: "Schnell",
};

// What the three riding styles mean (tooltip + screen readers).
export const PROFILE_HINT: Record<RouteProfile, string> = {
  kurvig: "Fun 1: kurvig über kleine Strassen und Pässe, zuverlässig",
  kurvig_plus: "Fun 2: maximal kurvig, nimmt auch Umwege in Kauf",
  schnell: "Schnell: direkt, auch über die Autobahn",
};

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// Full name (hotel search etc.); map-placed points only have coordinates.
function placeName(wp: Waypoint): string {
  return wp.name ?? `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`;
}

// Short display name: just the locality (drops region/country after the
// comma). Coordinates keep both halves, "47.690" alone says nothing.
function shortName(wp: Waypoint): string {
  return pointLabel(wp);
}

/**
 * The point's name as a quiet text field: click and type to rename it
 * ("Kaffeehalt Löwen"), Enter or leaving the field saves, Escape cancels,
 * emptying it brings back the place name. The position doesn't change.
 */
function WpName({ wp, onRename }: { wp: Waypoint; onRename: (id: string, name: string) => void }) {
  const shown = wp.name ? shortName(wp) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  return (
    <input
      className="wp-name-input"
      value={draft ?? shown}
      placeholder={wp.name ? "" : "Ort wird gesucht …"}
      aria-label="Name des Punkts"
      title="Klicken zum Umbenennen"
      onFocus={(e) => {
        setDraft(shown);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelRef.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const next = (draft ?? shown).trim();
        if (!cancelRef.current && next !== shown) onRename(wp.id, next);
        cancelRef.current = false;
        setDraft(null);
      }}
    />
  );
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
          title={PROFILE_HINT[p]}
          aria-label={PROFILE_HINT[p]}
          aria-pressed={value === p}
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
  onRetryRoute,
  onReverse,
  onRoundTrip,
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
  routeWx,
  onAddDay,
  onRemoveWaypoint,
  onRenameWaypoint,
  onReorderWaypoint,
  onInsertWaypoint,
  onAppendWaypoint,
  onClear,
  welcome,
}: Props) {
  const days = computeDays(waypoints);
  // Seconds the router queue waits for the public server's limit (0 = none).
  const throttleWait = useThrottleWait();
  const nums = dayNumbers(waypoints, days);

  // Where an inline place search is open: a leg index, "end", or nothing.
  const [insertAt, setInsertAt] = useState<number | "end" | null>(null);
  const closeInsert = () => setInsertAt(null);
  // A round trip ends where it starts (e.g. Tour-Genius loops). Such a tour has
  // no final overnight to book, so we hide the accommodation UI for it. New
  // points go in front of the closing copy of the start (see lib/waypoints).
  const isRoundTrip = isClosedLoop(waypoints);

  // Bias the search toward the middle of the leg (or the last real stop: on a
  // round trip that is the point before the return to the start).
  const legMid = (a: Waypoint, b: Waypoint) => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  const lastWp = waypoints[waypoints.length - (isRoundTrip ? 2 : 1)];

  const appendRow =
    insertAt === "end" ? (
      <InlineAdd
        placeholder="Nächsten Punkt suchen …"
        bias={lastWp ? { lat: lastWp.lat, lng: lastWp.lng } : undefined}
        onPick={(r) => {
          onAppendWaypoint(r.lng, r.lat, r.name);
          closeInsert();
        }}
        onCancel={closeInsert}
      />
    ) : (
      <button
        className="add-stop-btn wp-append"
        onClick={() => setInsertAt("end")}
        title={isRoundTrip ? "Neuer Punkt wird vor der Rückkehr zum Start eingefügt" : undefined}
      >
        <Icon name="plus" size={15} />{" "}
        {isRoundTrip ? "Punkt vor Rückkehr einfügen" : "Punkt anhängen"}
      </button>
    );

  // "Tag hinzufügen" ends the day at the last real stop. On a round trip that
  // is the point before the return; once it ends a day there is nothing left
  // to add (every further point lands in that final day anyway).
  const canAddDay =
    waypoints.length >= 2 &&
    !pendingDay &&
    !(isRoundTrip && waypoints[waypoints.length - 2].dayEnd);

  // Collapse inactive days by default; only the last (active) day is open.
  // The user can toggle any day open/closed.
  const [openOverrides, setOpenOverrides] = useState<Record<number, boolean>>({});
  const lastDay = days.length;
  const isDayOpen = (d: number) => openOverrides[d] ?? d === lastDay;
  const toggleDay = (d: number) =>
    setOpenOverrides((o) => ({ ...o, [d]: !isDayOpen(d) }));

  // Wide screens show the panel as a sidebar next to the map (no grabber, no
  // minimise); phones get the bottom sheet.
  const desktop = useMediaQuery(DESKTOP_QUERY);

  // The bottom sheet can be minimised to free up the map (phones only).
  const [minState, setMin] = useState(false);
  const min = minState && !desktop;

  // Secondary tools live in a menu on phones so the sheet starts with the
  // tour itself instead of a wall of buttons.
  const [showTools, setShowTools] = useState(false);
  const pick = (fn: () => void) => () => {
    setShowTools(false);
    fn();
  };

  // Publish the sheet's current height as a CSS variable so the map controls
  // (zoom, locate, scale) and "fit route" can stay clear of it. The sidebar
  // sits beside the map, so there it publishes 0.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty(
        "--panel-h",
        desktop ? "0px" : `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--panel-h", "0px");
    };
  }, [desktop]);

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

  const wxByWp = useMemo(() => stationWx(routeWx), [routeWx]);

  const renderWaypoint = (i: number) => {
    const wp = waypoints[i];
    const at = wxByWp.get(wp.id);
    const leg = i > 0 ? route?.legs[i - 1] : undefined;
    const isLast = i === waypoints.length - 1;
    return (
      <li key={wp.id} className="wp-item">
        {i > 0 && (
          // The leg hangs on the line between its two points, in the colour of
          // its riding style (as on the map); "+" sits on that line.
          <div
            className="segment"
            data-profile={wp.legProfile}
            role="group"
            aria-label={`Abschnitt ${i}→${i + 1}`}
          >
            <ProfileToggle
              value={wp.legProfile}
              onChange={(p) => onSetLegProfile(wp.id, p)}
            />
            {leg && <span className="segment-stats">{leg.distanceKm.toFixed(0)} km</span>}
            <button
              className={`segment-insert ${insertAt === i - 1 ? "active" : ""}`}
              onClick={() => setInsertAt(insertAt === i - 1 ? null : i - 1)}
              aria-label={`Zwischenziel in Abschnitt ${i}→${i + 1} einfügen`}
              title="Zwischenziel einfügen"
              aria-expanded={insertAt === i - 1}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
        )}
        {i > 0 && insertAt === i - 1 && (
          <InlineAdd
            placeholder="Zwischenziel suchen …"
            bias={legMid(waypoints[i - 1], wp)}
            onPick={(r) => {
              onInsertWaypoint(i - 1, r.lng, r.lat, r.name);
              closeInsert();
            }}
            onCancel={closeInsert}
          />
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
              <WpName wp={wp} onRename={onRenameWaypoint} />
              {wp.dayEnd && (
                <span className="bed-tag" title="Übernachtung">
                  <Icon name="bed" size={13} />
                </span>
              )}
            </span>
            {at && (
              <span
                className={`wp-weather ${at.wx ? (isFair(at.wx.code) ? "fair" : "wet") : ""}`}
                title={at.wx ? `Wind ${Math.round(at.wx.wind)} km/h` : undefined}
              >
                {at.st.kind === "start" ? "ab" : "an ca."} {fmtHhMm(at.st.arriveMin)}
                {at.wx && (
                  <>
                    {" · "}
                    <Icon name={weatherIcon(at.wx.code)} size={14} /> {Math.round(at.wx.temp)}° ·{" "}
                    {pct(at.wx.precipProb)}
                  </>
                )}
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
              disabled={!canReorder(waypoints, i, -1)}
              onClick={() => onReorderWaypoint(wp.id, -1)}
              aria-label="Nach oben"
            >
              <Icon name="up" size={16} />
            </button>
            <button
              className="wp-btn"
              disabled={!canReorder(waypoints, i, 1)}
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
    <div ref={rootRef} className={`panel ${min ? "min" : ""}`}>
      {!desktop && (
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
      )}

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
              "Tour planen – antippen zum Aufklappen"
            )}
          </span>
        </button>
      ) : (
       <>
      {desktop && welcome && waypoints.length === 0 ? (
        welcome
      ) : (
       <>
      <div className="panel-row top">
        {/* One primary action; the other tools share the quiet secondary style
            (desktop) or sit behind "Mehr" (phones). */}
        <button className="quickplan-btn" onClick={onOpenQuickPlan}>
          <Icon name="zap" size={16} /> Tour planen
        </button>
        {/* Desktop: Tour-Genius, Pässe, Touren live in the nav rail. */}
        {!desktop && (
          <button
            className="quickplan-btn secondary tools-btn"
            onClick={() => setShowTools(true)}
            aria-haspopup="dialog"
          >
            <Icon name="menu" size={16} /> Mehr
          </button>
        )}
      </div>

      <div className="panel-row profile">
        <span className="default-label">Neuer Abschnitt:</span>
        <ProfileToggle value={defaultProfile} onChange={onDefaultProfileChange} />
      </div>

      <div className="panel-row summary">
        {waypoints.length === 0 && (
          <span className="hint">
            Ort suchen oder auf die Karte tippen, um Start, Zwischenziele und Ziel zu setzen.
          </span>
        )}
        {waypoints.length === 1 && (
          <span className="hint">Nächsten Punkt setzen, um die Route zu berechnen.</span>
        )}
        {loading && (
          <span className="hint">
            {throttleWait > 0
              ? `Routing-Dienst bremst kurz (zu viele Anfragen in kurzer Zeit) – geht in ${throttleWait} s automatisch weiter …`
              : "Route wird berechnet …"}
          </span>
        )}
        {error && (
          <span className="error">
            ⚠ {error}
            <button className="retry-btn" onClick={onRetryRoute}>Erneut versuchen</button>
          </span>
        )}
        {route && !loading && !error && (
          <span className="stats">
            <span className="stats-nums">
              {days.length > 1 && <strong>{days.length} Tage</strong>}
              {days.length > 1 && <span className="dot">·</span>}
              <strong>{route.distanceKm.toFixed(1)} km</strong>
              <span className="dot">·</span>
              <strong>{formatDuration(route.durationMin)}</strong>
            </span>
            <span className="stats-actions">
              <button className="details-btn" onClick={onOpenDetails}>
                <Icon name="chart" size={15} /> Details
              </button>
              <button className="details-btn" onClick={onOpenShare}>
                <Icon name="share" size={15} /> Teilen
              </button>
            </span>
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
          const plan = routeWx.plans[span.day - 1];
          const dayWx = routeWx.wx[span.day - 1];
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
                  {plan && (
                    <label className="day-start">
                      Start
                      <input
                        type="time"
                        value={fmtHhMm(plan.startMin)}
                        onChange={(e) => onSetDayMeta(overnight.id, { dayStart: e.target.value || undefined })}
                      />
                      {!plan.startIsDefault && (
                        <button
                          className="day-start-reset"
                          onClick={() => onSetDayMeta(overnight.id, { dayStart: undefined })}
                        >
                          Standard
                        </button>
                      )}
                    </label>
                  )}
                  {plan?.dateIsDefault && (
                    <span className="day-date-auto">
                      {plan.daysAhead === 0 ? "heute" : formatDate(plan.date)} (automatisch)
                    </span>
                  )}
                  {!(isFinalDay && isRoundTrip) && (
                    <button
                      className="hotel-btn"
                      onClick={() => onOpenHotel(placeName(overnight), overnight.dayDate)}
                      title="Hotels an diesem Übernachtungsort suchen"
                    >
                      <Icon name="bed" size={15} /> Hotels suchen
                    </button>
                  )}
                </div>
              )}
              {open && plan && <WeatherStrip plan={plan} state={dayWx} />}
              {open && (
                <ul className="wp-list">
                  {indices.map((i) => renderWaypoint(i))}
                </ul>
              )}
              {open && isFinalDay && !pendingDay && appendRow}
            </div>
          );
        })
      ) : (
        waypoints.length > 0 && (
          <>
            <ul className="wp-list">{waypoints.map((_, i) => renderWaypoint(i))}</ul>
            {appendRow}
          </>
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

      {canAddDay && (
        <button className="add-day-btn" onClick={onAddDay}>
          <Icon name="plus" size={16} /> Tag hinzufügen
        </button>
      )}

      {waypoints.length >= 2 && (
        <p className="edit-hint">
          {isRoundTrip
            ? "„Tag hinzufügen“ beendet den Tag am letzten Punkt vor der Rückkehr; neue Punkte werden vor der Rückkehr eingefügt."
            : "„Tag hinzufügen“ beendet den Tag am letzten Punkt."}{" "}
          Streckenlinie ziehen fügt ein Zwischenziel ein.
        </p>
      )}

      {/* Desktop: the rarer whole-tour actions, quiet at the end of the list. */}
      {desktop && waypoints.length > 0 && (
        <div className="panel-row tour-tools">
          {waypoints.length >= 2 && (
            <>
              <button className="clear-btn" onClick={onReverse} title="Richtung umkehren">
                <Icon name="swap" size={14} /> Umkehren
              </button>
              <button
                className="clear-btn"
                onClick={onRoundTrip}
                disabled={isRoundTrip}
                title={isRoundTrip ? "Die Tour ist bereits eine Rundtour" : "Zurück zum Start (Rundtour)"}
              >
                <Icon name="loop" size={14} /> Rundtour
              </button>
            </>
          )}
          <button className="clear-btn" onClick={onClear}>
            Zurücksetzen
          </button>
        </div>
      )}
       </>
      )}
       </>
      )}

      {showTools && (
        <Modal title="Werkzeuge" onClose={() => setShowTools(false)} className="modal-tools">
          <div className="modal-body tools-list">
            <button className="tools-item" onClick={pick(onOpenTourGenius)}>
              <Icon name="compass" size={20} />
              <span>
                <strong>Tour-Genius</strong>
                <small>Touren automatisch generieren</small>
              </span>
            </button>
            <button className="tools-item" onClick={pick(onOpenPassPlanner)}>
              <Icon name="mountain" size={20} />
              <span>
                <strong>Pässeplaner</strong>
                <small>Tour über ausgewählte Pässe</small>
              </span>
            </button>
            <button className="tools-item" onClick={pick(onOpenRoutes)}>
              <Icon name="folder" size={20} />
              <span>
                <strong>Meine Touren</strong>
                <small>Speichern, laden, importieren</small>
              </span>
            </button>
            {waypoints.length >= 2 && (
              <>
                <button className="tools-item" onClick={pick(onReverse)}>
                  <Icon name="swap" size={20} />
                  <span>
                    <strong>Umkehren</strong>
                    <small>Richtung der Tour umdrehen</small>
                  </span>
                </button>
                <button className="tools-item" onClick={pick(onRoundTrip)} disabled={isRoundTrip}>
                  <Icon name="loop" size={20} />
                  <span>
                    <strong>Rundtour</strong>
                    <small>
                      {isRoundTrip ? "Die Tour ist bereits eine Rundtour" : "Zurück zum Start anhängen"}
                    </small>
                  </span>
                </button>
              </>
            )}
            {waypoints.length > 0 && (
              <button className="tools-item danger" onClick={pick(onClear)}>
                <Icon name="x" size={20} />
                <span>
                  <strong>Zurücksetzen</strong>
                  <small>Alle Punkte entfernen</small>
                </span>
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
