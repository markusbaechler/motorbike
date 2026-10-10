import { useEffect, useState } from "react";
import Icon from "./Icon";
import { APP_NAME, CLUB_NAME, SITE_LINKS } from "../config";
import { buildMigrationUrl, collectMigration, hasAnythingToMigrate } from "../lib/migrate";

// "Später" on the moved card hides it for this browser session only; the
// footer keeps a link to the new address so it is never lost.
const LATER_KEY = "motorbike.moved.later";
const laterChosen = (): boolean => {
  try {
    return sessionStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
};

interface Props {
  savedCount: number;
  canInstall: boolean;
  iosInstall: boolean;
  // Auto-saved tour from the last session (only offered while the map is empty).
  draft: { points: number; days: number } | null;
  // True when a tour is being planned right now (Home opened from the map).
  hasRoute: boolean;
  // New address of the planner (old hosting only): shows the "moved" card.
  movedTo?: string;
  onInstall: () => void;
  onPlan: () => void;
  onGenius: () => void;
  onPasses: () => void;
  onRoutes: () => void;
  // Club tours from the website; absent on the old hosting (no same-origin feed).
  onClubTours?: () => void;
  onResume: () => void;
  onBack: () => void;
}

export default function Home({
  savedCount,
  canInstall,
  iosInstall,
  draft,
  hasRoute,
  movedTo,
  onInstall,
  onPlan,
  onGenius,
  onPasses,
  onRoutes,
  onClubTours,
  onResume,
  onBack,
}: Props) {
  const [showIosHint, setShowIosHint] = useState(false);
  const [movedLater, setMovedLater] = useState(laterChosen);
  const chooseLater = () => {
    try {
      sessionStorage.setItem(LATER_KEY, "1");
    } catch {
      /* private mode: just hide it for this render */
    }
    setMovedLater(true);
  };
  // Computed on each render: cheap, and always reflects the current storage.
  const migrationData = movedTo ? collectMigration() : null;
  const migrationUrl = movedTo && migrationData ? buildMigrationUrl(movedTo, migrationData) : "";
  const movedHost = movedTo ? movedTo.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";

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
          Kurvige Touren planen – Tag für Tag, mit GPX fürs Navi.
        </p>

        {movedTo && !movedLater && (
          <section className="moved-card" aria-labelledby="moved-title">
            <strong id="moved-title">Der Routenplaner ist umgezogen</strong>
            <p>
              Neu unter <a href={movedTo} target="_top">{movedHost}</a>. Diese Adresse hier
              bleibt nur noch übergangsweise erreichbar.
              {migrationData && hasAnythingToMigrate(migrationData)
                ? " Gespeicherte Touren liegen nur in diesem Browser – der Link nimmt sie mit."
                : ""}
            </p>
            <div className="moved-actions">
              <a className="home-cta primary moved-go" href={migrationUrl} target="_top">
                <Icon name="arrowRight" size={20} /> Jetzt wechseln
                {migrationData && hasAnythingToMigrate(migrationData) && (
                  <span className="home-cta-sub">nimmt deine Touren mit</span>
                )}
              </a>
              <button className="home-cta moved-later" onClick={chooseLater}>
                Später
              </button>
            </div>
          </section>
        )}

        {/* One main action; the other ways to start as quiet tiles; the
            rest as small links. Fewer, calmer choices than a stack of
            equal buttons. */}
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
        </div>

        <p className="home-or">oder starten mit</p>
        <div className={`home-tiles ${onClubTours ? "" : "two"}`}>
          <button className="home-tile" onClick={onGenius}>
            <Icon name="compass" size={22} />
            <span>Tour-Genius</span>
          </button>
          <button className="home-tile" onClick={onPasses}>
            <Icon name="mountain" size={22} />
            <span>Pässe</span>
          </button>
          {onClubTours && (
            <button className="home-tile" onClick={onClubTours}>
              <Icon name="users" size={22} />
              <span>Club-Touren</span>
            </button>
          )}
        </div>

        <div className="home-links">
          <button className="home-link" onClick={onRoutes}>
            <Icon name="folder" size={16} /> Meine Touren{savedCount > 0 ? ` (${savedCount})` : ""}
          </button>
          {(canInstall || iosInstall) && (
            <button
              className="home-link"
              onClick={canInstall ? onInstall : () => setShowIosHint((v) => !v)}
              aria-expanded={iosInstall ? showIosHint : undefined}
            >
              <Icon name="download" size={16} /> Als App installieren
            </button>
          )}
        </div>
        {showIosHint && (
          <p className="ios-hint">
            In Safari: unten auf <strong>Teilen</strong> (Quadrat mit Pfeil) tippen →
            <strong> „Zum Home-Bildschirm“</strong>. Dann startet der Routenplaner wie eine App.
          </p>
        )}

        {/* target=_top: inside the website's iframe these must replace the
            whole page, not load the site within the planner frame. */}
        <nav className="home-footer" aria-label="Website">
          <a href={SITE_LINKS.home} target="_top">pudgilly.ch</a>
          <span aria-hidden="true">·</span>
          <a href={SITE_LINKS.impressum} target="_top">Impressum</a>
          <span aria-hidden="true">·</span>
          <a href={SITE_LINKS.datenschutz} target="_top">Datenschutz</a>
          {movedTo && (
            <>
              <span aria-hidden="true">·</span>
              <a href={migrationUrl} target="_top">Neue Adresse</a>
            </>
          )}
        </nav>
      </div>
    </div>
  );
}
