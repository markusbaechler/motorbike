import { useState } from "react";
import Icon from "./Icon";
import PlaceInput from "./PlaceInput";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import { findTours, targetKm, type TourCandidate, type TourDuration } from "../lib/tourgen";
import type { QuickStop } from "./QuickPlanModal";
import type { RouteProfile } from "../types";

interface Props {
  defaultProfile: RouteProfile;
  onApply: (stops: QuickStop[]) => void;
  onClose: () => void;
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const PROFILES: { id: RouteProfile; label: string }[] = [
  { id: "kurvig", label: "Fun 1" },
  { id: "kurvig_plus", label: "Fun 2" },
];

export default function TourGeniusModal({ defaultProfile, onApply, onClose }: Props) {
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<GeoResult | undefined>();
  const [duration, setDuration] = useState<TourDuration>("half");
  const [profile, setProfile] = useState<RouteProfile>(
    defaultProfile === "schnell" ? "kurvig" : defaultProfile,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TourCandidate[] | null>(null);
  const [idx, setIdx] = useState(0);

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
      setResults(cands);
      setIdx(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!results) return;
    const stops: QuickStop[] = results[idx].stops.map((s) => ({
      name: s.name,
      lng: s.lng,
      lat: s.lat,
      legProfile: profile,
    }));
    onApply(stops);
  };

  const cand = results ? results[idx] : null;

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
          {!cand ? (
            <>
              <p className="modal-note" style={{ marginTop: 0 }}>
                Startort und Dauer wählen – der Genius findet die statistisch beste
                Rundtour zurück zum Start.
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
            </>
          ) : (
            <>
              <div className="tg-result">
                <div className="tg-score">
                  <div className="tg-score-num">{cand.analysis.scores.overall.toFixed(1)}</div>
                  <div className="tg-score-lab">von 10<br />Gesamt</div>
                </div>
                <div className="tg-bars">
                  {([
                    ["Kurven", cand.analysis.scores.curves],
                    ["Bergigkeit", cand.analysis.scores.mountains],
                    ["Landschaft", cand.analysis.scores.scenic],
                  ] as [string, number][]).map(([lab, v]) => (
                    <div className="tg-bar" key={lab}>
                      <span>{lab}</span>
                      <span className="tg-track"><span style={{ width: `${v * 10}%` }} /></span>
                      <b>{v.toFixed(1)}</b>
                    </div>
                  ))}
                </div>
              </div>

              <div className="tg-stats">
                <div><b>{cand.distanceKm.toFixed(0)}</b><span>km</span></div>
                <div><b>{fmtDur(cand.durationMin)}</b><span>Fahrzeit</span></div>
                <div><b>{cand.analysis.passes}</b><span>Pässe</span></div>
                <div><b>{cand.analysis.cornersPerKm.toFixed(1)}</b><span>Kurven/km</span></div>
              </div>

              <p className="tg-variant">
                Variante {idx + 1} von {results!.length}
              </p>

              <div className="tg-result-actions">
                <button className="export-btn primary" onClick={apply}>
                  <Icon name="loop" size={17} /> Tour übernehmen
                </button>
                {results!.length > 1 && (
                  <button
                    className="export-btn"
                    onClick={() => setIdx((i) => (i + 1) % results!.length)}
                  >
                    <Icon name="chevron" size={16} /> Andere Variante
                  </button>
                )}
                <button className="tg-back" onClick={() => setResults(null)}>
                  Neue Suche
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
