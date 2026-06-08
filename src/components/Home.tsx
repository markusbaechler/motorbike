import { useState } from "react";
import Icon from "./Icon";

interface Props {
  savedCount: number;
  canInstall: boolean;
  iosInstall: boolean;
  onInstall: () => void;
  onPlan: () => void;
  onGenius: () => void;
  onPasses: () => void;
  onRoutes: () => void;
}

export default function Home({
  savedCount,
  canInstall,
  iosInstall,
  onInstall,
  onPlan,
  onGenius,
  onPasses,
  onRoutes,
}: Props) {
  const [showIosHint, setShowIosHint] = useState(false);
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
          <button className="home-cta primary" onClick={onPlan}>
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
            <button className="home-cta install" onClick={() => setShowIosHint((v) => !v)}>
              <Icon name="download" size={19} /> Als App installieren
            </button>
          )}

          {showIosHint && (
            <p className="ios-hint">
              In Safari: unten auf <strong>Teilen</strong> (Quadrat mit Pfeil) tippen →
              <strong> „Zum Home-Bildschirm"</strong>. Dann startet Motorbike wie eine App.
            </p>
          )}
        </div>

        <div className="home-features">
          <div className="home-feat">
            <span className="home-feat-icon kurvig"><Icon name="zap" size={18} /></span>
            <strong>Kurvig</strong>
            <span>Fun-Routing über kleine Straßen &amp; Pässe</span>
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
