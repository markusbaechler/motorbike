import data from './touren.json';
import { upcomingEvents, type ClubEvent } from './events';

export type TourLevel = 'leicht' | 'mittel' | 'anspruchsvoll';

// Ein Eintrag aus touren.json (gepflegt im CMS unter «Club-Touren»).
export interface RawTour {
  slug: string;
  title: string;
  region?: string;
  level?: TourLevel | '';
  description?: string;
  highlights?: string[];
  /** Link aus dem Routenplaner («Teilen → Link kopieren»), enthält die ganze Tour */
  planerLink: string;
  image?: string;
  /** Freier Text statt «1 Tag» / «2 Tage», z. B. «Feierabendrunde» (optional) */
  dauer?: string | null;
  /** Fahrzeit in Stunden, z. B. "2.5"; ersetzt den Wert aus dem Planer-Link (optional) */
  fahrzeit?: string | number | null;
}

export interface ClubTour {
  slug: string;
  title: string;
  region?: string;
  level?: TourLevel;
  description?: string;
  highlights: string[];
  image?: string;
  /** Nutzlast des Planer-Links (der Teil nach «#r=») */
  code: string;
  /** Link, der die Tour im Planer öffnet: /planer/#r=… */
  plannerUrl: string;
  points: number;
  days: number;
  /** Anzeige zur Dauer: Feld «Dauer» aus dem CMS, sonst "1 Tag" / "2 Tage" */
  daysLabel: string;
  /** Benannte Punkte der Tour in Kurzform, z. B. ["Wassen", "Andermatt", "Airolo"] */
  stops: string[];
  distanceKm?: number;
  durationMin?: number;
  /** z. B. "4 h 20 min" */
  durationLabel?: string;
  /** Kommende Termine, die auf diese Tour verweisen (Feld «tour» im Event) */
  events: ClubEvent[];
  next?: ClubEvent;
}

// Eine Zeile des Planer-Links: [lng, lat, Fahrstil, Tagesende(1/0), Name, Tagesname, Datum]
type Row = [number, number, string, number, string, string, string];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Liest Punkte und (falls vorhanden) Distanz/Fahrzeit aus dem Planer-Link.
function parsePlannerLink(link: string): { code: string; rows: Row[]; stats?: [number, number] } | null {
  const i = link.indexOf('#r=');
  if (i < 0) return null;
  const code = link.slice(i + 3).trim();
  if (!code) return null;
  try {
    const json = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as {
      w?: unknown;
      s?: unknown;
    };
    if (!Array.isArray(json.w)) return null;
    const rows = json.w.filter(
      (r): r is Row =>
        Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' && Number.isFinite(r[0]) && Number.isFinite(r[1])
    );
    if (rows.length < 2) return null;
    const s = json.s;
    const stats =
      Array.isArray(s) && s.length === 2 && s.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
        ? (s as [number, number])
        : undefined;
    return { code, rows, stats };
  } catch {
    return null;
  }
}

// "Wassen, Uri, Schweiz" -> "Wassen"; gleiche Nachbarn (Rundtour-Start = Ziel) bleiben stehen.
function stops(rows: Row[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const name = (r[4] ?? '').split(',')[0].trim();
    if (name) out.push(name);
  }
  if (out.length <= 8) return out;
  return [...out.slice(0, 7), '…', out[out.length - 1]];
}

// "2.5" oder "2,5" (Stunden) -> 150 Minuten; leer oder unbrauchbar -> undefined
function hoursToMinutes(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const h = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  return Number.isFinite(h) && h > 0 ? Math.round(h * 60) : undefined;
}

function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const LEVELS: TourLevel[] = ['leicht', 'mittel', 'anspruchsvoll'];

const parsedTours: ClubTour[] = (data as RawTour[]).flatMap((raw): ClubTour[] => {
  const title = raw.title?.trim();
  if (!title) return [];
  const parsed = parsePlannerLink(raw.planerLink ?? '');
  if (!parsed) {
    console.warn(`[touren] «${title}»: Planer-Link fehlt oder ist ungültig – Tour wird nicht angezeigt.`);
    return [];
  }
  const slug = slugify(raw.slug?.trim() || title);
  if (!slug) return [];
  const { code, rows, stats } = parsed;
  const events = upcomingEvents.filter((e) => e.tour && slugify(e.tour) === slug);
  const level = LEVELS.includes(raw.level as TourLevel) ? (raw.level as TourLevel) : undefined;
  // Jeder markierte Tagesabschluss (ausser am Ziel) beginnt einen weiteren Tag.
  const days = 1 + rows.slice(0, -1).filter((r) => r[3] === 1).length;
  // Fahrzeit: Feld «Fahrzeit (Stunden)» aus dem CMS geht vor, sonst der Wert aus dem Planer-Link.
  const ownMinutes = hoursToMinutes(raw.fahrzeit);
  if (ownMinutes === undefined && raw.fahrzeit !== undefined && raw.fahrzeit !== null && raw.fahrzeit !== '') {
    console.warn(`[touren] «${title}»: Fahrzeit «${raw.fahrzeit}» nicht lesbar (erwartet Stunden, z. B. 2.5) – Wert aus dem Planer wird verwendet.`);
  }
  const durationMin = ownMinutes ?? stats?.[1];
  return [
    {
      slug,
      title,
      region: raw.region?.trim() || undefined,
      level,
      description: raw.description?.trim() || undefined,
      highlights: (raw.highlights ?? []).map((h) => h.trim()).filter(Boolean),
      image: raw.image || undefined,
      code,
      plannerUrl: `/planer/#r=${code}`,
      points: rows.length,
      days,
      daysLabel: raw.dauer?.trim() || `${days} Tag${days === 1 ? '' : 'e'}`,
      stops: stops(rows),
      distanceKm: stats?.[0],
      durationMin,
      durationLabel: durationMin ? durationLabel(durationMin) : undefined,
      events,
      next: events[0],
    },
  ];
});

// Doppelte Kürzel wären im CMS ein Tippfehler: der erste Eintrag gewinnt.
const seen = new Set<string>();
export const tours: ClubTour[] = parsedTours.filter((t) => {
  if (seen.has(t.slug)) {
    console.warn(`[touren] Kürzel «${t.slug}» doppelt – «${t.title}» wird nicht angezeigt.`);
    return false;
  }
  seen.add(t.slug);
  return true;
});

export const tourBySlug = (slug?: string): ClubTour | undefined =>
  slug ? tours.find((t) => t.slug === slugify(slug)) : undefined;
