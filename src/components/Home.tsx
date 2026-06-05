import Icon from "./Icon";

interface Props {
  savedCount: number;
  onPlan: () => void;
  onRoutes: () => void;
  onMap: () => void;
}

export default function Home({ savedCount, onPlan, onRoutes, onMap }: Props) {
  return (
    <div className="home">
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
          <button className="home-cta" onClick={onRoutes}>
            <Icon name="folder" size={19} /> Meine Routen
            {savedCount > 0 ? ` (${savedCount})` : ""}
          </button>
          <button className="home-link" onClick={onMap}>
            Direkt zur Karte →
          </button>
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
