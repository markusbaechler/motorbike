import Icon, { type IconName } from "./Icon";
import { fmtHhMm, type DayPlan } from "../lib/schedule";
import type { DayWxState } from "../lib/useRouteWeather";
import { codeLabel, isFair, summarize } from "../lib/weather";

export function weatherIcon(code: number): IconName {
  if (code === 0) return "sun";
  if (code <= 2) return "cloudSun";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "rain"; // 51–67 drizzle/rain, 80–82 showers
}

export const pct = (p: number | null) => (p == null ? "–" : `${p} %`);

/** Day summary + horizontal timeline of the weather at each station. */
export default function WeatherStrip({ plan, state }: { plan: DayPlan; state: DayWxState | undefined }) {
  if (!state || plan.stations.length === 0) return null;
  if (state.status === "none") return <p className="day-weather muted">Wetter: Noch keine Prognose.</p>;
  if (state.status === "loading") return <p className="day-weather muted">Wetter wird geladen …</p>;
  if (state.status === "error") return <p className="day-weather muted">Wetter gerade nicht verfügbar.</p>;

  const sum = summarize(state.values);
  return (
    <div className="wx-day">
      {sum && (
        <p className={`wx-summary ${isFair(sum.worstCode) ? "fair" : "wet"}`}>
          <Icon name={weatherIcon(sum.worstCode)} size={15} /> Unterwegs {sum.tMin}–{sum.tMax}° · max.{" "}
          {pct(sum.maxProb)} Regen{sum.maxPrecip > 0 ? ` · bis ${sum.maxPrecip.toFixed(1)} mm` : ""}
          {plan.daysAhead >= 2 && <span className="wx-trend"> · Trend, unsicher</span>}
        </p>
      )}
      <ol className="wx-strip" aria-label="Wetter entlang der Route">
        {plan.stations.map((st, k) => {
          const v = state.values[k];
          return (
            <li
              key={k}
              className={`wx-stop ${st.kind}`}
              title={v ? `${codeLabel(v.code)} · Wind ${Math.round(v.wind)} km/h` : undefined}
            >
              <span className="wx-time">{fmtHhMm(st.arriveMin)}</span>
              {v ? (
                <>
                  <Icon name={weatherIcon(v.code)} size={16} />
                  <span className="wx-temp">{Math.round(v.temp)}°</span>
                  <span className="wx-prob">{pct(v.precipProb)}</span>
                  {v.precip > 0 && <span className="wx-mm">{v.precip.toFixed(1)} mm</span>}
                </>
              ) : (
                <span className="wx-temp">–</span>
              )}
              {st.kind === "pass" && <span className="wx-name">{st.name}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
