import { useEffect, useState } from "react";
import Icon from "./Icon";
import { weatherIcon } from "./WeatherStrip";
import { reverseGeocode } from "../lib/geocoding";
import { bestWindow, fetchOutlook, windowLabel, type OutlookDay } from "../lib/outlook";
import { codeLabel } from "../lib/weather";

const DAY_LABEL = ["Heute", "Morgen", "Übermorgen"];

/** 3-day outlook for the map centre, with the best dry riding window per day. */
export default function OutlookBox({ lat, lng }: { lat: number; lng: number }) {
  const [days, setDays] = useState<OutlookDay[] | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(false);
    fetchOutlook(lat, lng, ctrl.signal)
      .then(setDays)
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError(true);
      });
    reverseGeocode(lat, lng, ctrl.signal)
      // "Val Frisal, Graubünden, Schweiz" → "Val Frisal, Graubünden"
      .then((p) => setPlace(p ? p.split(", ").slice(0, 2).join(", ") : null))
      .catch(() => {
        /* the name is a nicety */
      });
    return () => ctrl.abort();
  }, [lat, lng]);

  return (
    <div className="outlook-box" role="region" aria-label="Prognose 3 Tage">
      <p className="outlook-title">Prognose{place ? ` für ${place}` : " für die Kartenmitte"}</p>
      {error ? (
        <p className="outlook-msg">Prognose gerade nicht verfügbar.</p>
      ) : !days ? (
        <p className="outlook-msg">Wird geladen …</p>
      ) : (
        <div className="outlook-days">
          {days.slice(0, 3).map((d, i) => {
            const from = i === 0 ? new Date().getHours() : undefined;
            const win = bestWindow(d.hours, from);
            const label = windowLabel(d.hours, from);
            const tone = label === "Fahrtag vorbei" ? "over" : win ? "ok" : "no";
            return (
              <div key={d.date} className="outlook-day" title={codeLabel(d.code)}>
                <span className="outlook-label">{DAY_LABEL[i] ?? d.date}</span>
                <Icon name={weatherIcon(d.code)} size={22} />
                <span className="outlook-temp">
                  {d.tMax}° <span className="outlook-min">/ {d.tMin}°</span>
                </span>
                <span className="outlook-rain">
                  {d.probMax == null ? "–" : `${d.probMax} %`}
                  {d.precipSum > 0 ? ` · ${d.precipSum} mm` : ""}
                </span>
                <span className={`outlook-win ${tone}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
