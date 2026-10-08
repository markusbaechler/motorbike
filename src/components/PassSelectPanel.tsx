import Icon from "./Icon";

interface Props {
  total: number;
  needCount: number;
  niceCount: number;
  busy: boolean;
  // Short status while the loop optimiser runs (e.g. "Pässe einfügen 2/6").
  progress?: string | null;
  onCreate: () => void;
  onCancel: () => void;
}

/**
 * Floating bar shown during pass selection. The rider taps a pass dot and
 * picks "Muss" (need) / "Kann" (nice) in its popup; this bar shows the tally
 * and turns the picks into a tour. "Abbrechen" also stops a running
 * optimisation.
 */
export default function PassSelectPanel({
  total,
  needCount,
  niceCount,
  busy,
  progress,
  onCreate,
  onCancel,
}: Props) {
  const picked = needCount + niceCount;
  return (
    <div className="pass-select" role="region" aria-label="Pässe auswählen">
      <div className="pass-select-info">
        <strong>{total} Pässe im Korridor</strong>
        <span className="pass-select-hint">
          Pass antippen → <b className="need">Muss</b> / <b className="nice">Kann</b> wählen
        </span>
        <span className="pass-select-counts">
          <i className="pass-dot need" /> {needCount}
          <i className="pass-dot nice" /> {niceCount}
        </span>
      </div>
      <div className="pass-select-actions">
        <button className="quickplan-btn" onClick={onCancel}>
          <Icon name="x" size={16} /> Abbrechen
        </button>
        <button
          className="export-btn primary"
          disabled={busy || picked === 0}
          onClick={onCreate}
          aria-live="polite"
        >
          {busy ? (progress ?? "Route wird optimiert …") : (
            <><Icon name="flag" size={16} /> Tour erstellen ({picked})</>
          )}
        </button>
      </div>
    </div>
  );
}
