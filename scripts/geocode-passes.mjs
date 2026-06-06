#!/usr/bin/env node
// One-off, policy-compliant geocoder that bakes pass coordinates into
// src/data/pass-coords.json so the app no longer needs to geocode in the
// browser. Run it once (in any environment with internet access):
//
//     npm run geocode            # geocode all passes still missing coords
//     RETRY_FAILED=1 npm run geocode   # also retry previously failed lookups
//     ONLY=Schweiz npm run geocode     # restrict to one country (testing)
//
// Coordinates are written as { "<pass-id>": [lon, lat] }; passes that could
// not be resolved are recorded as null so reruns skip them (unless
// RETRY_FAILED=1). The script is resumable: it saves after every lookup, so
// you can stop and restart at any time.
//
// Nominatim usage policy: max 1 request/second, valid User-Agent, no heavy
// bulk use. This script honours all three.  https://nominatim.org/

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../src/data");
const PASSES_FILE = resolve(DATA_DIR, "passes.json");
const COORDS_FILE = resolve(DATA_DIR, "pass-coords.json");

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1100;
const USER_AGENT =
  "motorbike-passeplaner/1.0 (one-off pass geocoder; https://github.com/markusbaechler/motorbike)";

const COUNTRY_ISO = {
  Albanien: "al", Andorra: "ad", "Bosnien und Herzegowina": "ba",
  Bulgarien: "bg", Deutschland: "de", Frankreich: "fr", Griechenland: "gr",
  Italien: "it", Kroatien: "hr", Montenegro: "me", Nordmazedonien: "mk",
  Portugal: "pt", Rumänien: "ro", Schweiz: "ch", Serbien: "rs",
  Slowakei: "sk", Slowenien: "si", Spanien: "es", Tschechien: "cz",
  Österreich: "at",
};

const ONLY = process.env.ONLY || null;
const RETRY_FAILED = process.env.RETRY_FAILED === "1";

const passes = JSON.parse(readFileSync(PASSES_FILE, "utf-8"));
const coords = existsSync(COORDS_FILE)
  ? JSON.parse(readFileSync(COORDS_FILE, "utf-8"))
  : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function save() {
  // Stable, sorted output keeps diffs small and reviewable.
  const sorted = Object.fromEntries(
    Object.keys(coords).sort().map((k) => [k, coords[k]]),
  );
  writeFileSync(COORDS_FILE, JSON.stringify(sorted, null, 0) + "\n");
}

async function geocode(pass) {
  const cc = pass.countries.map((c) => COUNTRY_ISO[c]).filter(Boolean).join(",");
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    "accept-language": "de",
    q: pass.query,
  });
  if (cc) params.set("countrycodes", cc);
  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;
  const round = (n) => Math.round(n * 1e5) / 1e5;
  return [round(parseFloat(data[0].lon)), round(parseFloat(data[0].lat))];
}

const todo = passes.filter((p) => {
  if (ONLY && !p.countries.includes(ONLY)) return false;
  if (!(p.id in coords)) return true;
  return RETRY_FAILED && coords[p.id] === null;
});

console.log(
  `${passes.length} Pässe total, ${Object.keys(coords).length} bereits gecacht, ` +
    `${todo.length} zu geokodieren${ONLY ? ` (nur ${ONLY})` : ""}.`,
);
if (todo.length) {
  const mins = Math.ceil((todo.length * MIN_INTERVAL_MS) / 60000);
  console.log(`Geschätzte Dauer: ~${mins} Min (1 Anfrage/Sekunde).\n`);
}

let ok = 0;
let fail = 0;
for (let i = 0; i < todo.length; i++) {
  const p = todo[i];
  const t0 = Date.now();
  try {
    const c = await geocode(p);
    coords[p.id] = c;
    if (c) ok++;
    else fail++;
    process.stdout.write(
      `[${i + 1}/${todo.length}] ${c ? "✓" : "✗"} ${p.name}\n`,
    );
  } catch (err) {
    // Network/HTTP error: leave it unrecorded so a later run retries it.
    process.stdout.write(`[${i + 1}/${todo.length}] ! ${p.name} (${err.message})\n`);
  }
  if ((i + 1) % 20 === 0) save();
  const elapsed = Date.now() - t0;
  if (i < todo.length - 1 && elapsed < MIN_INTERVAL_MS)
    await sleep(MIN_INTERVAL_MS - elapsed);
}

save();
console.log(`\nFertig. ${ok} gefunden, ${fail} ohne Treffer.`);
console.log(`Geschrieben: ${COORDS_FILE}`);
console.log("Bitte src/data/pass-coords.json committen.");
