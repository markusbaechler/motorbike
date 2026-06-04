import { useState } from "react";
import PlaceInput from "./PlaceInput";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import type { RouteProfile } from "../types";

export interface QuickStop {
  name?: string;
  lng: number;
  lat: number;
  legProfile: RouteProfile;
  dayEnd?: boolean;
}

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
}: Props) {
  const init = buildInitial(initialStops, defaultProfile);
  const [start, setStart] = useState<Slot>(init.start);
  const [days, setDays] = useState<Day[]>(init.days);
  const [profile, setProfile] = useState<RouteProfile>(defaultProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchStart = (patch: Partial<Slot>) => setStart((s) => ({ ...s, ...patch }));

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

  const resolve = async (
    slot: Slot,
    prev?: { lat: number; lng: number },
  ): Promise<GeoResult | null> => {
    if (slot.picked) return slot.picked;
    if (slot.value.trim().length < 2) return null;
    const found = await searchPlaces(slot.value.trim(), undefined, prev);
    if (!found[0]) throw new Error(`Kein Ort gefunden für „${slot.value.trim()}".`);
    return found[0];
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const flat: QuickStop[] = [];
      const startPlace = await resolve(start);
      if (!startPlace) throw new Error("Bitte einen Start angeben.");
      flat.push({ name: startPlace.name, lng: startPlace.lng, lat: startPlace.lat, legProfile: start.legProfile });
      let prev = { lat: startPlace.lat, lng: startPlace.lng };

      for (let di = 0; di < days.length; di++) {
        const day = days[di];
        const resolvedDay: { place: GeoResult; legProfile: RouteProfile }[] = [];
        for (const slot of day.stops) {
          const place = await resolve(slot, prev);
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
      onApply(flat);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
      />
      <span className="qp-actions">
        <button className="wp-btn" onClick={() => moveStop(di, slot.id, -1)} aria-label="Nach oben">↑</button>
        <button className="wp-btn" onClick={() => moveStop(di, slot.id, 1)} aria-label="Nach unten">↓</button>
        <button className="wp-btn remove" disabled={!canRemove} onClick={() => removeStop(di, slot.id)} aria-label="Entfernen">✕</button>
      </span>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{initialStops ? "Route bearbeiten" : "Tour schnell planen"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Pro Tag ein Block. Jeder Tag startet an der Übernachtung des Vortags.
            „+ Tag" fügt einen weiteren Tag an.
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
            return (
              <div className="qp-day" key={day.id}>
                <div className="qp-day-head">
                  <span className="qp-day-title">Tag {di + 1}</span>
                  {di > 0 && (
                    <button className="qp-day-remove" onClick={() => removeDay(di)}>
                      Tag entfernen
                    </button>
                  )}
                </div>

                {/* Start of the day */}
                {di === 0 ? (
                  <div className="qp-row">
                    <span className="wp-dot" data-role="start">1</span>
                    <PlaceInput
                      value={start.value}
                      placeholder="Start"
                      onChange={(v) => patchStart({ value: v, picked: undefined })}
                      onPick={(r) => patchStart({ value: r.name, picked: r })}
                    />
                    <span className="qp-actions" />
                  </div>
                ) : (
                  <div className="qp-row locked">
                    <span className="wp-dot" data-role="start">1</span>
                    <span className="qp-locked">🛏 ab {startName}</span>
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
                  + Zwischenziel
                </button>
              </div>
            );
          })}

          <button className="add-day-btn" onClick={addDay}>+ Tag hinzufügen</button>

          <div className="qp-profile">
            <span className="default-label">Profil (alle Etappen):</span>
            <span className="toggle">
              {(["kurvig", "kurvig_plus", "schnell"] as RouteProfile[]).map((p) => (
                <button
                  key={p}
                  className={`toggle-btn ${profile === p ? "active" : ""} ${p}`}
                  onClick={() => chooseProfile(p)}
                >
                  {p === "kurvig" ? "Kurvig" : p === "kurvig_plus" ? "Kurvig+" : "Schnell"}
                </button>
              ))}
            </span>
          </div>

          {error && <p className="error">⚠ {error}</p>}

          <button className="export-btn primary" disabled={busy} onClick={submit}>
            {busy ? "Route wird erstellt …" : "Route erstellen"}
          </button>
        </div>
      </div>
    </div>
  );
}
