import { useEffect, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import ConfirmDialog from "./ConfirmDialog";
import { fetchClubTours, type ClubTour } from "../lib/clubtours";
import { SITE_LINKS } from "../config";
import type { Waypoint } from "../types";

interface Props {
  currentWaypoints: Waypoint[];
  onLoad: (waypoints: Waypoint[]) => void;
  onClose: () => void;
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function meta(t: ClubTour): string {
  const parts: string[] = [];
  if (t.region) parts.push(t.region);
  if (t.distanceKm) parts.push(`${Math.round(t.distanceKm)} km`);
  if (t.durationMin) parts.push(fmtDuration(t.durationMin));
  parts.push(`${t.days} Tag${t.days === 1 ? "" : "e"}`);
  parts.push(`${t.waypoints.length} Punkte`);
  return parts.join(" · ");
}

// Tours the club publishes on the website, loaded like a shared link.
export default function ClubToursModal({ currentWaypoints, onLoad, onClose }: Props) {
  const [tours, setTours] = useState<ClubTour[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<ClubTour | null>(null);
  const hasWork = currentWaypoints.length >= 2;

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchClubTours(attempt > 0)
      .then((list) => alive && setTours(list))
      .catch(() => alive && setError("Club-Touren konnten nicht geladen werden. Bist du online?"));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const load = (t: ClubTour) => {
    onLoad(t.waypoints);
    setPending(null);
    onClose();
  };

  return (
    <>
      <Modal title="Club-Touren" onClose={onClose}>
        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Vorschläge der Pudgilly Riders. «Laden» holt die Tour auf die Karte – dort kannst du
            sie anpassen, speichern und als GPX exportieren.
          </p>

          {error && (
            <div className="modal-section">
              <p className="modal-note">{error}</p>
              <button className="export-btn" onClick={() => setAttempt((n) => n + 1)}>
                Nochmals versuchen
              </button>
            </div>
          )}
          {!error && tours === null && <p className="modal-note">Lade Club-Touren …</p>}
          {!error && tours && tours.length === 0 && (
            <p className="modal-note">Noch keine Club-Touren eingetragen.</p>
          )}

          {tours && tours.length > 0 && (
            <ul className="route-list">
              {tours.map((t) => (
                <li key={t.slug} className="route-item club-item">
                  <div className="club-head">
                    <span className="route-name">{t.title}</span>
                    {t.level && <span className="club-level">{t.level}</span>}
                  </div>
                  <span className="route-meta">{meta(t)}</span>
                  {t.description && <p className="club-desc">{t.description}</p>}
                  {t.highlights.length > 0 && (
                    <div className="club-tags">
                      {t.highlights.map((h) => (
                        <span key={h}>{h}</span>
                      ))}
                    </div>
                  )}
                  {t.next && <span className="club-next">Nächste Ausfahrt: {t.next.label}</span>}
                  <div className="club-actions">
                    <button
                      className="export-btn primary"
                      onClick={() => (hasWork ? setPending(t) : load(t))}
                    >
                      <Icon name="download" size={15} /> Laden
                    </button>
                    <a
                      className="export-btn"
                      href={`${SITE_LINKS.touren}#${t.slug}`}
                      target="_top"
                    >
                      Auf der Website
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {pending && (
        <ConfirmDialog
          title="Aktuelle Tour ersetzen?"
          confirmLabel="Ersetzen"
          onConfirm={() => load(pending)}
          onCancel={() => setPending(null)}
        >
          Die Tour auf der Karte ({currentWaypoints.length} Punkte) wird durch „{pending.title}“
          ersetzt. Nicht gespeicherte Änderungen gehen verloren.
        </ConfirmDialog>
      )}
    </>
  );
}
