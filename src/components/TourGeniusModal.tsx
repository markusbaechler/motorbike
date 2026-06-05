import { useState } from "react";
import Icon from "./Icon";
import PlaceInput from "./PlaceInput";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import { findTours, targetKm, type TourCandidate, type TourDuration } from "../lib/tourgen";
import type { RouteProfile } from "../types";

interface Props {
  onResults: (candidates: TourCandidate[], profile: RouteProfile) => void;
  onClose: () => void;
}

const PROFILES: { id: RouteProfile; label: string }[] = [
  { id: "kurvig", label: "Fun 1" },
  { id: "kurvig_plus", label: "Fun 2" },
];

export default function TourGeniusModal({ onResults, onClose }: Props) {
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<GeoResult | undefined>();
  const [duration, setDuration] = useState<TourDuration>("half");
  // Default to the twistiest style (moped → avoids fast roads, prefers small
  // Landstrassen) so the Genius leans into curvy back-roads, not Hauptstrassen.
  const [profile, setProfile] = useState<RouteProfile>("kurvig_plus");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      let start = picked;
      if (!start) {
        if (value.trim().length < 2) throw new Error("Bitte einen Startort angeben.");
        const found = await searchPlaces(value.trim());
        if (!found[0]) throw new Error(`Kein Ort gefunden für „${value.trim()}".`);
        start = found[0];
        setPicked(start);
        setValue(start.name);
      }
      const cands = await findTours(
        { lat: start.lat, lng: start.lng, name: start.name },
        duration,
        profile,
      );
      onResults(cands, profile);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Icon name="compass" size={20} /> Tour-Genius</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Startort und Dauer wählen – der Genius findet die statistisch beste
            Rundtour zurück zum Start und zeigt sie auf der Karte.
          </p>

          <label className="tg-label">Startort</label>
          <div className="qp-row">
            <span className="wp-dot" data-role="start"><Icon name="flag" size={14} /></span>
            <PlaceInput
              value={value}
              placeholder="z. B. Luzern"
              onChange={(v) => {
                setValue(v);
                setPicked(undefined);
              }}
              onPick={(r) => {
                setValue(r.name);
                setPicked(r);
              }}
            />
            <span className="qp-actions" />
          </div>

          <label className="tg-label">Dauer</label>
          <div className="tg-choices">
            <button
              className={`tg-choice ${duration === "half" ? "active" : ""}`}
              onClick={() => setDuration("half")}
            >
              <strong>½ Tag</strong>
              <span>≈ {targetKm("half")} km</span>
            </button>
            <button
              className={`tg-choice ${duration === "full" ? "active" : ""}`}
              onClick={() => setDuration("full")}
            >
              <strong>1 Tag</strong>
              <span>≈ {targetKm("full")} km</span>
            </button>
          </div>

          <label className="tg-label">Fahrstil</label>
          <span className="toggle">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                className={`toggle-btn ${profile === p.id ? "active" : ""} ${p.id}`}
                onClick={() => setProfile(p.id)}
              >
                {p.label}
              </button>
            ))}
          </span>

          {error && <p className="error">⚠ {error}</p>}

          <button className="export-btn primary" disabled={busy} onClick={search}>
            {busy ? "Beste Tour wird gesucht …" : (
              <><Icon name="compass" size={17} /> Tour finden</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
