// Mapping of the German country names used in the spreadsheet to ISO-3166
// alpha-2 codes (for Nominatim `countrycodes`) plus a small adjacency graph.
// The adjacency graph lets the planner optionally widen the candidate set to
// neighbouring countries when a route runs close to a border.

export const COUNTRY_ISO: Record<string, string> = {
  Albanien: "al",
  Andorra: "ad",
  "Bosnien und Herzegowina": "ba",
  Bulgarien: "bg",
  Deutschland: "de",
  Frankreich: "fr",
  Griechenland: "gr",
  Italien: "it",
  Kroatien: "hr",
  Montenegro: "me",
  Nordmazedonien: "mk",
  Portugal: "pt",
  Rumänien: "ro",
  Schweiz: "ch",
  Serbien: "rs",
  Slowakei: "sk",
  Slowenien: "si",
  Spanien: "es",
  Tschechien: "cz",
  Österreich: "at",
};

/** Reverse lookup: ISO alpha-2 → German country name from the dataset. */
export const ISO_COUNTRY: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_ISO).map(([name, iso]) => [iso, name]),
);

/**
 * Neighbouring countries (German names, restricted to those present in the
 * dataset). Used to optionally broaden the candidate set near borders.
 */
export const NEIGHBOURS: Record<string, string[]> = {
  Albanien: ["Montenegro", "Nordmazedonien", "Griechenland"],
  Andorra: ["Frankreich", "Spanien"],
  "Bosnien und Herzegowina": ["Kroatien", "Montenegro", "Serbien"],
  Bulgarien: ["Griechenland", "Nordmazedonien", "Rumänien", "Serbien"],
  Deutschland: ["Frankreich", "Schweiz", "Österreich", "Tschechien"],
  Frankreich: ["Andorra", "Deutschland", "Italien", "Schweiz", "Spanien"],
  Griechenland: ["Albanien", "Bulgarien", "Nordmazedonien"],
  Italien: ["Frankreich", "Schweiz", "Slowenien", "Österreich"],
  Kroatien: ["Bosnien und Herzegowina", "Montenegro", "Serbien", "Slowenien"],
  Montenegro: ["Albanien", "Bosnien und Herzegowina", "Kroatien", "Serbien"],
  Nordmazedonien: ["Albanien", "Bulgarien", "Griechenland", "Serbien"],
  Portugal: ["Spanien"],
  Rumänien: ["Bulgarien", "Serbien"],
  Schweiz: ["Deutschland", "Frankreich", "Italien", "Österreich"],
  Serbien: [
    "Bosnien und Herzegowina",
    "Bulgarien",
    "Kroatien",
    "Montenegro",
    "Nordmazedonien",
    "Rumänien",
  ],
  Slowakei: ["Tschechien", "Österreich"],
  Slowenien: ["Italien", "Kroatien", "Österreich"],
  Spanien: ["Andorra", "Frankreich", "Portugal"],
  Tschechien: ["Deutschland", "Slowakei", "Österreich"],
  Österreich: [
    "Deutschland",
    "Italien",
    "Schweiz",
    "Slowakei",
    "Slowenien",
    "Tschechien",
  ],
};

/** Expand a set of countries by their direct neighbours. */
export function withNeighbours(countries: Iterable<string>): Set<string> {
  const out = new Set<string>(countries);
  for (const c of countries) {
    for (const n of NEIGHBOURS[c] ?? []) out.add(n);
  }
  return out;
}
