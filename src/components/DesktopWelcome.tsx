import { useEffect, useState } from "react";
import Icon from "./Icon";
import { fetchClubTours, type ClubTour } from "../lib/clubtours";
import { SITE_LINKS } from "../config";
import type { Waypoint } from "../types";

interface Props {
  // Auto-saved tour from the last session, if any.
  draft: { points: number; days: number } | null;
  onResume: () => void;
  onPlan: () => void;
  // Club tours (absent on the old hosting): a few as suggestions + "all".
  clubTours?: { onLoad: (waypoints: Waypoint[]) => void; onShowAll: () => void };
}

const SUGGESTIONS = 3;

/**
 * Desktop replacement for the start screen: shown in the sidebar while no
 * tour is on the map. One main action (continue the last tour, or plan a new
 * one), a few club tours to start from, and the website links.
 */
export default function DesktopWelcome({ draft, onResume, onPlan, clubTours }: Props) {
  const [tours, setTours] = useState<ClubTour[] | null>(null);
  useEffect(() => {
    if (!clubTours) return;
    let alive = true;
    fetchClubTours()
      .then((list) => alive && setTours(list))
      .catch(() => alive && setTours([])); // offline: just no suggestions
    return () => {
      alive = false;
    };
  }, [!!clubTours]);

  return (
    <div className="welcome">
      <p className="welcome-lead">
        Ort suchen oder auf die Karte klicken – oder hier starten:
      </p>
      <div className="welcome-actions">
        {draft && (
          <button className="quickplan-btn" onClick={onResume}>
            <Icon name="flag" size={16} /> Letzte Tour fortsetzen
            <span className="welcome-sub">
              {draft.points} Punkte{draft.days > 1 ? ` · ${draft.days} Tage` : ""}
            </span>
          </button>
        )}
        <button className={`quickplan-btn ${draft ? "secondary" : ""}`} onClick={onPlan}>
          <Icon name="zap" size={16} /> Neue Tour planen
        </button>
      </div>

      {clubTours && tours && tours.length > 0 && (
        <section className="welcome-club" aria-labelledby="welcome-club-title">
          <h3 id="welcome-club-title">Vorschläge der Pudgilly Riders</h3>
          <ul>
            {tours.slice(0, SUGGESTIONS).map((t) => (
              <li key={t.slug}>
                <button onClick={() => clubTours.onLoad(t.waypoints)}>
                  <span className="welcome-club-name">{t.title}</span>
                  <span className="welcome-club-meta">
                    {[t.region, t.distanceKm ? `${Math.round(t.distanceKm)} km` : null, t.daysLabel ?? `${t.days} Tag${t.days === 1 ? "" : "e"}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {tours.length > SUGGESTIONS && (
            <button className="welcome-more" onClick={clubTours.onShowAll}>
              Alle {tours.length} Club-Touren
            </button>
          )}
        </section>
      )}

      {/* target=_top: inside the website's iframe these replace the whole page. */}
      <nav className="welcome-footer" aria-label="Website">
        <a href={SITE_LINKS.home} target="_top">pudgilly.ch</a>
        <span aria-hidden="true">·</span>
        <a href={SITE_LINKS.impressum} target="_top">Impressum</a>
        <span aria-hidden="true">·</span>
        <a href={SITE_LINKS.datenschutz} target="_top">Datenschutz</a>
      </nav>
    </div>
  );
}
