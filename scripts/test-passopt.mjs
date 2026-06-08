// Verification harness for the Pässeplaner loop optimiser (src/lib/passopt.ts).
//
// Runs the REAL optimiser against the REAL router (BRouter, https://brouter.de)
// for several cases, prints a before/after comparison (marked-only ordering vs
// the router-scored optimised tour) and asserts the mandatory case:
//
//   Start Wassen, marked Susten + Gotthard (round trip) MUST produce a tour
//   over Susten – Grimsel – Furka – Gotthard (not Oberalp, not the eastward
//   detour).
//
// Run with:  node scripts/test-passopt.mjs
// Requires Node >= 22 (imports .ts directly via type-stripping) and network
// access to brouter.de.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { optimizeLoop } from "../src/lib/passopt.ts";
import { orderByNearestNeighbour, orderForLoop } from "../src/lib/passplanner.ts";
import { fetchMultiPoint } from "../src/lib/routing.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PASSES = JSON.parse(
  readFileSync(join(ROOT, "public", "passes-europe.json"), "utf8"),
).map((p) => ({ ...p, key: `${p.lat},${p.lng}` }));

const byName = (needle) => {
  // Prefer an exact name, then a through-pass match, then any match — so e.g.
  // "Grimselpass" picks the real pass, not "Oberaarsee (… Grimselpass)" (a
  // dead-end spur) that merely contains the word.
  const lc = needle.toLowerCase();
  const hit =
    PASSES.find((p) => p.name.toLowerCase() === lc) ||
    PASSES.find((p) => p.name.toLowerCase().includes(lc) && p.kind === "pass") ||
    PASSES.find((p) => p.name.toLowerCase().includes(lc));
  if (!hit) throw new Error(`Pass not found: ${needle}`);
  return hit;
};

// Region candidate pool around a centre (mimics the corridor the app feeds in).
const regionAround = (lat, lng, radiusKm, surface = "asphalt") => {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dist = (a, b) => {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  return PASSES.filter(
    (p) =>
      (surface === "all" || p.surface === "asphalt") &&
      dist({ lat, lng }, p) <= radiusKm,
  );
};

const fmtStops = (stops) =>
  stops.map((s) => s.name ?? "·").join(" → ");

async function baseline(start, end, marked, profile) {
  const ordered = end
    ? orderByNearestNeighbour(start, marked)
    : orderForLoop(start, marked);
  const last = end ?? start;
  const stops = [
    { lat: start.lat, lng: start.lng, name: start.name },
    ...ordered.map((p) => ({ lat: p.lat, lng: p.lng, name: p.name })),
    { lat: last.lat, lng: last.lng, name: last.name },
  ];
  const r = await fetchMultiPoint(stops, profile);
  return { stops, distanceKm: r.distanceKm };
}

let failures = 0;

async function runCase({ name, start, end, markedNames, expectIncludes = [], expectExcludes = [], profile = "kurvig_plus", radiusKm = 60 }) {
  console.log(`\n=== ${name} ===`);
  const marked = markedNames.map(byName);
  const region = regionAround(start.lat, start.lng, radiusKm);

  const before = await baseline(start, end, marked, profile);
  console.log(`VORHER  (nur markiert): ${fmtStops(before.stops)}`);
  console.log(`        ${before.distanceKm.toFixed(0)} km`);

  const opt = await optimizeLoop({ start, end, marked, region, profile });
  const names = opt.stops.map((s) => (s.name ?? "").toLowerCase());
  console.log(`NACHHER (optimiert):    ${fmtStops(opt.stops)}`);
  console.log(
    `        ${opt.distanceKm.toFixed(0)} km · ${opt.passCount} Pässe · doubled ${opt.doubled.toFixed(3)} · +${opt.added.length} ergänzt (${opt.added.map((a) => a.name).join(", ") || "–"})`,
  );

  let ok = true;
  for (const inc of expectIncludes) {
    const has = names.some((n) => n.includes(inc.toLowerCase()));
    if (!has) {
      console.log(`  ✗ erwartet enthalten: ${inc}`);
      ok = false;
    }
  }
  for (const exc of expectExcludes) {
    const has = names.some((n) => n.includes(exc.toLowerCase()));
    if (has) {
      console.log(`  ✗ erwartet NICHT enthalten: ${exc}`);
      ok = false;
    }
  }
  // Order check: every expectIncludes entry must appear in the given order
  // between the marked endpoints.
  if (ok && expectIncludes.length > 1) {
    const idx = expectIncludes.map((inc) =>
      names.findIndex((n) => n.includes(inc.toLowerCase())),
    );
    for (let i = 1; i < idx.length; i++) {
      if (idx[i] <= idx[i - 1]) {
        console.log(`  ✗ falsche Reihenfolge: ${expectIncludes.join(" → ")} (${idx.join(",")})`);
        ok = false;
        break;
      }
    }
  }

  if (ok) console.log("  ✓ bestanden");
  else failures++;
  return opt;
}

console.log("BRouter-Verifikation des Pässeplaner-Optimierers …");

const wassen = { lat: 46.7068, lng: 8.5996, name: "Wassen" };
const meiringen = { lat: 46.7276, lng: 8.1857, name: "Meiringen" };
const andermatt = { lat: 46.6336, lng: 8.5941, name: "Andermatt" };

// MANDATORY case from the task.
await runCase({
  name: "Wassen · Rundtour · markiert Susten + Gotthard",
  start: wassen,
  end: null,
  markedNames: ["Sustenpass", "Gotthardpass"],
  expectIncludes: ["Susten", "Grimsel", "Furka", "Gotthard"],
  expectExcludes: ["Oberalp"],
});

// Same massif, point-to-point: Wassen → Meiringen marking Gotthard should still
// stitch the scenic passes without an eastward Oberalp detour.
await runCase({
  name: "Wassen → Meiringen · markiert Gotthard + Furka",
  start: wassen,
  end: meiringen,
  markedNames: ["Gotthardpass", "Furkapass"],
  expectIncludes: ["Gotthard"],
  expectExcludes: ["Oberalp"],
});

// Round trip from Andermatt marking only Furka: optimiser should add nearby
// through-passes (Grimsel/Gotthard) and avoid the eastward Oberalp out-and-back.
await runCase({
  name: "Andermatt · Rundtour · markiert Furka + Susten",
  start: andermatt,
  end: null,
  markedNames: ["Furkapass", "Sustenpass"],
  expectIncludes: ["Furka", "Susten"],
});

// Regression: marking the three classic passes must yield the clean
// Susten–Grimsel–Furka triangle (in order, both endpoints near the start) — NOT
// an over-stuffed knot down to Gotthard/Nufenen with an eastward Oberalp spur.
await runCase({
  name: "Wassen · Rundtour · markiert Susten + Grimsel + Furka (keine Überfüllung)",
  start: wassen,
  end: null,
  markedNames: ["Sustenpass", "Grimselpass", "Furkapass"],
  expectIncludes: ["Susten", "Grimsel", "Furka"],
  expectExcludes: ["Oberalp", "Nufenen", "Gotthard"],
});

console.log(`\n${failures === 0 ? "✅ ALLE TESTS GRÜN" : `❌ ${failures} TEST(S) FEHLGESCHLAGEN`}`);
process.exit(failures === 0 ? 0 : 1);
