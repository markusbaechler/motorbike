#!/usr/bin/env node
// Offline validator for src/data/pass-coords.json. Checks every geocoded
// coordinate against the bounding box(es) of the pass's country/countries and
// flags outliers (e.g. a Nominatim mismatch that placed a Swiss pass in
// Sweden). No network access required.
//
//     npm run validate            # report outliers only
//     npm run validate -- --fix   # remove outliers so geocode re-resolves them
//
// A coordinate is valid if it falls within ANY of its pass's countries'
// bounding boxes, expanded by BORDER_BUFFER_DEG so that border passes (which
// legitimately sit a little outside the strict national box) are not flagged.
// "--fix" deletes the offending key so a later `npm run geocode` retries it;
// passes recorded as null (no Nominatim hit) are left untouched.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../src/data");
const PASSES_FILE = resolve(DATA_DIR, "passes.json");
const COORDS_FILE = resolve(DATA_DIR, "pass-coords.json");

// Generous tolerance: passes frequently straddle a border, so a strict national
// box would produce false positives. ~0.2deg is roughly 15-22 km.
const BORDER_BUFFER_DEG = 0.2;

// [minLon, minLat, maxLon, maxLat] per country (mainland; matches the set of
// countries used in passes.json / geocode-passes.mjs).
const BBOX = {
  Albanien: [19.2, 39.6, 21.1, 42.7],
  Andorra: [1.4, 42.4, 1.8, 42.7],
  "Bosnien und Herzegowina": [15.7, 42.5, 19.7, 45.3],
  Bulgarien: [22.3, 41.2, 28.7, 44.3],
  Deutschland: [5.8, 47.2, 15.1, 55.1],
  Frankreich: [-5.2, 41.3, 9.7, 51.1],
  Griechenland: [19.3, 34.8, 28.3, 41.8],
  Italien: [6.6, 35.4, 18.6, 47.1],
  Kroatien: [13.4, 42.3, 19.5, 46.6],
  Montenegro: [18.4, 41.8, 20.4, 43.6],
  Nordmazedonien: [20.4, 40.8, 23.1, 42.4],
  Portugal: [-9.6, 36.9, -6.1, 42.2],
  Rumänien: [20.2, 43.6, 29.7, 48.3],
  Schweiz: [5.9, 45.8, 10.5, 47.9],
  Serbien: [18.8, 42.2, 23.1, 46.2],
  Slowakei: [16.8, 47.7, 22.6, 49.7],
  Slowenien: [13.3, 45.4, 16.6, 46.9],
  Spanien: [-9.4, 35.9, 3.4, 43.8],
  Tschechien: [12.0, 48.5, 18.9, 51.1],
  Österreich: [9.5, 46.3, 17.2, 49.1],
};

const FIX = process.argv.includes("--fix");

const passes = JSON.parse(readFileSync(PASSES_FILE, "utf-8"));
const coords = JSON.parse(readFileSync(COORDS_FILE, "utf-8"));
const passById = new Map(passes.map((p) => [p.id, p]));

function inBox(lon, lat, [minLon, minLat, maxLon, maxLat]) {
  return (
    lon >= minLon - BORDER_BUFFER_DEG &&
    lon <= maxLon + BORDER_BUFFER_DEG &&
    lat >= minLat - BORDER_BUFFER_DEG &&
    lat <= maxLat + BORDER_BUFFER_DEG
  );
}

const outliers = [];
const orphans = []; // coord without a matching pass (or unknown country)
let checked = 0;

for (const [id, value] of Object.entries(coords)) {
  if (value === null) continue; // known "no hit", nothing to validate
  if (!Array.isArray(value) || value.length !== 2) {
    outliers.push({ id, reason: "kein [lon, lat]-Paar", value });
    continue;
  }
  const [lon, lat] = value;
  const pass = passById.get(id);
  if (!pass) {
    orphans.push({ id, reason: "keine passes.json-Entsprechung", value });
    continue;
  }
  const boxes = pass.countries.map((c) => BBOX[c]).filter(Boolean);
  if (!boxes.length) {
    orphans.push({ id, reason: `keine BBox für ${pass.countries.join("/")}`, value });
    continue;
  }
  checked++;
  if (!boxes.some((b) => inBox(lon, lat, b))) {
    outliers.push({
      id,
      name: pass.name,
      countries: pass.countries.join("/"),
      value,
    });
  }
}

console.log(
  `${Object.keys(coords).length} Einträge, ${checked} mit Koordinate validiert.`,
);
if (orphans.length) {
  console.log(`\n${orphans.length} nicht prüfbar (übersprungen):`);
  for (const o of orphans) console.log(`  - ${o.id}: ${o.reason}`);
}
if (!outliers.length) {
  console.log("\n✓ Keine Ausreißer. Alle Koordinaten liegen in ihren Länder-BBoxes.");
} else {
  console.log(`\n✗ ${outliers.length} Ausreißer ausserhalb der Länder-BBoxes:`);
  for (const o of outliers) {
    console.log(
      `  - ${o.id} (${o.name ?? "?"}, ${o.countries ?? "?"}) -> ${JSON.stringify(o.value)}`,
    );
  }
  if (FIX) {
    for (const o of outliers) delete coords[o.id];
    const sorted = Object.fromEntries(
      Object.keys(coords).sort().map((k) => [k, coords[k]]),
    );
    writeFileSync(COORDS_FILE, JSON.stringify(sorted, null, 0) + "\n");
    console.log(
      `\n${outliers.length} Ausreißer entfernt. ` +
        "Erneut `npm run geocode` laufen lassen, um sie neu aufzulösen.",
    );
  } else {
    console.log("\n(Nur Bericht. Mit `--fix` werden die Ausreißer entfernt.)");
    process.exitCode = 1;
  }
}
