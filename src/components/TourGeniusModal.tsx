import { useState } from "react";
import Icon from "./Icon";
import PlaceInput from "./PlaceInput";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import { findTours, findToursToDest, type TourCandidate, type TourDuration } from "../lib/tourgen";
import type { RouteProfile } from "../types";

interface Props {
  onResults: (candidates: TourCandidate[], profile: RouteProfile) => void;
  onClose: () => void;
}

type TourMode = "round" | "dest";

const PROFILES: { id: RouteProfile; label: string }[] = [
  { id: "kurvig", label: "Fun 1" },
  { id: "kurvig_plus", label: "Fun 2" },
];

export default function TourGeniusModal({ onResults, onClose }: Props) {
  const [mode, setMode] = useState<TourMode>("round");
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<GeoResult | undefined>();
  const [destValue, setDestValue] = useState("");
  const [destPicked, setDestPicked] = useState<GeoResult | undefined>();
  const [duration, setDuration] = useState<TourDuration>("half");
  // Default to the twistiest style (moped → avoids fast roads, prefers small
  // Landstrassen) so the Genius leans into curvy back-roads, not Hauptstrassen.
  const [profile, setProfile] = useState<RouteProfile>("kurvig_plus");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve a typed place to coordinates, reusing an already picked suggestion.
  const resolve = async (
    text: string,
    pick: GeoResult | undefined,
    setPick: (r: GeoResult) => void,
    setText: (s: string) => void,
    label: string,
  ): Promise<GeoResult> => {
    if (pick) return pick;
    if (text.trim().length < 2) throw new Error(`Bitte einen ${label} angeben.`);
    const found = await searchPlaces(text.trim());
    if (!found[0]) throw new Error(`Kein Ort gefunden für „${text.trim()}".`);
    setPick(found[0]);
    setText(found[0].name);
    return found[0];
  };

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const start = await resolve(value, picked, setPicked, setValue, "Startort");
      if (mode === "dest") {
        const dest = await resolve(destValue, destPicked, setDestPicked, setDestValue, "Zielort");
        const cands = await findToursToDest(
          { lat: start.lat, lng: start.lng, name: start.name },
          { lat: dest.lat, lng: dest.lng, name: dest.name },
          duration,
          profile,
        );
        onResults(cands, profile);
      } else {
        const cands = await findTours(
          { lat: start.lat, lng: start.lng, name: start.name },
          duration,
          profile,
        );
        onResults(cands, profile);
      }
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
          <span className="toggle tg-modes">
            <button
              className={`toggle-btn ${mode === "round" ? "active" : ""}`}
              onClick={() => setMode("round")}
            >
              <Icon name="loop" size={15} /> Rundtour
            </button>
            <button
              className={`toggle-btn ${mode === "dest" ? "active" : ""}`}
              onClick={() => setMode("dest")}
            >
              <Icon name="flag" size={15} /> Zielort
            </button>
          </span>

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

          {mode === "dest" && (
            <>
              <label className="tg-label">Zielort</label>
              <div className="qp-row">
                <span className="wp-dot" data-role="end"><Icon name="flag" size={14} /></span>
                <PlaceInput
                  value={destValue}
                  placeholder="z. B. Lugano"
                  onChange={(v) => {
                    setDestValue(v);
                    setDestPicked(undefined);
                  }}
                  onPick={(r) => {
                    setDestValue(r.name);
                    setDestPicked(r);
                  }}
                />
                <span className="qp-actions" />
              </div>
            </>
          )}

          <label className="tg-label">Dauer</label>
          <div className="tg-choices compact">
            <button
              className={`tg-choice ${duration === "half" ? "active" : ""}`}
              onClick={() => setDuration("half")}
            >
              <strong>½ Tag</strong>
            </button>
            <button
              className={`tg-choice ${duration === "full" ? "active" : ""}`}
              onClick={() => setDuration("full")}
            >
              <strong>1 Tag</strong>
            </button>
          </div>

          <label className="tg-label">Fahrstil</label>
          <span className="toggle tg-styles">
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

          <button className="export-btn primary tg-go" disabled={busy} onClick={search}>
            {busy ? "Beste Tour wird gesucht …" : (
              <><Icon name="compass" size={17} /> Tour finden</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
