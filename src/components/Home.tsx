import { useEffect, useState } from "react";
import Icon from "./Icon";

interface Props {
  savedCount: number;
  canInstall: boolean;
  iosInstall: boolean;
  // Auto-saved route from the last session (only offered while the map is empty).
  draft: { points: number; days: number } | null;
  // True when a route is being planned right now (Home opened from the map).
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

  // Escape returns to the map when Home was opened over a route in progress.
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
        <img className="home-logo" src="./icon.svg" alt="" />
        <h1 className="home-title">
          <span className="brand">Motorbike</span>
        </h1>
        <p className="home-tagline">
          Plane kurvige Motorradtouren – Etappe für Etappe, ganz nach deinem Fahrstil.
        </p>

        <div className="home-actions">
          {hasRoute && (
            <button className="home-cta primary" onClick={onBack}>
              <Icon name="flag" size={20} /> Zurück zur Route
            </button>
          )}
          {!hasRoute && draft && (
            <button className="home-cta primary resume" onClick={onResume}>
              <Icon name="flag" size={20} /> Letzte Route fortsetzen
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
            <span className="home-cta-sub">Route über ausgewählte Pässe</span>
          </button>
          <button className="home-cta" onClick={onRoutes}>
            <Icon name="folder" size={19} /> Meine Routen
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
              <strong> „Zum Home-Bildschirm“</strong>. Dann startet Motorbike wie eine App.
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
            <strong>Mehrtage</strong>
            <span>Etappen, Übernachtungen &amp; Hotels</span>
          </div>
          <div className="home-feat">
            <span className="home-feat-icon gpx"><Icon name="download" size={18} /></span>
            <strong>GPX</strong>
            <span>Export fürs Navi (Beeline, Garmin …)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
