import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import PlaceInput from "./PlaceInput";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import {
  findTours,
  findToursToDest,
  type TourCandidate,
  type TourDuration,
  type TourProgress,
} from "../lib/tourgen";
import { useThrottleWait } from "../lib/useThrottleWait";
import type { RouteProfile } from "../types";

interface Props {
  onResults: (candidates: TourCandidate[], profile: RouteProfile) => void;
  onClose: () => void;
  // Desktop: shown in the left sidebar instead of as a dialog.
  variant?: "modal" | "sidebar";
}

type TourMode = "round" | "dest";

const PROFILES: { id: RouteProfile; label: string }[] = [
  { id: "kurvig", label: "Fun 1" },
  { id: "kurvig_plus", label: "Fun 2" },
];

const isAbort = (e: unknown) => (e as Error | null)?.name === "AbortError";

export default function TourGeniusModal({ onResults, onClose, variant }: Props) {
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
  const [progress, setProgress] = useState<TourProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The public router allows ~17 requests a minute; the queue then waits.
  const throttleWait = useThrottleWait();

  // A search fires dozens of routing requests and can run for minutes. Closing
  // the dialog cancels it; otherwise the result would pop up on the map later,
  // long after the rider moved on.
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  const cancel = () => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setBusy(false);
    setProgress(null);
  };
  const close = () => {
    cancel();
    onClose();
  };

  // Resolve a typed place to coordinates, reusing an already picked suggestion.
  const resolve = async (
    text: string,
    pick: GeoResult | undefined,
    setPick: (r: GeoResult) => void,
    setText: (s: string) => void,
    label: string,
    signal: AbortSignal,
  ): Promise<GeoResult> => {
    if (pick) return pick;
    if (text.trim().length < 2) throw new Error(`Bitte einen ${label} angeben.`);
    const found = await searchPlaces(text.trim(), signal);
    if (!found[0]) throw new Error(`Kein Ort gefunden für „${text.trim()}“.`);
    setPick(found[0]);
    setText(found[0].name);
    return found[0];
  };

  const search = async () => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setBusy(true);
    setError(null);
    setProgress(null);
    const report = (p: TourProgress) => {
      if (!ctrl.signal.aborted) setProgress(p);
    };
    try {
      const start = await resolve(value, picked, setPicked, setValue, "Startort", ctrl.signal);
      let cands: TourCandidate[];
      if (mode === "dest") {
        const dest = await resolve(destValue, destPicked, setDestPicked, setDestValue, "Zielort", ctrl.signal);
        cands = await findToursToDest(
          { lat: start.lat, lng: start.lng, name: start.name },
          { lat: dest.lat, lng: dest.lng, name: dest.name },
          duration,
          profile,
          ctrl.signal,
          report,
        );
      } else {
        cands = await findTours(
          { lat: start.lat, lng: start.lng, name: start.name },
          duration,
          profile,
          ctrl.signal,
          report,
        );
      }
      if (ctrl.signal.aborted) return;
      onResults(cands, profile);
    } catch (e) {
      if (isAbort(e) || ctrl.signal.aborted) return;
      setError((e as Error).message);
    } finally {
      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null;
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const progressText =
    (progress && progress.total > 0
      ? `${progress.label}: ${progress.done} von ${progress.total} berechnet …`
      : "Startort wird gesucht …") +
    (throttleWait > 0 ? ` Routing-Dienst bremst kurz, weiter in ${throttleWait} s.` : "");

  return (
    <Modal
      title={
        <>
          <Icon name="compass" size={20} /> Tour-Genius
        </>
      }
      onClose={close}
      variant={variant}
    >
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

        {busy ? (
          <div className="tg-busy">
            <p className="tg-progress" role="status" aria-live="polite">
              <span className="tg-spinner" aria-hidden="true" /> {progressText}
            </p>
            <button className="export-btn tg-go" onClick={cancel}>
              <Icon name="x" size={16} /> Suche abbrechen
            </button>
          </div>
        ) : (
          <button className="export-btn primary tg-go" onClick={search}>
            <Icon name="compass" size={17} /> Tour finden
          </button>
        )}
        <p className="modal-note">
          Die Suche berechnet viele Varianten über den Routing-Dienst. Er erlaubt nur rund 15 Anfragen
          pro Minute, darum dauert sie 2 bis 4 Minuten.
        </p>
      </div>
    </Modal>
  );
}
