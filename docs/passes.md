# Pässe & Strassen für den Tour-Genius

Diese kuratierte Liste berühmter Motorrad-Pässe dient dem **Tour-Genius** als
**Anker**: Liegt ein Eintrag in Reichweite des Startorts, baut der Genius darum
herum eine Rundtour. Dabei prüft ein router-bewerteter Optimierer jede Variante
mit dem echten Router (BRouter) und ergänzt automatisch die **Durchgangspässe,
die natürlich auf dem Weg liegen** – so entstehen saubere Mehrpass-Schleifen
(z. B. Susten–Grimsel–Furka–Gotthard) statt Hin-und-zurück-Strecken.

- **Quelle in der App:** `src/lib/passes.ts` (`DEFAULT_PASSES`) – die Anker-Liste
  ist fest gebündelt. **Dieses Dokument** ist ihre menschenlesbare Fassung; bei
  Änderungen werden beide aktuell gehalten.
- **Durchgangspässe zum Auffüllen** der Schleifen stammen aus der reichen
  Pass-Datenbank `public/passes-europe.json` (mit Belag/Typ), die auch der
  Pässeplaner nutzt.
- Koordinaten = ein repräsentativer Punkt auf der Strasse/dem Pass
  (ein paar hundert Meter Genauigkeit genügen, das Routing rastet auf die
  nächste Strasse ein).

> Änderung gewünscht? Einfach melden („Pass X hinzufügen / Y entfernen / Z
> korrigieren") – wird in `docs/passes.md` **und** `src/lib/passes.ts`
> nachgeführt.

---

## Tessin & Umgebung

| Name | Breite (lat) | Länge (lng) |
|---|---|---|
| Alpe di Neggia | 46.110 | 8.8095 |
| Indemini | 46.097 | 8.7952 |
| Monte Ceneri | 46.135 | 8.907 |
| Centovalli | 46.165 | 8.630 |
| Valle Verzasca (Sonogno) | 46.350 | 8.792 |
| Valle Maggia (Bignasco) | 46.339 | 8.609 |
| Val Bavona (San Carlo) | 46.402 | 8.510 |
| Monte Generoso | 45.928 | 9.018 |
| Passo del San Gottardo (Tremola) | 46.5546 | 8.5665 |

## Zentral- & Ostschweizer Alpenpässe

| Name | Breite (lat) | Länge (lng) |
|---|---|---|
| Nufenenpass | 46.4775 | 8.388 |
| Grimselpass | 46.5614 | 8.3393 |
| Furkapass | 46.572 | 8.4152 |
| Sustenpass | 46.7262 | 8.4456 |
| Klausenpass | 46.870 | 8.8567 |
| Oberalppass | 46.6573 | 8.671 |
| Lukmanierpass | 46.566 | 8.8063 |
| Pragelpass | 46.978 | 8.8712 |
| Brünigpass | 46.7585 | 8.1352 |
| Glaubenbielenpass | 46.838 | 8.196 |
| Ibergeregg | 47.075 | 8.756 |

## Graubünden

| Name | Breite (lat) | Länge (lng) |
|---|---|---|
| San Bernardino | 46.4954 | 9.1712 |
| Splügenpass | 46.5052 | 9.3301 |
| Malojapass | 46.4023 | 9.6954 |
| Julierpass | 46.4604 | 9.7259 |
| Albulapass | 46.5832 | 9.8323 |
| Flüelapass | 46.7494 | 9.9479 |
| Ofenpass (Pass dal Fuorn) | 46.633 | 10.2877 |
| Berninapass | 46.4112 | 10.022 |
| Umbrailpass | 46.530 | 10.4448 |
| Flimserstein / Panixer | 46.806 | 9.078 |

## Westschweiz / Wallis / Berner Oberland

| Name | Breite (lat) | Länge (lng) |
|---|---|---|
| Grosser St. Bernhard | 45.869 | 7.1707 |
| Col de la Forclaz | 46.058 | 7.0007 |
| Col du Sanetsch | 46.330 | 7.300 |
| Col des Mosses | 46.392 | 7.100 |
| Col du Pillon | 46.349 | 7.2113 |
| Jaunpass | 46.547 | 7.285 |
| Gurnigel | 46.730 | 7.450 |
| Schallenberg | 46.850 | 7.780 |
| Simplonpass | 46.2503 | 8.0306 |

## Grenznah Italien

| Name | Breite (lat) | Länge (lng) |
|---|---|---|
| Passo dello Stelvio | 46.5288 | 10.4534 |
| Passo del Mortirolo | 46.247 | 10.267 |
| Passo di Gavia | 46.343 | 10.492 |
| Passo San Marco | 46.050 | 9.630 |

## Grenznah Österreich (Vorarlberg)

| Name | Breite (lat) | Länge (lng) |
|---|---|---|
| Silvretta Hochalpenstrasse | 46.918 | 10.090 |
| Hochtannbergpass | 47.270 | 10.130 |

---

_Stand: 45 Einträge. Reihenfolge in `src/lib/passes.ts` (`DEFAULT_PASSES`) entspricht dieser Auflistung._
