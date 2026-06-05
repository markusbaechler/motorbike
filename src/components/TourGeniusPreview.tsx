import Icon from "./Icon";
import type { TourCandidate } from "../lib/tourgen";

interface Props {
  candidates: TourCandidate[];
  idx: number;
  onNext: () => void;
  onAccept: () => void;
  onDiscard: () => void;
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function TourGeniusPreview({
  candidates,
  idx,
  onNext,
  onAccept,
  onDiscard,
}: Props) {
  const cand = candidates[idx];
  const a = cand.analysis;

  return (
    <div className="tg-preview">
      <div className="tg-preview-head">
        <span className="tg-preview-title">
          <Icon name="compass" size={16} /> Tour-Genius
        </span>
        <span className="tg-preview-variant">
          Variante {idx + 1}/{candidates.length}
        </span>
      </div>

      <div className="tg-preview-main">
        <div className="tg-preview-score">
          <b>{a.scores.overall.toFixed(1)}</b>
          <span>/10</span>
        </div>
        <div className="tg-preview-facts">
          <span><b>{cand.distanceKm.toFixed(0)}</b> km</span>
          <span><b>{fmtDur(cand.durationMin)}</b></span>
          <span><b>↑ {a.ascentM}</b> hm</span>
          <span><b>{a.passes}</b> Pässe</span>
          <span><b>{a.cornersPerKm.toFixed(1)}</b> Kurven/km</span>
          <span><b>{a.maxEle}</b> m höchster</span>
        </div>
      </div>

      <div className="tg-preview-actions">
        {candidates.length > 1 && (
          <button className="tg-pv-btn" onClick={onNext}>
            <Icon name="chevron" size={15} /> Andere
          </button>
        )}
        <button className="tg-pv-btn ghost" onClick={onDiscard}>
          <Icon name="x" size={15} /> Verwerfen
        </button>
        <button className="tg-pv-btn primary" onClick={onAccept}>
          <Icon name="loop" size={15} /> Übernehmen
        </button>
      </div>
    </div>
  );
}
