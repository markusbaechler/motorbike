import Icon from "./Icon";

interface Props {
  total: number;
  needCount: number;
  niceCount: number;
  busy: boolean;
  onCreate: () => void;
  onCancel: () => void;
}

/**
 * Floating bar shown during pass selection. Deliberately does NOT cover the
 * map so the rider can tap pass dots: 1× = Need-to (red), 2× = Nice-to
 * (yellow), 3× = remove.
 */
export default function PassSelectPanel({
  total,
  needCount,
  niceCount,
  busy,
  onCreate,
  onCancel,
}: Props) {
  const picked = needCount + niceCount;
  return (
    <div className="pass-select">
      <div className="pass-select-info">
        <strong>{total} Pässe im Korridor</strong>
        <span className="pass-select-hint">
          Tippe Pässe an: 1× <b className="need">Need-to</b>, 2× <b className="nice">Nice-to</b>
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
        >
          {busy ? "…" : <><Icon name="flag" size={16} /> Route erstellen ({picked})</>}
        </button>
      </div>
    </div>
  );
}
