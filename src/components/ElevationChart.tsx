import type { ElevationPoint } from "../lib/analysis";

interface Props {
  profile: ElevationPoint[];
  minEle: number;
  maxEle: number;
}

const W = 320;
const H = 120;
const PAD = 4;

export default function ElevationChart({ profile, minEle, maxEle }: Props) {
  if (profile.length < 2) {
    return <p className="hint">Höhendaten nicht verfügbar.</p>;
  }

  const totalKm = profile[profile.length - 1].km || 1;
  const span = Math.max(1, maxEle - minEle);

  const x = (km: number) => PAD + (km / totalKm) * (W - 2 * PAD);
  const y = (ele: number) => H - PAD - ((ele - minEle) / span) * (H - 2 * PAD);

  const line = profile.map((p) => `${x(p.km).toFixed(1)},${y(p.ele).toFixed(1)}`);
  const area = `${PAD},${H - PAD} ${line.join(" ")} ${(W - PAD).toFixed(1)},${H - PAD}`;

  return (
    <div className="elev-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Höhenprofil">
        <polygon points={area} fill="rgba(56,189,248,0.18)" />
        <polyline
          points={line.join(" ")}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="elev-axis">
        <span>{minEle} m</span>
        <span>{maxEle} m</span>
      </div>
    </div>
  );
}
