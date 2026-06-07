// Ad-hoc harness: run the REAL Tour-Genius (src/lib/tourgen.ts) against the REAL
// router (BRouter) for Wassen and print the ranked variants, so we can judge
// whether the top suggestion is actually a sensible day tour.
//
// Run with:  node --import ./scripts/ts-resolve-register.mjs scripts/test-tourgen.mjs

import { findTours, targetKm, targetMin } from "../src/lib/tourgen.ts";

const wassen = { lat: 46.7068, lng: 8.5996, name: "Wassen" };
const duration = process.argv[2] === "half" ? "half" : "full";
const profile = process.argv[3] || "kurvig_plus";

const fmtH = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;

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
