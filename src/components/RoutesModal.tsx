import { useRef, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import ConfirmDialog from "./ConfirmDialog";
import {
  deleteRoute,
  exportRouteFile,
  listRoutes,
  parseRouteFile,
  renameRoute,
  saveRoute,
  type SavedRoute,
} from "../lib/storage";
import { computeDays } from "../lib/days";
import type { Waypoint } from "../types";

interface Props {
  currentWaypoints: Waypoint[];
  onLoad: (waypoints: Waypoint[]) => void;
  onClose: () => void;
}

// A question waiting for the rider's answer before work is thrown away.
type Pending =
  | { kind: "load"; name: string; waypoints: Waypoint[]; saveAs?: string; closeAfter: boolean }
  | { kind: "delete"; route: SavedRoute }
  | null;

function meta(r: SavedRoute): string {
  const days = computeDays(r.waypoints).length || (r.waypoints.length >= 1 ? 1 : 0);
  const date = new Date(r.updatedAt).toLocaleDateString("de-CH");
  return `${days} Tag${days === 1 ? "" : "e"} · ${r.waypoints.length} Punkte · ${date}`;
}

export default function RoutesModal({ currentWaypoints, onLoad, onClose }: Props) {
  const [routes, setRoutes] = useState<SavedRoute[]>(() => listRoutes());
  const [name, setName] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setRoutes(listRoutes());
  const canSave = currentWaypoints.length >= 2;
  // Loading replaces the route on the map; ask first when there is one.
  const hasWork = currentWaypoints.length >= 2;

  const doSave = () => {
    const n = name.trim() || `Route ${new Date().toLocaleDateString("de-CH")}`;
    saveRoute(n, currentWaypoints);
    setName("");
    setInfo(`„${n}“ gespeichert.`);
    refresh();
  };

  const doRename = (r: SavedRoute) => {
    const n = window.prompt("Neuer Name:", r.name);
    if (n && n.trim()) {
      renameRoute(r.id, n.trim());
      refresh();
    }
  };

  const applyLoad = (p: Extract<Pending, { kind: "load" }>) => {
    onLoad(p.waypoints);
    if (p.saveAs) {
      saveRoute(p.saveAs, p.waypoints);
      setInfo(`„${p.saveAs}“ importiert und geladen.`);
      refresh();
    }
    setPending(null);
    if (p.closeAfter) onClose();
  };

  const requestLoad = (p: Extract<Pending, { kind: "load" }>) => {
    if (hasWork) setPending(p);
    else applyLoad(p);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { name: n, waypoints } = parseRouteFile(await file.text());
      requestLoad({ kind: "load", name: n, waypoints, saveAs: n, closeAfter: false });
    } catch (err) {
      setInfo((err as Error).message);
    }
    e.target.value = "";
  };

  return (
    <>
      <Modal title="Meine Routen" onClose={onClose}>
        <div className="modal-body">
          {/* Save current */}
          <section className="modal-section">
            <h3>Aktuelle Route speichern</h3>
            <div className="qp-row">
              <input
                className="day-name-input"
                type="text"
                placeholder="Name (z. B. Alpentour Juli)"
                aria-label="Name der Route"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canSave}
              />
              <button className="export-btn primary" disabled={!canSave} onClick={doSave}>
                <Icon name="save" size={17} /> Speichern
              </button>
            </div>
            {!canSave && (
              <p className="modal-note">Erst eine Route mit mindestens zwei Punkten anlegen.</p>
            )}
            {info && <p className="modal-note">{info}</p>}
          </section>

          {/* Saved list */}
          <section className="modal-section">
            <h3>Gespeichert ({routes.length})</h3>
            {routes.length === 0 ? (
              <p className="modal-note">Noch keine Routen gespeichert.</p>
            ) : (
              <ul className="route-list">
                {routes.map((r) => (
                  <li key={r.id} className="route-item">
                    <div className="route-info">
                      <span className="route-name">{r.name}</span>
                      <span className="route-meta">{meta(r)}</span>
                    </div>
                    <div className="route-actions">
                      <button
                        className="export-btn"
                        onClick={() =>
                          requestLoad({ kind: "load", name: r.name, waypoints: r.waypoints, closeAfter: true })
                        }
                      >
                        Laden
                      </button>
                      <button className="wp-btn" onClick={() => doRename(r)} aria-label="Umbenennen">
                        <Icon name="pencil" size={15} />
                      </button>
                      <button className="wp-btn" onClick={() => exportRouteFile(r.name, r.waypoints)} aria-label="Als Datei">
                        <Icon name="download" size={15} />
                      </button>
                      <button
                        className="wp-btn remove"
                        onClick={() => setPending({ kind: "delete", route: r })}
                        aria-label="Löschen"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* File transfer */}
          <section className="modal-section">
            <h3>Datei</h3>
            <div className="export-days">
              <button
                className="export-btn"
                disabled={!canSave}
                onClick={() => exportRouteFile(name.trim() || "route", currentWaypoints)}
              >
                Aktuelle Route exportieren
              </button>
              <button className="export-btn" onClick={() => fileRef.current?.click()}>
                Datei importieren
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={onImportFile}
              />
            </div>
            <p className="modal-note">
              Export/Import als Datei dient zum Sichern oder Übertragen auf ein anderes Gerät.
            </p>
          </section>
        </div>
      </Modal>

      {pending?.kind === "load" && (
        <ConfirmDialog
          title="Aktuelle Route ersetzen?"
          confirmLabel="Ersetzen"
          onConfirm={() => applyLoad(pending)}
          onCancel={() => setPending(null)}
        >
          Die Route auf der Karte ({currentWaypoints.length} Punkte) wird durch „{pending.name}“
          ersetzt. Nicht gespeicherte Änderungen gehen verloren.
        </ConfirmDialog>
      )}

      {pending?.kind === "delete" && (
        <ConfirmDialog
          title="Route löschen?"
          confirmLabel="Löschen"
          danger
          onConfirm={() => {
            deleteRoute(pending.route.id);
            setPending(null);
            refresh();
          }}
          onCancel={() => setPending(null)}
        >
          „{pending.route.name}“ wird endgültig gelöscht.
        </ConfirmDialog>
      )}
    </>
  );
}
