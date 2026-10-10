import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import PlaceInput from "./PlaceInput";
import { PROFILE_HINT, PROFILE_LABEL } from "./RoutePanel";
import { reverseGeocode, searchPlaces, type GeoResult } from "../lib/geocoding";
import { coordLabel, pickAction, type PickTarget } from "../lib/planpick";
import type { RouteProfile, Waypoint } from "../types";

const isAbort = (e: unknown) => (e as Error | null)?.name === "AbortError";

export interface QuickStop {
  name?: string;
  lng: number;
  lat: number;
  legProfile: RouteProfile;
  dayEnd?: boolean;
}

// A point clicked (or a form marker dragged) on the map beside the sidebar.
// `seq` makes every pick a new event, even on the same spot.
export interface MapPick {
  seq: number;
  lng: number;
  lat: number;
  // Context menu choice; absent for a plain click.
  target?: PickTarget;
  // Marker drag: the slot whose point moved.
  slotId?: number;
}

// Map markers of the form are named "plan-<slot id>".
export const planSlotId = (waypointId: string): number | null => {
  const m = /^plan-(\d+)$/.exec(waypointId);
  return m ? Number(m[1]) : null;
};

interface Slot {
  id: number;
  value: string;
  picked?: GeoResult;
  legProfile: RouteProfile;
}

interface Day {
  id: number;
  stops: Slot[]; // the destinations/vias of this day (NOT the carried start)
}

interface Props {
  initialStops?: QuickStop[];
  defaultProfile: RouteProfile;
  onApply: (stops: QuickStop[]) => void;
  onClose: () => void;
  // "modal": dialog over the map (phones, bottom sheet layout).
  // "sidebar": fills the left sidebar on wide screens so the map stays
  // visible next to the form instead of being dimmed behind a dialog.
  variant?: "modal" | "sidebar";
  // Sidebar only: points picked on the map, and the form's points to show there.
  mapPick?: MapPick | null;
  onPointsChange?: (points: Waypoint[]) => void;
}

/**
 * Sidebar shell for the desktop layout: same head as a dialog (title + close),
 * Escape closes, focus moves in on open and back to the opener on close. It
 * is not modal: the map beside it stays usable for looking around.
 */
function SidebarView({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A dialog opened on top handles its own Escape.
      if (e.key !== "Escape" || document.querySelector(".modal-backdrop")) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <section ref={boxRef} className="side-view" aria-labelledby={titleId} tabIndex={-1}>
      <div className="modal-head side-view-head">
        <h2 id={titleId}>{title}</h2>
        <button className="modal-close" onClick={onClose} aria-label="Schliessen">
          <Icon name="x" size={18} />
        </button>
      </div>
      {children}
    </section>
  );
}

let uid = 1;
const makeSlot = (profile: RouteProfile, stop?: QuickStop): Slot => ({
  id: uid++,
  value: stop ? stop.name ?? `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}` : "",
  picked: stop ? { name: stop.name ?? "Punkt", lng: stop.lng, lat: stop.lat } : undefined,
  legProfile: stop ? stop.legProfile : profile,
});

// Split a flat stop list (start + stops, days separated by dayEnd) into a
// start slot plus per-day stop lists.
function buildInitial(stops: QuickStop[] | undefined, profile: RouteProfile) {
  if (stops && stops.length >= 2) {
    const start = makeSlot(profile, stops[0]);
    const days: Day[] = [];
    let cur: Slot[] = [];
    for (let i = 1; i < stops.length; i++) {
      cur.push(makeSlot(profile, stops[i]));
      if (stops[i].dayEnd && i < stops.length - 1) {
        days.push({ id: uid++, stops: cur });
        cur = [];
      }
    }
    days.push({ id: uid++, stops: cur });
    return { start, days };
  }
  return {
    start: makeSlot(profile),
    days: [{ id: uid++, stops: [makeSlot(profile)] }] as Day[],
  };
}

