import data from './events.json';

export interface ClubEvent {
  date: string;
  /** Enddatum bei mehrtägigen Terminen (optional) */
  endDate?: string;
  /** Langform, z. B. "6. November 2026" oder "15.–17. Mai 2027" */
  dateLabel: string;
  /** Kurzform mit Wochentag, z. B. "Fr 6. Nov." oder "Sa–Mo 15.–17. Mai" */
  shortLabel: string;
  /** Ausführlich, z. B. "Freitag, 6. November 2026" */
  longLabel: string;
  /** Relativ zu heute, z. B. "in 29 Tagen", "morgen", "heute", "läuft gerade" */
  relativeLabel: string;
  /** Tageszahl und Monatskürzel für die Kalender-Kachel */
  day: string;
  monthShort: string;
  title: string;
  location?: string;
  type: 'Ausfahrt' | 'Treffen' | 'Fest' | 'Kurs';
  description?: string;
  /** Kürzel einer Club-Tour (src/data/touren.json), falls der Termin auf einer Tour basiert */
  tour?: string;
}

type RawEvent = Pick<ClubEvent, 'date' | 'endDate' | 'title' | 'location' | 'type' | 'description' | 'tour'>;

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const MONTHS_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// "2027-05-15" -> Einzelteile für die Labels
function parts(iso: string) {
  const [y, m, d] = iso.split('-');
  const wd = new Date(iso + 'T00:00:00').getDay();
  return {
    day: String(Number(d)),
    day2: d,
    month: MONTHS[Number(m) - 1] ?? m,
    monthShort: MONTHS_SHORT[Number(m) - 1] ?? m,
    year: y,
    wd: WEEKDAYS[wd],
    wdLong: WEEKDAYS_LONG[wd],
  };
}

// "6. November 2026" · "15.–17. Mai 2027" · "30. September – 2. Oktober 2027"
export function formatDateRange(start: string, end?: string): string {
  const a = parts(start);
  if (!end || end <= start) return `${a.day}. ${a.month} ${a.year}`;
  const b = parts(end);
  if (a.year === b.year && a.month === b.month) return `${a.day}.–${b.day}. ${b.month} ${b.year}`;
  if (a.year === b.year) return `${a.day}. ${a.month} – ${b.day}. ${b.month} ${b.year}`;
  return `${a.day}. ${a.month} ${a.year} – ${b.day}. ${b.month} ${b.year}`;
}

// "Fr 6. Nov." · "Sa–Mo 15.–17. Mai" · "Do 30. Sept. – Sa 2. Okt."
export function formatShort(start: string, end?: string): string {
  const a = parts(start);
  if (!end || end <= start) return `${a.wd} ${a.day}. ${a.monthShort}`;
  const b = parts(end);
  if (a.year === b.year && a.month === b.month) return `${a.wd}–${b.wd} ${a.day}.–${b.day}. ${b.monthShort}`;
  return `${a.wd} ${a.day}. ${a.monthShort} – ${b.wd} ${b.day}. ${b.monthShort}`;
}

// "Freitag, 6. November 2026" · "Samstag, 15. bis Montag, 17. Mai 2027"
export function formatLong(start: string, end?: string): string {
  const a = parts(start);
  if (!end || end <= start) return `${a.wdLong}, ${a.day}. ${a.month} ${a.year}`;
  const b = parts(end);
  if (a.year === b.year && a.month === b.month) {
    return `${a.wdLong}, ${a.day}. bis ${b.wdLong}, ${b.day}. ${b.month} ${b.year}`;
  }
  return `${a.wdLong}, ${a.day}. ${a.month} bis ${b.wdLong}, ${b.day}. ${b.month} ${b.year}`;
}

// Heutiges Datum in der Schweiz als "JJJJ-MM-TT".
// Wichtig, weil der Build bei GitHub in UTC läuft.
function todayInSwitzerland(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const today = todayInSwitzerland();

// Tage zwischen zwei Daten (b minus a)
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// Tage von heute bis zum Datum (negativ = vergangen)
const daysUntil = (iso: string) => dayDiff(today, iso);

// Längste plausible Dauer eines Termins in Tagen. Ein Enddatum weiter weg ist fast sicher ein
// Eingabefehler (z. B. ein vom CMS automatisch eingesetztes Datum) und wird ignoriert.
const MAX_DAYS = 31;

// Enddatum nur übernehmen, wenn es plausibel ist: nach dem Start und höchstens MAX_DAYS später.
function validEndDate(e: RawEvent): string | undefined {
  if (!e.endDate || e.endDate <= e.date) return undefined;
  const days = dayDiff(e.date, e.endDate);
  if (days > MAX_DAYS) {
    console.warn(
      `[events] «${e.title}» (${e.date}): Enddatum ${e.endDate} ignoriert, ${days} Tage sind unplausibel.`
    );
    return undefined;
  }
  return e.endDate;
}

// Letzter Tag eines Termins (bei mehrtägigen das Enddatum)
const lastDay = (e: RawEvent) => validEndDate(e) ?? e.date;

// "in 29 Tagen" · "morgen" · "heute" · "läuft gerade" · "vorbei"
export function formatRelative(e: RawEvent): string {
  const start = daysUntil(e.date);
  const end = daysUntil(lastDay(e));
  if (start > 1) return `in ${start} Tagen`;
  if (start === 1) return 'morgen';
  if (start === 0) return 'heute';
  if (end >= 0) return 'läuft gerade';
  return 'vorbei';
}

// Alle Events aus events.json (gepflegt im CMS), nach Datum sortiert.
export const events: ClubEvent[] = (data as RawEvent[])
  .map((e) => {
    const p = parts(e.date);
    const end = validEndDate(e);
    const clean = { ...e, endDate: end };
    return {
      ...clean,
      dateLabel: formatDateRange(e.date, end),
      shortLabel: formatShort(e.date, end),
      longLabel: formatLong(e.date, end),
      relativeLabel: formatRelative(clean),
      day: p.day2,
      monthShort: p.monthShort.replace('.', ''),
    };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

// Kommende Termine (laufende mehrtägige eingeschlossen) – das zeigt die Startseite.
export const upcomingEvents: ClubEvent[] = events.filter((e) => lastDay(e) >= today);

// Der nächste Termin (für den Kopfbereich der Events-Seite) und alle weiteren.
export const nextEvent: ClubEvent | undefined = upcomingEvents[0];
export const furtherEvents: ClubEvent[] = upcomingEvents.slice(1);

// Vergangene Termine, neueste zuerst.
export const pastEvents: ClubEvent[] = events.filter((e) => lastDay(e) < today).reverse();
