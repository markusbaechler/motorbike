import { useRef, useState } from "react";
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

function meta(r: SavedRoute): string {
  const days = computeDays(r.waypoints).length || (r.waypoints.length >= 1 ? 1 : 0);
  const date = new Date(r.updatedAt).toLocaleDateString("de-CH");
  return `${days} Tag${days === 1 ? "" : "e"} · ${r.waypoints.length} Punkte · ${date}`;
}

export default function RoutesModal({ currentWaypoints, onLoad, onClose }: Props) {
  const [routes, setRoutes] = useState<SavedRoute[]>(() => listRoutes());
  const [name, setName] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setRoutes(listRoutes());
  const canSave = currentWaypoints.length >= 2;

  const doSave = () => {
    const n = name.trim() || `Route ${new Date().toLocaleDateString("de-CH")}`;
    saveRoute(n, currentWaypoints);
    setName("");
    setInfo(`„${n}" gespeichert.`);
    refresh();
  };

  const doRename = (r: SavedRoute) => {
    const n = window.prompt("Neuer Name:", r.name);
    if (n && n.trim()) {
      renameRoute(r.id, n.trim());
      refresh();
    }
  };

  const doDelete = (r: SavedRoute) => {
    if (window.confirm(`„${r.name}" wirklich löschen?`)) {
      deleteRoute(r.id);
      refresh();
    }
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { name: n, waypoints } = parseRouteFile(await file.text());
      onLoad(waypoints);
      saveRoute(n, waypoints);
      setInfo(`„${n}" importiert und geladen.`);
      refresh();
    } catch (err) {
      setInfo((err as Error).message);
    }
    e.target.value = "";
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Meine Routen</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        <div className="modal-body">
          {/* Save current */}
          <section className="modal-section">
            <h3>Aktuelle Route speichern</h3>
            <div className="qp-row">
              <input
                className="day-name-input"
                type="text"
                placeholder="Name (z. B. Alpentour Juli)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canSave}
              />
              <button className="export-btn primary" disabled={!canSave} onClick={doSave}>
                💾 Speichern
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
                      <button className="export-btn" onClick={() => { onLoad(r.waypoints); onClose(); }}>
                        Laden
                      </button>
                      <button className="wp-btn" onClick={() => doRename(r)} aria-label="Umbenennen">✏</button>
                      <button className="wp-btn" onClick={() => exportRouteFile(r.name, r.waypoints)} aria-label="Als Datei">⬇</button>
                      <button className="wp-btn remove" onClick={() => doDelete(r)} aria-label="Löschen">🗑</button>
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
      </div>
    </div>
  );
}
