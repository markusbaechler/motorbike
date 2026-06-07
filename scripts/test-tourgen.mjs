// Ad-hoc harness: run the REAL Tour-Genius (src/lib/tourgen.ts) against the REAL
// router (BRouter) for Wassen and print the ranked variants, so we can judge
// whether the top suggestion is actually a sensible day tour.
//
// Run with:  node --import ./scripts/ts-resolve-register.mjs scripts/test-tourgen.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The pass DB is fetched via a relative URL in the browser; in Node we shim
// fetch so that request resolves to the local file. All other requests
// (BRouter, absolute URLs) fall through to the real fetch.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASSES_EUROPE = readFileSync(join(ROOT, "public", "passes-europe.json"), "utf8");
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  if (url.includes("passes-europe.json")) {
    return Promise.resolve(new Response(PASSES_EUROPE, { status: 200 }));
  }
  return realFetch(input, init);
};

const { findTours, targetKm, targetMin } = await import("../src/lib/tourgen.ts");

const wassen = { lat: 46.7068, lng: 8.5996, name: "Wassen" };
const duration = process.argv[2] === "half" ? "half" : "full";
const profile = process.argv[3] || "kurvig_plus";

const fmtH = (min) => {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

console.log(
  `\nTour-Genius · Start ${wassen.name} · ${duration} (Ziel ${targetKm(duration)} km / ~${fmtH(targetMin(duration))}) · ${profile}\n`,
);

const cands = await findTours(wassen, duration, profile);

cands.forEach((c, i) => {
  const a = c.analysis;
  const rk = a.roadKm;
  const big = ((rk.haupt + rk.schnell + rk.autobahn) / c.distanceKm) * 100;
  const small = (rk.neben / c.distanceKm) * 100;
  console.log(
    `#${i + 1}  ${c.distanceKm.toFixed(0)} km  ${fmtH(c.durationMin)}  ` +
      `${a.passes} Pässe  ${a.ascentM} hm  ${a.cornersPerKm.toFixed(1)} K/km  ` +
      `score ${a.scores.overall}  | gross ${big.toFixed(0)}% klein ${small.toFixed(0)}% ` +
      `doubled ${(c.doubled * 100).toFixed(0)}% passBonus ${c.passBonus}`,
  );
});
console.log("");
