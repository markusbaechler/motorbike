import { useEffect, useState } from "react";
import Icon from "./Icon";
import { APP_NAME, CLUB_NAME, SITE_LINKS } from "../config";

interface Props {
  savedCount: number;
  canInstall: boolean;
  iosInstall: boolean;
  // Auto-saved tour from the last session (only offered while the map is empty).
  draft: { points: number; days: number } | null;
  // True when a tour is being planned right now (Home opened from the map).
  hasRoute: boolean;
  onInstall: () => void;
  onPlan: () => void;
  onGenius: () => void;
  onPasses: () => void;
  onRoutes: () => void;
  onResume: () => void;
  onBack: () => void;
}

export default function Home({
  savedCount,
  canInstall,
  iosInstall,
  draft,
  hasRoute,
  onInstall,
  onPlan,
  onGenius,
  onPasses,
  onRoutes,
  onResume,
  onBack,
}: Props) {
  const [showIosHint, setShowIosHint] = useState(false);

  // Escape returns to the map when Home was opened over a tour in progress.
  useEffect(() => {
    if (!hasRoute) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasRoute, onBack]);

  // The most likely next step gets the primary button.
  const continueFirst = hasRoute || !!draft;

  return (
    <div className="home">
      <img
        className="home-bg"
        src="./hero.jpg"
        alt=""
        onError={(e) => ((e.currentTarget.style.display = "none"))}
      />
      <div className="home-scrim" />

      <div className="home-inner">
        <img className="home-logo" src="./logo.png" alt="" />
        <span className="home-eyebrow">{CLUB_NAME} · seit 1991</span>
        <h1 className="home-title">
          <span className="brand">{APP_NAME}</span>
        </h1>
        <p className="home-tagline">
          Kurvige Touren planen: Tag für Tag, mit Pässen, Übernachtungen und GPX fürs Navi.
        </p>

        <div className="home-actions">
          {hasRoute && (
            <button className="home-cta primary" onClick={onBack}>
              <Icon name="arrowLeft" size={20} /> Zurück zur Tour
            </button>
          )}
          {!hasRoute && draft && (
            <button className="home-cta primary resume" onClick={onResume}>
              <Icon name="flag" size={20} /> Letzte Tour fortsetzen
              <span className="home-cta-sub">
                {draft.points} Punkte{draft.days > 1 ? ` · ${draft.days} Tage` : ""}
              </span>
            </button>
          )}
          <button className={`home-cta ${continueFirst ? "" : "primary"}`} onClick={onPlan}>
            <Icon name="zap" size={20} /> Neue Tour planen
          </button>
          <button className="home-cta genius" onClick={onGenius}>
            <Icon name="compass" size={20} /> Tour-Genius
            <span className="home-cta-sub">Touren automatisch generieren</span>
          </button>
          <button className="home-cta passes" onClick={onPasses}>
            <Icon name="mountain" size={20} /> Pässeplaner
            <span className="home-cta-sub">Tour über ausgewählte Pässe</span>
          </button>
          <button className="home-cta" onClick={onRoutes}>
            <Icon name="folder" size={19} /> Meine Touren
            {savedCount > 0 ? ` (${savedCount})` : ""}
          </button>
          {canInstall && (
            <button className="home-cta install" onClick={onInstall}>
              <Icon name="download" size={19} /> Als App installieren
            </button>
          )}
          {iosInstall && (
            <button
              className="home-cta install"
              onClick={() => setShowIosHint((v) => !v)}
              aria-expanded={showIosHint}
            >
              <Icon name="download" size={19} /> Als App installieren
            </button>
          )}

          {showIosHint && (
            <p className="ios-hint">
              In Safari: unten auf <strong>Teilen</strong> (Quadrat mit Pfeil) tippen →
              <strong> „Zum Home-Bildschirm“</strong>. Dann startet der Routenplaner wie eine App.
            </p>
          )}
        </div>

        <div className="home-features">
          <div className="home-feat">
            <span className="home-feat-icon kurvig"><Icon name="zap" size={18} /></span>
            <strong>Kurvig</strong>
            <span>Fun-Routing über kleine Strassen &amp; Pässe</span>
          </div>
          <div className="home-feat">
            <span className="home-feat-icon bed"><Icon name="bed" size={18} /></span>
            <strong>Mehrtägig</strong>
            <span>Tage, Übernachtungen &amp; Hotels</span>
          </div>
          <div className="home-feat">
            <span className="home-feat-icon gpx"><Icon name="download" size={18} /></span>
            <strong>GPX</strong>
            <span>Export fürs Navi (Beeline, Garmin …)</span>
          </div>
        </div>

        {/* target=_top: inside the website's iframe these must replace the
            whole page, not load the site within the planner frame. */}
        <nav className="home-footer" aria-label="Website">
          <a href={SITE_LINKS.home} target="_top">pudgilly.ch</a>
          <span aria-hidden="true">·</span>
          <a href={SITE_LINKS.impressum} target="_top">Impressum</a>
          <span aria-hidden="true">·</span>
          <a href={SITE_LINKS.datenschutz} target="_top">Datenschutz</a>
        </nav>
      </div>
    </div>
  );
}
