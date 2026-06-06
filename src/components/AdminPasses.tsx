import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import PlaceInput from "./PlaceInput";
import { DEFAULT_PASSES, fetchPassesFresh, type NamedPlace } from "../lib/passes";
import { commitPasses, ADMIN_TARGET } from "../lib/github";
import type { GeoResult } from "../lib/geocoding";

const TOKEN_KEY = "motorbike.admin.ghtoken";

let uid = 1;
interface Row {
  id: number;
  name: string;
  lat: string;
  lng: string;
}
const toRow = (p: NamedPlace): Row => ({
  id: uid++,
  name: p.name,
  lat: String(p.lat),
  lng: String(p.lng),
});

function parseRows(rows: Row[]): NamedPlace[] {
  return rows.map((r) => {
    const name = r.name.trim();
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lng);
    if (!name) throw new Error("Ein Eintrag hat keinen Namen.");
    if (!Number.isFinite(lat) || lat < -90 || lat > 90)
      throw new Error(`Ungültige Breite bei „${name}".`);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180)
      throw new Error(`Ungültige Länge bei „${name}".`);
    return {
      name,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
    };
  });
}

export default function AdminPasses({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) ?? "");
  const [showToken, setShowToken] = useState(false);
  const [filter, setFilter] = useState("");
  const [addValue, setAddValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setRows((await fetchPassesFresh()).map(toRow));
      } catch (e) {
        setRows(DEFAULT_PASSES.map(toRow));
        setStatus("⚠ Live-Liste nicht ladbar – zeige eingebaute Standardliste. " + (e as Error).message);
      }
    })();
  }, []);

  const saveToken = (t: string) => {
    setToken(t);
    localStorage.setItem(TOKEN_KEY, t.trim());
  };

  const patch = (id: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const remove = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addEmpty = () => setRows((rs) => [{ id: uid++, name: "", lat: "", lng: "" }, ...rs]);
  const addPlace = (r: GeoResult) => {
    setRows((rs) => [
      { id: uid++, name: r.name.split(",")[0].trim(), lat: String(r.lat), lng: String(r.lng) },
      ...rs,
    ]);
    setAddValue("");
    setStatus("Eintrag hinzugefügt (oben). Noch nicht gespeichert.");
  };

  const visible = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [rows, filter],
  );

  const buildJson = () => JSON.stringify(parseRows(rows), null, 2) + "\n";

  const onExport = () => {
    try {
      const blob = new Blob([buildJson()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "passes.json";
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Exportiert (${rows.length} Einträge).`);
    } catch (e) {
      setStatus("⚠ " + (e as Error).message);
    }
  };

  const onImport = (file: File) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(String(fr.result)) as NamedPlace[];
        if (!Array.isArray(data)) throw new Error("Datei ist keine Liste.");
        setRows(
          data.map((p) => toRow({ name: String(p.name ?? ""), lat: Number(p.lat), lng: Number(p.lng) })),
        );
        setStatus(`Importiert (${data.length} Einträge). Noch nicht gespeichert.`);
      } catch (e) {
        setStatus("⚠ Import fehlgeschlagen: " + (e as Error).message);
      }
    };
    fr.readAsText(file);
  };

  const onSave = async () => {
    if (!token.trim()) {
      setShowToken(true);
      setStatus("⚠ Bitte zuerst einen GitHub-Token eingeben (Knopf „Token“).");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const json = buildJson(); // validates first
      await commitPasses(json, token.trim());
      setStatus("Gespeichert ✓ – die Änderungen sind nach dem automatischen Deploy (~1–2 min) live.");
    } catch (e) {
      setStatus("⚠ " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-screen">
      <div className="admin-head">
        <h2>
          <Icon name="folder" size={20} /> Pässe verwalten
        </h2>
        <button className="modal-close" onClick={onClose} aria-label="Schließen">
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="admin-body">
        <p className="modal-note" style={{ marginTop: 0 }}>
          Diese Liste steuert, welche bekannten Strassen/Pässe der Tour-Genius bevorzugt
          anfährt. Gespeichert wird nach <code>{ADMIN_TARGET.PATH}</code> im Repo.
        </p>

        <div className="admin-toolbar">
          <button className="export-btn primary" disabled={busy} onClick={onSave}>
            <Icon name="save" size={16} /> {busy ? "Speichert …" : "Speichern (GitHub)"}
          </button>
          <button className="export-btn" onClick={onExport}>
            <Icon name="download" size={16} /> Export
          </button>
          <label className="export-btn" style={{ cursor: "pointer" }}>
            <Icon name="up" size={16} /> Import
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
            />
          </label>
          <button className="export-btn" onClick={() => setShowToken((v) => !v)}>
            <Icon name="pencil" size={16} /> Token{token ? " ✓" : ""}
          </button>
        </div>

        {showToken && (
          <div className="admin-token card">
            <label className="tg-label" style={{ marginTop: 0 }}>GitHub Personal Access Token</label>
            <input
              className="day-name-input"
              type="password"
              placeholder="ghp_… (nur lokal gespeichert)"
              value={token}
              onChange={(e) => saveToken(e.target.value)}
            />
            <p className="modal-note">
              Fine-grained Token für <strong>{ADMIN_TARGET.OWNER}/{ADMIN_TARGET.REPO}</strong> mit
              Berechtigung <strong>Contents: Read &amp; write</strong>. Wird nur in diesem Browser
              (localStorage) gespeichert, nie hochgeladen außer für den Speichern-Aufruf an GitHub.
            </p>
          </div>
        )}

        {status && <p className="admin-status">{status}</p>}

        <div className="admin-add card">
          <label className="tg-label" style={{ marginTop: 0 }}>Strasse/Pass suchen &amp; hinzufügen</label>
          <PlaceInput
            value={addValue}
            placeholder="z. B. Gotthardpass"
            onChange={setAddValue}
            onPick={addPlace}
          />
          <button className="add-stop-btn" onClick={addEmpty}>
            <Icon name="plus" size={15} /> Leeren Eintrag manuell hinzufügen
          </button>
        </div>

        <div className="admin-listhead">
          <input
            className="day-name-input"
            type="text"
            placeholder={`Filtern … (${rows.length} Einträge)`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <ul className="admin-list">
          {visible.map((r) => (
            <li className="admin-item" key={r.id}>
              <input
                className="admin-name"
                type="text"
                placeholder="Name"
                value={r.name}
                onChange={(e) => patch(r.id, { name: e.target.value })}
              />
              <input
                className="admin-coord"
                type="number"
                step="0.0001"
                placeholder="Breite"
                value={r.lat}
                onChange={(e) => patch(r.id, { lat: e.target.value })}
              />
              <input
                className="admin-coord"
                type="number"
                step="0.0001"
                placeholder="Länge"
                value={r.lng}
                onChange={(e) => patch(r.id, { lng: e.target.value })}
              />
              <button className="wp-btn remove" onClick={() => remove(r.id)} aria-label="Entfernen">
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="modal-note">Keine Einträge.</li>}
        </ul>
      </div>
    </div>
  );
}
