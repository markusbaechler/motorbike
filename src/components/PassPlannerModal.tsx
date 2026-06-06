import { useState } from "react";
import Icon from "./Icon";
import PlaceInput from "./PlaceInput";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import {
  ensureEuroPasses,
  passesInCorridor,
  type KeyedPass,
  type SurfaceFilter,
} from "../lib/passplanner";

// Half-width of the corridor between start and destination (and the radius
// around the start for round trips).
const CORRIDOR_KM = 60;

export interface PassSession {
  start: GeoResult;
  end: GeoResult | null; // null → round trip
  passes: KeyedPass[];
  autoFill: boolean; // auto-insert through-passes that lie along the route
}

interface Props {
  onReady: (session: PassSession) => void;
  onClose: () => void;
}

export default function PassPlannerModal({ onReady, onClose }: Props) {
  const [startVal, setStartVal] = useState("");
  const [startPick, setStartPick] = useState<GeoResult | undefined>();
  const [roundTrip, setRoundTrip] = useState(true);
  const [destVal, setDestVal] = useState("");
  const [destPick, setDestPick] = useState<GeoResult | undefined>();
  const [surface, setSurface] = useState<SurfaceFilter>("asphalt");
  const [autoFill, setAutoFill] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve a typed-but-not-picked field via the geocoder.
  const resolve = async (
    val: string,
    pick: GeoResult | undefined,
    label: string,
  ): Promise<GeoResult> => {
    if (pick) return pick;
    if (val.trim().length < 2) throw new Error(`Bitte einen ${label} angeben.`);
    const found = await searchPlaces(val.trim());
    if (!found[0]) throw new Error(`Kein Ort gefunden für „${val.trim()}".`);
    return found[0];
  };

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const start = await resolve(startVal, startPick, "Startort");
      const end = roundTrip ? null : await resolve(destVal, destPick, "Zielort");
      const all = await ensureEuroPasses();
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Icon name="mountain" size={20} /> Pässeplaner</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Start (und Ziel) wählen – danach erscheinen die Pässe im Korridor auf
            der Karte. Markiere sie als Need-to / Nice-to und erstelle daraus eine
            Route.
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

          <label className="check-row" style={{ marginTop: 8 }}>
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
      </div>
    </div>
  );
}
