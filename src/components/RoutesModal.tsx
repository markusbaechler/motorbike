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
  // Switch to the club tours dialog (absent on the old hosting).
  onClubTours?: () => void;
  onClose: () => void;
}

// A question waiting for the rider's answer before work is thrown away, or a
// small edit that needs its own dialog.
type Pending =
  | { kind: "load"; name: string; waypoints: Waypoint[]; saveAs?: string; closeAfter: boolean }
  | { kind: "delete"; route: SavedRoute }
  | { kind: "rename"; route: SavedRoute }
  | null;

function meta(r: SavedRoute): string {
  const days = computeDays(r.waypoints).length || (r.waypoints.length >= 1 ? 1 : 0);
  const date = new Date(r.updatedAt).toLocaleDateString("de-CH");
  return `${days} Tag${days === 1 ? "" : "e"} · ${r.waypoints.length} Punkte · ${date}`;
}

export default function RoutesModal({ currentWaypoints, onLoad, onClubTours, onClose }: Props) {
  const [routes, setRoutes] = useState<SavedRoute[]>(() => listRoutes());
  const [name, setName] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const refresh = () => setRoutes(listRoutes());
  const canSave = currentWaypoints.length >= 2;
  // Loading replaces the tour on the map; ask first when there is one.
  const hasWork = currentWaypoints.length >= 2;

  const doSave = () => {
    const n = name.trim() || `Tour ${new Date().toLocaleDateString("de-CH")}`;
    saveRoute(n, currentWaypoints);
    setName("");
    setInfo(`„${n}“ gespeichert.`);
    refresh();
  };

  const startRename = (r: SavedRoute) => {
    setRenameValue(r.name);
    setPending({ kind: "rename", route: r });
  };

  const applyRename = () => {
    if (pending?.kind !== "rename") return;
    const n = renameValue.trim();
    if (n) {
      renameRoute(pending.route.id, n.slice(0, 80));
      refresh();
    }
    setPending(null);
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
      <Modal title="Meine Touren" onClose={onClose}>
        <div className="modal-body">
          {/* Save current */}
          <section className="modal-section">
            <h3>Aktuelle Tour speichern</h3>
            <div className="qp-row">
              <input
                className="day-name-input"
                type="text"
                placeholder="Name (z. B. Alpentour Juli)"
                aria-label="Name der Tour"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canSave}
                maxLength={80}
              />
              <button className="export-btn primary" disabled={!canSave} onClick={doSave}>
                <Icon name="save" size={17} /> Speichern
              </button>
            </div>
            {!canSave && (
              <p className="modal-note">Erst eine Tour mit mindestens zwei Punkten anlegen.</p>
            )}
            {info && <p className="modal-note">{info}</p>}
          </section>

          {/* Saved list */}
          <section className="modal-section">
            <h3>Gespeichert ({routes.length})</h3>
            {routes.length === 0 ? (
              <p className="modal-note">Noch keine Touren gespeichert.</p>
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
                      <button className="wp-btn" onClick={() => startRename(r)} aria-label="Umbenennen" title="Umbenennen">
                        <Icon name="pencil" size={15} />
                      </button>
                      <button
                        className="wp-btn"
                        onClick={() => exportRouteFile(r.name, r.waypoints)}
                        aria-label="Als Datei exportieren"
                        title="Als Datei exportieren"
                      >
                        <Icon name="download" size={15} />
                      </button>
                      <button
                        className="wp-btn remove"
                        onClick={() => setPending({ kind: "delete", route: r })}
                        aria-label="Löschen"
                        title="Löschen"
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
                onClick={() => exportRouteFile(name.trim() || "tour", currentWaypoints)}
              >
                Aktuelle Tour exportieren
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

          {onClubTours && (
            <section className="modal-section">
              <h3>Club-Touren</h3>
              <button className="export-btn" onClick={onClubTours}>
                <Icon name="scenery" size={16} /> Vorschläge des Clubs ansehen
              </button>
              <p className="modal-note">Touren von der Website, bereit zum Laden und Anpassen.</p>
            </section>
          )}
        </div>
      </Modal>

      {pending?.kind === "load" && (
        <ConfirmDialog
          title="Aktuelle Tour ersetzen?"
          confirmLabel="Ersetzen"
          onConfirm={() => applyLoad(pending)}
          onCancel={() => setPending(null)}
        >
          Die Tour auf der Karte ({currentWaypoints.length} Punkte) wird durch „{pending.name}“
          ersetzt. Nicht gespeicherte Änderungen gehen verloren.
        </ConfirmDialog>
      )}

      {pending?.kind === "delete" && (
        <ConfirmDialog
          title="Tour löschen?"
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

      {pending?.kind === "rename" && (
        <Modal
          title="Tour umbenennen"
          onClose={() => setPending(null)}
          className="modal-confirm"
          backdropClassName="confirm-backdrop"
          initialFocus={renameRef}
        >
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              applyRename();
            }}
          >
            <label className="default-label" htmlFor="rename-input">
              Name
            </label>
            <input
              id="rename-input"
              ref={renameRef}
              className="day-name-input"
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={80}
              style={{ width: "100%", marginTop: 6 }}
            />
            <div className="confirm-actions">
              <button type="button" className="export-btn" onClick={() => setPending(null)}>
                Abbrechen
              </button>
              <button type="submit" className="export-btn primary" disabled={!renameValue.trim()}>
                Speichern
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