export default function QuickPlanModal({
  initialStops,
  defaultProfile,
  onApply,
  onClose,
  variant = "modal",
  mapPick = null,
  onPointsChange,
}: Props) {
  const init = buildInitial(initialStops, defaultProfile);
  const [start, setStart] = useState<Slot>(init.start);
  const [days, setDays] = useState<Day[]>(init.days);
  const [profile, setProfile] = useState<RouteProfile>(defaultProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Collapse inactive days; only the current (last) day is open by default.
  const [openOverrides, setOpenOverrides] = useState<Record<number, boolean>>({});
  const isDayOpen = (id: number, isLast: boolean) => openOverrides[id] ?? isLast;
  const toggleDay = (id: number, isLast: boolean) =>
    setOpenOverrides((o) => ({ ...o, [id]: !isDayOpen(id, isLast) }));

  const patchStart = (patch: Partial<Slot>) => setStart((s) => ({ ...s, ...patch }));

  // Any slot (Start or a stop of any day) by id. `onlyIf` guards late updates.
  const patchSlot = (id: number, patch: Partial<Slot>, onlyIf: (s: Slot) => boolean = () => true) => {
    const upd = (s: Slot) => (s.id === id && onlyIf(s) ? { ...s, ...patch } : s);
    setStart(upd);
    setDays((ds) => ds.map((d) => ({ ...d, stops: d.stops.map(upd) })));
  };

  // The field the rider was last in: a map click fills that one (once).
  const focusedRef = useRef<number | null>(null);
  const nameCtrls = useRef(new Set<AbortController>());
  useEffect(() => () => nameCtrls.current.forEach((c) => c.abort()), []);

  // A pick left over from an earlier opening of the form is not a new one.
  const seenSeq = useRef(mapPick?.seq);
  useEffect(() => {
    if (!mapPick || mapPick.seq === seenSeq.current) return;
    seenSeq.current = mapPick.seq;
    const { lng, lat } = mapPick;
    let id: number;
    let dayId: number | undefined;
    const label = coordLabel(lat, lng);
    const picked: GeoResult = { name: label, lng, lat };
    if (mapPick.slotId !== undefined) {
      id = mapPick.slotId;
      patchSlot(id, { value: label, picked });
    } else {
      const action = pickAction(
        {
          startId: start.id,
          startFilled: !!start.picked || start.value.trim() !== "",
          days: days.map((d) => ({
            id: d.id,
            stops: d.stops.map((s) => ({ id: s.id, filled: !!s.picked || s.value.trim() !== "" })),
          })),
        },
        focusedRef.current,
        mapPick.target,
      );
      focusedRef.current = null;
      if (action.kind === "fill") {
        id = action.id;
        dayId = days.find((d) => d.stops.some((s) => s.id === id))?.id;
        patchSlot(id, { value: label, picked });
      } else {
        const slot = { ...makeSlot(profile), value: label, picked };
        id = slot.id;
        dayId = days[action.dayIndex].id;
        setDays((ds) =>
          ds.map((d, i) =>
            i === action.dayIndex ? { ...d, stops: [...d.stops.slice(0, -1), slot, d.stops[d.stops.length - 1]] } : d,
          ),
        );
      }
      // Show the day the point went into.
      if (dayId !== undefined) setOpenOverrides((o) => ({ ...o, [dayId as number]: true }));
    }
    setError(null);

    // Replace the coordinates by the place name, unless the slot changed meanwhile.
    const ctrl = new AbortController();
    nameCtrls.current.add(ctrl);
    reverseGeocode(lat, lng, ctrl.signal)
      .then((name) => {
        if (!name) return;
        patchSlot(id, { value: name, picked: { ...picked, name } }, (s) => s.picked === picked);
      })
      .catch(() => {
        /* offline / aborted: the coordinates stay */
      })
      .finally(() => nameCtrls.current.delete(ctrl));
    // Only a new pick (seq) triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapPick?.seq]);

  // Publish the chosen points so the map can show them while planning.
  const pointsRef = useRef(onPointsChange);
  pointsRef.current = onPointsChange;
  useEffect(() => {
    if (!pointsRef.current) return;
    const pts: Waypoint[] = [];
    const add = (s: Slot, dayEnd?: boolean) => {
      if (s.picked)
        pts.push({ id: `plan-${s.id}`, lng: s.picked.lng, lat: s.picked.lat, name: s.picked.name, legProfile: s.legProfile, dayEnd });
    };
    add(start);
    days.forEach((d, di) => d.stops.forEach((s, j) => add(s, j === d.stops.length - 1 && di < days.length - 1)));
    pointsRef.current(pts);
  }, [start, days]);

  const patchStop = (di: number, id: number, patch: Partial<Slot>) =>
    setDays((ds) =>
      ds.map((d, i) =>
        i === di
          ? { ...d, stops: d.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
          : d,
      ),
    );

  const addStop = (di: number) =>
    setDays((ds) =>
      ds.map((d, i) =>
        i === di ? { ...d, stops: [...d.stops.slice(0, -1), makeSlot(profile), d.stops[d.stops.length - 1]] } : d,
      ),
    );

  const removeStop = (di: number, id: number) =>
    setDays((ds) =>
      ds.map((d, i) =>
        i === di && d.stops.length > 1
          ? { ...d, stops: d.stops.filter((s) => s.id !== id) }
          : d,
      ),
    );

  const moveStop = (di: number, id: number, dir: -1 | 1) =>
    setDays((ds) =>
      ds.map((d, i) => {
        if (i !== di) return d;
        const j = d.stops.findIndex((s) => s.id === id);
        const k = j + dir;
        if (j < 0 || k < 0 || k >= d.stops.length) return d;
        const stops = [...d.stops];
        [stops[j], stops[k]] = [stops[k], stops[j]];
        return { ...d, stops };
      }),
    );

  const addDay = () => setDays((ds) => [...ds, { id: uid++, stops: [makeSlot(profile)] }]);

  const removeDay = (di: number) => setDays((ds) => (ds.length > 1 ? ds.filter((_, i) => i !== di) : ds));

  const chooseProfile = (p: RouteProfile) => {
    setProfile(p);
    setStart((s) => ({ ...s, legProfile: p }));
    setDays((ds) => ds.map((d) => ({ ...d, stops: d.stops.map((s) => ({ ...s, legProfile: p })) })));
  };

  // Closing the dialog cancels the geocoding so a late answer can't replace the
  // route behind the rider's back.
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctrlRef.current?.abort(), []);
  const close = () => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    onClose();
  };

  const resolve = async (
    slot: Slot,
    signal: AbortSignal,
    prev?: { lat: number; lng: number },
  ): Promise<GeoResult | null> => {
    if (slot.picked) return slot.picked;
    if (slot.value.trim().length < 2) return null;
    const found = await searchPlaces(slot.value.trim(), signal, prev);
    if (!found[0]) throw new Error(`Kein Ort gefunden für „${slot.value.trim()}“.`);
    return found[0];
  };

  const submit = async () => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const flat: QuickStop[] = [];
      const startPlace = await resolve(start, ctrl.signal);
      if (!startPlace) throw new Error("Bitte einen Start angeben.");
      flat.push({ name: startPlace.name, lng: startPlace.lng, lat: startPlace.lat, legProfile: start.legProfile });
      let prev = { lat: startPlace.lat, lng: startPlace.lng };

      for (let di = 0; di < days.length; di++) {
        const day = days[di];
        const resolvedDay: { place: GeoResult; legProfile: RouteProfile }[] = [];
        for (const slot of day.stops) {
          const place = await resolve(slot, ctrl.signal, prev);
          if (place) {
            resolvedDay.push({ place, legProfile: slot.legProfile });
            prev = { lat: place.lat, lng: place.lng };
          }
        }
        if (resolvedDay.length === 0) {
          throw new Error(`Tag ${di + 1} braucht mindestens ein Ziel.`);
        }
        resolvedDay.forEach((r, idx) => {
          const isDayLast = idx === resolvedDay.length - 1;
          const isFinalDay = di === days.length - 1;
          flat.push({
            name: r.place.name,
            lng: r.place.lng,
            lat: r.place.lat,
            legProfile: r.legProfile,
            dayEnd: isDayLast && !isFinalDay,
          });
        });
      }

      if (flat.length < 2) throw new Error("Bitte mindestens Start und Ziel angeben.");
      if (ctrl.signal.aborted) return;
      onApply(flat);
    } catch (e) {
      if (isAbort(e) || ctrl.signal.aborted) return;
      setError((e as Error).message);
    } finally {
      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null;
        setBusy(false);
      }
    }
  };

  // A single editable stop row with number, autocomplete and controls.
  const stopRow = (
    di: number,
    slot: Slot,
    num: number,
    isLast: boolean,
    canRemove: boolean,
    bias: { lat: number; lng: number } | undefined,
    placeholder: string,
  ) => (
    <div className="qp-row" key={slot.id}>
      <span className="wp-dot" data-role={isLast ? "end" : "via"}>{num}</span>
      <PlaceInput
        value={slot.value}
        placeholder={placeholder}
        bias={bias}
        onChange={(v) => patchStop(di, slot.id, { value: v, picked: undefined })}
        onPick={(r) => patchStop(di, slot.id, { value: r.name, picked: r })}
        onFocus={() => (focusedRef.current = slot.id)}
      />
      <span className="qp-actions">
        <button className="wp-btn" onClick={() => moveStop(di, slot.id, -1)} aria-label="Nach oben"><Icon name="up" size={16} /></button>
        <button className="wp-btn" onClick={() => moveStop(di, slot.id, 1)} aria-label="Nach unten"><Icon name="down" size={16} /></button>
        <button className="wp-btn remove" disabled={!canRemove} onClick={() => removeStop(di, slot.id)} aria-label="Entfernen"><Icon name="x" size={16} /></button>
      </span>
    </div>
  );

  const title = initialStops ? "Tour bearbeiten" : "Tour planen";
  const body = (
        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Pro Tag ein Block. Jeder Tag startet an der Übernachtung des Vortags.
            „+ Tag“ fügt einen weiteren Tag an.
            {variant === "sidebar" && (
              <>
                {" "}
                <strong>Klick auf die Karte</strong> setzt den Punkt ins zuletzt gewählte oder
                nächste leere Feld, Rechtsklick wählt Start, Zwischenziel oder Ziel.
              </>
            )}
          </p>

          {days.map((day, di) => {
            const prevDayLast = di > 0 ? days[di - 1].stops[days[di - 1].stops.length - 1] : null;
            const startName = di === 0
              ? null
              : prevDayLast?.value || "(Ziel des Vortags)";
            // bias chain for this day's first editable stop
            let prevBias = di === 0
              ? start.picked
              : prevDayLast?.picked;
            const isLastDay = di === days.length - 1;
            const open = isDayOpen(day.id, isLastDay);
            const destName = day.stops[day.stops.length - 1]?.value || "—";
            return (
              <div className={`qp-day ${open ? "" : "collapsed"}`} key={day.id}>
                <div className="qp-day-head">
                  <button
                    className="qp-day-toggle"
                    onClick={() => toggleDay(day.id, isLastDay)}
                    aria-expanded={open}
                  >
                    <span className="day-chevron" data-open={open}><Icon name="chevron" size={16} /></span>
                    <span className="qp-day-title">Tag {di + 1}</span>
                    {!open && <span className="qp-day-summary">→ {destName}</span>}
                  </button>
                  {di > 0 && (
                    <button className="qp-day-remove" onClick={() => removeDay(di)}>
                      entfernen
                    </button>
                  )}
                </div>

                {open && (
                <>
                {/* Start of the day */}
                {di === 0 ? (
                  <div className="qp-row">
                    <span className="wp-dot" data-role="start">1</span>
                    <PlaceInput
                      value={start.value}
                      placeholder="Start"
                      onChange={(v) => patchStart({ value: v, picked: undefined })}
                      onPick={(r) => patchStart({ value: r.name, picked: r })}
                      onFocus={() => (focusedRef.current = start.id)}
                    />
                    <span className="qp-actions" />
                  </div>
                ) : (
                  <div className="qp-row locked">
                    <span className="wp-dot" data-role="start">1</span>
                    <span className="qp-locked"><Icon name="bed" size={14} /> ab {startName}</span>
                  </div>
                )}

                {/* This day's stops, numbered from 2 */}
                {day.stops.map((slot, j) => {
                  const num = j + 2;
                  const isLast = j === day.stops.length - 1;
                  const bias = j === 0 ? prevBias : day.stops[j - 1].picked;
                  return stopRow(
                    di,
                    slot,
                    num,
                    isLast,
                    day.stops.length > 1,
                    bias,
                    isLast ? `Ziel Tag ${di + 1}` : "Zwischenziel",
                  );
                })}

                <button className="add-stop-btn" onClick={() => addStop(di)}>
                  <Icon name="plus" size={15} /> Zwischenziel
                </button>
                </>
                )}
              </div>
            );
          })}

          <button className="add-day-btn" onClick={addDay}><Icon name="plus" size={16} /> Tag hinzufügen</button>

          <div className="qp-profile">
            <span className="default-label">Fahrstil (alle Abschnitte):</span>
            <span className="toggle">
              {(["kurvig", "kurvig_plus", "schnell"] as RouteProfile[]).map((p) => (
                <button
                  key={p}
                  className={`toggle-btn ${profile === p ? "active" : ""} ${p}`}
                  onClick={() => chooseProfile(p)}
                  title={PROFILE_HINT[p]}
                  aria-label={PROFILE_HINT[p]}
                  aria-pressed={profile === p}
                >
                  {PROFILE_LABEL[p]}
                </button>
              ))}
            </span>
          </div>
          <p className="modal-note toggle-legend">
            Fun 1: kurvig über kleine Strassen · Fun 2: maximal kurvig, auch Umwege · Schnell:
            direkt, auch Autobahn. Pro Abschnitt später im Panel änderbar.
          </p>

          {error && <p className="error">⚠ {error}</p>}

          <button className="export-btn primary" disabled={busy} onClick={submit}>
            {busy ? "Tour wird erstellt …" : "Tour erstellen"}
          </button>
        </div>
  );

  return variant === "sidebar" ? (
    <SidebarView title={title} onClose={close}>
      {body}
    </SidebarView>
  ) : (
    <Modal title={title} onClose={close}>
      {body}
    </Modal>
  );
}
