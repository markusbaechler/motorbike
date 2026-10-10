import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import PlaceInput from "./PlaceInput";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import {
  ensureEuroPasses,
  passesInCorridor,
  type KeyedPass,
  type SurfaceFilter,
} from "../lib/passplanner";

// Half-width of the corridor between start and destination (and the radius
// around the start for round trips). Generous on purpose so plenty of passes
// show up to choose from; the router-scored optimiser only actually rides the
// ones that fit the loop, so a wide search costs nothing in route quality.
const CORRIDOR_KM = 100;

export interface PassSession {
  start: GeoResult;
  end: GeoResult | null; // null → round trip
  passes: KeyedPass[];
  autoFill: boolean; // auto-insert through-passes that lie along the route
}

interface Props {
  onReady: (session: PassSession) => void;
  onClose: () => void;
  // Desktop: shown in the left sidebar instead of as a dialog.
  variant?: "modal" | "sidebar";
}

const isAbort = (e: unknown) => (e as Error | null)?.name === "AbortError";

export default function PassPlannerModal({ onReady, onClose, variant }: Props) {
  const [startVal, setStartVal] = useState("");
  const [startPick, setStartPick] = useState<GeoResult | undefined>();
  const [roundTrip, setRoundTrip] = useState(true);
  const [destVal, setDestVal] = useState("");
  const [destPick, setDestPick] = useState<GeoResult | undefined>();
  const [surface, setSurface] = useState<SurfaceFilter>("asphalt");
  const [autoFill, setAutoFill] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Closing the dialog cancels a running lookup so it can't open the pass
  // picker after the rider already left.
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctrlRef.current?.abort(), []);
  const close = () => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    onClose();
  };

  // Resolve a typed-but-not-picked field via the geocoder.
  const resolve = async (
    val: string,
    pick: GeoResult | undefined,
    label: string,
    signal: AbortSignal,
  ): Promise<GeoResult> => {
    if (pick) return pick;
    if (val.trim().length < 2) throw new Error(`Bitte einen ${label} angeben.`);
    const found = await searchPlaces(val.trim(), signal);
    if (!found[0]) throw new Error(`Kein Ort gefunden für „${val.trim()}“.`);
    return found[0];
  };

  const go = async () => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const start = await resolve(startVal, startPick, "Startort", ctrl.signal);
      const end = roundTrip ? null : await resolve(destVal, destPick, "Zielort", ctrl.signal);
      const all = await ensureEuroPasses();
      if (ctrl.signal.aborted) return;
      const passes = passesInCorridor(all, {
        start: { lat: start.lat, lng: start.lng },
        end: end ? { lat: end.lat, lng: end.lng } : null,
        surface,
        corridorKm: CORRIDOR_KM,
      });
      if (passes.length === 0) {
        throw new Error("Keine Pässe im Korridor gefunden. Anderen Start/Ziel oder Belag inkl. Unbefestigt versuchen.");
      }
      onReady({ start, end, passes, autoFill });
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

  return (
    <Modal
      title={
        <>
          <Icon name="mountain" size={20} /> Pässeplaner
        </>
      }
      onClose={close}
      variant={variant}
      className="modal-pass"
    >
      <div className="modal-body">
        <p className="modal-note" style={{ marginTop: 0 }}>
          Start wählen → Pässe auf der Karte als Muss / Kann markieren → Tour
          erstellen.
        </p>

        <label className="tg-label">Startort</label>
        <PlaceInput
          value={startVal}
          placeholder="z. B. Wassen, Uri"
          onChange={(v) => { setStartVal(v); setStartPick(undefined); }}
          onPick={(r) => { setStartVal(r.name); setStartPick(r); }}
        />

        <label className="check-row">
          <input
            type="checkbox"
            checked={roundTrip}
            onChange={(e) => setRoundTrip(e.target.checked)}
          />
          <span>Rundtour (zurück zum Start)</span>
        </label>

        {!roundTrip && (
          <>
            <label className="tg-label">Zielort</label>
            <PlaceInput
              value={destVal}
              placeholder="z. B. Bozen"
              bias={startPick ? { lat: startPick.lat, lng: startPick.lng } : undefined}
              onChange={(v) => { setDestVal(v); setDestPick(undefined); }}
              onPick={(r) => { setDestVal(r.name); setDestPick(r); }}
            />
          </>
        )}

        <label className="tg-label">Belag</label>
        <span className="toggle">
          <button
            className={`toggle-btn ${surface === "asphalt" ? "active" : ""}`}
            onClick={() => setSurface("asphalt")}
          >
            Nur Asphalt
          </button>
          <button
            className={`toggle-btn ${surface === "all" ? "active" : ""}`}
            onClick={() => setSurface("all")}
          >
            Inkl. Unbefestigt
          </button>
        </span>

        <label className="check-row">
          <input
            type="checkbox"
            checked={autoFill}
            onChange={(e) => setAutoFill(e.target.checked)}
          />
          <span>Pässe auf dem Weg automatisch ergänzen</span>
        </label>

        {error && <p className="error">⚠ {error}</p>}

        <button className="export-btn primary" disabled={busy} onClick={go}>
          {busy ? "Pässe werden gesucht …" : (
            <><Icon name="mountain" size={17} /> Pässe anzeigen</>
          )}
        </button>
      </div>
    </Modal>
  );
}
