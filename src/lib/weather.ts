// Weather forecast via Open-Meteo – free, key-less, CORS-enabled.
// https://open-meteo.com/

export interface WeatherDay {
  code: number;
  tMax: number;
  tMin: number;
  precipProb: number;
  windMax: number;
  label: string;
}

// WMO weather code → short German label.
export function codeLabel(code: number): string {
  if (code === 0) return "Klar";
  if (code <= 2) return "Heiter";
  if (code === 3) return "Bewölkt";
  if (code === 45 || code === 48) return "Nebel";
  if (code >= 51 && code <= 57) return "Niesel";
  if (code >= 61 && code <= 67) return "Regen";
  if (code >= 71 && code <= 77) return "Schnee";
  if (code >= 80 && code <= 82) return "Schauer";
  if (code >= 85 && code <= 86) return "Schneeschauer";
  if (code >= 95) return "Gewitter";
  return "—";
}

// true = good biking weather (for colour cues).
export function isFair(code: number): boolean {
  return code <= 3;
}

export async function fetchWeather(
  lat: number,
  lng: number,
  date: string,
  signal?: AbortSignal,
): Promise<WeatherDay | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}` +
    `&longitude=${lng.toFixed(4)}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
    `&timezone=auto&start_date=${date}&end_date=${date}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Wetter HTTP ${res.status}`);
  const data = (await res.json()) as {
    daily?: {
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: (number | null)[];
      wind_speed_10m_max?: number[];
    };
  };
  const d = data.daily;
  if (!d || !d.weather_code || d.weather_code.length === 0) return null;
  const code = d.weather_code[0];
  if (code == null || d.temperature_2m_max?.[0] == null) return null;
  return {
    code,
    tMax: Math.round(d.temperature_2m_max[0]),
    tMin: Math.round(d.temperature_2m_min?.[0] ?? 0),
    precipProb: Math.round(d.precipitation_probability_max?.[0] ?? 0),
    windMax: Math.round(d.wind_speed_10m_max?.[0] ?? 0),
    label: codeLabel(code),
  };
}
