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
  dayEnd?: boolean;
}

interface Props {
  initialStops?: QuickStop[];
  defaultProfile: RouteProfile;
  onApply: (stops: QuickStop[]) => void;
  onClose: () => void;
}

let slotId = 1;

export default function QuickPlanModal({
  initialStops,
  defaultProfile,
  onApply,
  onClose,
}: Props) {
  const [profile, setProfile] = useState<RouteProfile>(defaultProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slots, setSlots] = useState<Slot[]>(() => {
    if (initialStops && initialStops.length >= 2) {
      return initialStops.map((s) => ({
        id: slotId++,
        value: s.name ?? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`,
        picked: { name: s.name ?? "Punkt", lng: s.lng, lat: s.lat },
        legProfile: s.legProfile,
        dayEnd: s.dayEnd,
      }));
    }
    return [
      { id: slotId++, value: "", legProfile: defaultProfile },
      { id: slotId++, value: "", legProfile: defaultProfile },
    ];
  });

  const update = (id: number, patch: Partial<Slot>) =>
    setSlots((s) => s.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));

  const addStop = () =>
    setSlots((s) => {
      const copy = [...s];
      copy.splice(copy.length - 1, 0, {
        id: slotId++,
        value: "",
        legProfile: profile,
      });
      return copy;
    });

  const removeSlot = (id: number) =>
    setSlots((s) => (s.length > 2 ? s.filter((slot) => slot.id !== id) : s));

  const moveSlot = (id: number, dir: -1 | 1) =>
    setSlots((s) => {
      const i = s.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  // Bulk-set all legs to one profile (and use it for new rows).
  const chooseProfile = (p: RouteProfile) => {
    setProfile(p);
    setSlots((s) => s.map((slot) => ({ ...slot, legProfile: p })));
  };

  const toggleDayEnd = (id: number) =>
    setSlots((s) => s.map((slot) => (slot.id === id ? { ...slot, dayEnd: !slot.dayEnd } : slot)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const stops: QuickStop[] = [];
      let prev: { lat: number; lng: number } | undefined;
      for (const slot of slots) {
        let place: GeoResult | undefined = slot.picked;
        if (!place && slot.value.trim().length >= 2) {
          const found = await searchPlaces(slot.value.trim(), undefined, prev);
          if (!found[0]) throw new Error(`Kein Ort gefunden für „${slot.value.trim()}".`);
          place = found[0];
        }
        if (place) {
          stops.push({
            name: place.name,
            lng: place.lng,
            lat: place.lat,
            legProfile: slot.legProfile,
            dayEnd: slot.dayEnd,
          });
          prev = { lat: place.lat, lng: place.lng };
        }
      }
      if (stops.length < 2) throw new Error("Bitte mindestens Start und Ziel angeben.");
      onApply(stops);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label = (i: number) =>
    i === 0 ? "Start" : i === slots.length - 1 ? "Ziel" : `Zwischenziel ${i}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{initialStops ? "Route bearbeiten" : "Tour schnell planen"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Orte eintippen und aus der Liste wählen. Reihenfolge mit ↑/↓ ändern.
            „Route erstellen" baut die ganze Strecke (ersetzt die aktuelle).
          </p>

          <div className="qp-rows">
            {slots.map((slot, i) => {
              // Day number = 1 + overnight stops before this row. A new day
              // starts on the row right after an overnight (dayEnd) stop.
              const day = 1 + slots.slice(0, i).filter((s) => s.dayEnd).length;
              const showHeader = i === 0 || !!slots[i - 1].dayEnd;
              const isLast = i === slots.length - 1;
              return (
                <div key={slot.id}>
                  {showHeader && <div className="qp-day-header">Tag {day}</div>}
                  <div className="qp-row">
                    <span
                      className="wp-dot"
                      data-role={i === 0 ? "start" : isLast ? "end" : "via"}
                    >
                      {i + 1}
                    </span>
                    <PlaceInput
                      value={slot.value}
                      placeholder={label(i)}
                      bias={i > 0 ? slots[i - 1].picked : undefined}
                      onChange={(v) => update(slot.id, { value: v, picked: undefined })}
                      onPick={(r) => update(slot.id, { value: r.name, picked: r })}
                    />
                    <span className="qp-actions">
                      {i > 0 && !isLast && (
                        <button
                          className={`wp-btn bed ${slot.dayEnd ? "active" : ""}`}
                          onClick={() => toggleDayEnd(slot.id)}
                          aria-label="Übernachtung / Tag beenden"
                          title="Hier übernachten (Tag beenden)"
                        >
                          🛏
                        </button>
                      )}
                      <button
                        className="wp-btn"
                        disabled={i === 0}
                        onClick={() => moveSlot(slot.id, -1)}
                        aria-label="Nach oben"
                      >
                        ↑
                      </button>
                      <button
                        className="wp-btn"
                        disabled={isLast}
                        onClick={() => moveSlot(slot.id, 1)}
                        aria-label="Nach unten"
                      >
                        ↓
                      </button>
                      <button
                        className="wp-btn remove"
                        disabled={slots.length <= 2}
                        onClick={() => removeSlot(slot.id)}
                        aria-label="Entfernen"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="add-stop-btn" onClick={addStop}>
            + Zwischenziel
          </button>

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
