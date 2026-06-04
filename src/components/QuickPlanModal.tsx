import { useState } from "react";
import PlaceInput from "./PlaceInput";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import type { RouteProfile } from "../types";

interface Slot {
  id: number;
  value: string;
  picked?: GeoResult;
}

interface Props {
  onApply: (places: GeoResult[], profile: RouteProfile) => void;
  onClose: () => void;
}

let slotId = 1;
const newSlot = (): Slot => ({ id: slotId++, value: "" });

export default function QuickPlanModal({ onApply, onClose }: Props) {
  const [slots, setSlots] = useState<Slot[]>([newSlot(), newSlot()]);
  const [profile, setProfile] = useState<RouteProfile>("kurvig");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (id: number, patch: Partial<Slot>) =>
    setSlots((s) => s.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));

  const addStop = () =>
    setSlots((s) => {
      // Insert a new stop before the final (destination) row.
      const copy = [...s];
      copy.splice(copy.length - 1, 0, newSlot());
      return copy;
    });

  const removeSlot = (id: number) =>
    setSlots((s) => (s.length > 2 ? s.filter((slot) => slot.id !== id) : s));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const places: GeoResult[] = [];
      for (const slot of slots) {
        if (slot.picked) {
          places.push(slot.picked);
        } else if (slot.value.trim().length >= 2) {
          const found = await searchPlaces(slot.value.trim());
          if (found[0]) places.push(found[0]);
          else throw new Error(`Kein Ort gefunden für „${slot.value.trim()}".`);
        }
      }
      if (places.length < 2) {
        throw new Error("Bitte mindestens Start und Ziel angeben.");
      }
      onApply(places, profile);
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
          <h2>Tagesetappe schnell planen</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Orte eintippen und aus der Liste wählen. „Route erstellen" baut die
            ganze Strecke auf einmal.
          </p>

          <div className="qp-rows">
            {slots.map((slot, i) => (
              <div className="qp-row" key={slot.id}>
                <span
                  className="wp-dot"
                  data-role={i === 0 ? "start" : i === slots.length - 1 ? "end" : "via"}
                >
                  {i + 1}
                </span>
                <PlaceInput
                  value={slot.value}
                  placeholder={label(i)}
                  onChange={(v) => update(slot.id, { value: v, picked: undefined })}
                  onPick={(r) => update(slot.id, { value: r.name, picked: r })}
                />
                {slots.length > 2 && (
                  <button
                    className="wp-btn remove"
                    onClick={() => removeSlot(slot.id)}
                    aria-label="Entfernen"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <button className="add-stop-btn" onClick={addStop}>
            + Zwischenziel
          </button>

          <div className="qp-profile">
            <span className="default-label">Profil:</span>
            <span className="toggle">
              {(["kurvig", "schnell"] as RouteProfile[]).map((p) => (
                <button
                  key={p}
                  className={`toggle-btn ${profile === p ? "active" : ""} ${p}`}
                  onClick={() => setProfile(p)}
                >
                  {p === "kurvig" ? "Kurvig" : "Schnell"}
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
