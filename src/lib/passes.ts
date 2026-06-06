// Curated list of great motorcycle passes & roads (Switzerland + neighbouring
// border regions). The Tour-Genius steers loops over the ones within reach of
// the start, so it actively hits famous roads instead of random village lanes.
// Coordinates are a representative point on the road/pass (a few hundred metres
// of accuracy is plenty — BRouter snaps to the nearest road).

export interface NamedPlace {
  name: string;
  lat: number;
  lng: number;
}

export const PASSES: NamedPlace[] = [
  // --- Ticino & around ---
  { name: "Alpe di Neggia", lat: 46.110, lng: 8.8095 },
  { name: "Indemini", lat: 46.097, lng: 8.7952 },
  { name: "Monte Ceneri", lat: 46.135, lng: 8.907 },
  { name: "Centovalli", lat: 46.165, lng: 8.630 },
  { name: "Valle Verzasca (Sonogno)", lat: 46.350, lng: 8.792 },
  { name: "Valle Maggia (Bignasco)", lat: 46.339, lng: 8.609 },
  { name: "Val Bavona (San Carlo)", lat: 46.402, lng: 8.510 },
  { name: "Monte Generoso", lat: 45.928, lng: 9.018 },
  { name: "Passo del San Gottardo (Tremola)", lat: 46.5546, lng: 8.5665 },

  // --- Central & eastern Swiss alpine passes ---
  { name: "Nufenenpass", lat: 46.4775, lng: 8.388 },
  { name: "Grimselpass", lat: 46.5614, lng: 8.3393 },
  { name: "Furkapass", lat: 46.572, lng: 8.4152 },
  { name: "Sustenpass", lat: 46.7262, lng: 8.4456 },
  { name: "Klausenpass", lat: 46.870, lng: 8.8567 },
  { name: "Oberalppass", lat: 46.6573, lng: 8.671 },
  { name: "Lukmanierpass", lat: 46.566, lng: 8.8063 },
  { name: "Pragelpass", lat: 46.978, lng: 8.8712 },
  { name: "Brünigpass", lat: 46.7585, lng: 8.1352 },
  { name: "Glaubenbielenpass", lat: 46.838, lng: 8.196 },
  { name: "Ibergeregg", lat: 47.075, lng: 8.756 },

  // --- Graubünden ---
  { name: "San Bernardino", lat: 46.4954, lng: 9.1712 },
  { name: "Splügenpass", lat: 46.5052, lng: 9.3301 },
  { name: "Malojapass", lat: 46.4023, lng: 9.6954 },
  { name: "Julierpass", lat: 46.4604, lng: 9.7259 },
  { name: "Albulapass", lat: 46.5832, lng: 9.8323 },
  { name: "Flüelapass", lat: 46.7494, lng: 9.9479 },
  { name: "Ofenpass (Pass dal Fuorn)", lat: 46.6330, lng: 10.2877 },
  { name: "Berninapass", lat: 46.4112, lng: 10.022 },
  { name: "Umbrailpass", lat: 46.530, lng: 10.4448 },
  { name: "Flimserstein / Panixer", lat: 46.806, lng: 9.078 },

  // --- Western Switzerland / Valais / Berner Oberland ---
  { name: "Grosser St. Bernhard", lat: 45.869, lng: 7.1707 },
  { name: "Col de la Forclaz", lat: 46.058, lng: 7.0007 },
  { name: "Col du Sanetsch", lat: 46.330, lng: 7.300 },
  { name: "Col des Mosses", lat: 46.392, lng: 7.100 },
  { name: "Col du Pillon", lat: 46.349, lng: 7.2113 },
  { name: "Jaunpass", lat: 46.547, lng: 7.285 },
  { name: "Gurnigel", lat: 46.730, lng: 7.450 },
  { name: "Schallenberg", lat: 46.850, lng: 7.780 },
  { name: "Simplonpass", lat: 46.2503, lng: 8.0306 },

  // --- Border Italy ---
  { name: "Passo dello Stelvio", lat: 46.5288, lng: 10.4534 },
  { name: "Passo del Mortirolo", lat: 46.247, lng: 10.267 },
  { name: "Passo di Gavia", lat: 46.343, lng: 10.492 },
  { name: "Passo San Marco", lat: 46.050, lng: 9.630 },

  // --- Border Austria (Vorarlberg) ---
  { name: "Silvretta Hochalpenstrasse", lat: 46.918, lng: 10.090 },
  { name: "Hochtannbergpass", lat: 47.270, lng: 10.130 },
];
