# 🏍️ Motorbike – Routenplaner

Eine installierbare Web-App (PWA) zum Planen **kurviger, spektakulärer
Motorradrouten** – mit automatischer Tourgenerierung, einem Pässeplaner,
Etappen-/Höhenanalyse, GPX-Export fürs Navi und **Übernachtungen via
Booking.com**.

## Hauptfunktionen

- **Routenplanung**: Start/Stopps/Ziel setzen, kurven­betontes Motorrad-Routing
  (BRouter) in zwei Fahrstilen (Fun 1 / Fun 2), Wegpunkte verschieben/einfügen,
  Route umkehren, Distanz/Zeit/Höhenprofil, Tankstopp-/Pausen-Schätzung.
- **Tour-Genius**: generiert aus einem Startort und der gewünschten Dauer
  (½ Tag / 1 Tag) automatisch **saubere Mehrpass-Rundtouren** und reiht sie nach
  Attraktivität. Details siehe [`docs/passes.md`](docs/passes.md).
- **Pässeplaner**: bekannte Pässe in einem Korridor als *Need-/Nice-to*
  markieren – der router-bewertete Optimierer baut daraus die beste Schleife und
  ergänzt Pässe, die natürlich auf dem Weg liegen.
- **Etappen & Wetter**: Mehrtagestouren mit Übernachtungsorten und Wettervorschau.
- **Teilen & Speichern**: Route als Link teilen (`#r=…`), GPX exportieren, Routen
  lokal im Browser speichern/laden.
- **Übernachtung**: Booking.com-Deep-Links pro Etappe/Ort.

## Grundsätze

- **Komplett kostenlos**: ausschließlich freie, schlüssellose Dienste.
- **Reine statische App**: kein eigener Server, kein Backend → keine laufenden Kosten.
- **Lokal-first**: Routen werden lokal im Browser gespeichert.

## Verwendete freie Dienste

| Zweck | Dienst | Schlüssel nötig? |
| --- | --- | --- |
| Kartenkacheln | [OpenFreeMap](https://openfreemap.org/) | nein |
| Kurven-Routing | [BRouter](https://brouter.de/) | nein |
| Geocoding (Ortssuche) | [Nominatim / OpenStreetMap](https://nominatim.org/) | nein |
| Wetter | [Open-Meteo](https://open-meteo.com/) | nein |
| Übernachtung | Booking.com Deep-Links | nein |

## Entwicklung

```bash
npm install        # Abhängigkeiten installieren
npm run dev        # Entwicklungsserver (http://localhost:5173)
npm run build      # Produktions-Build nach dist/
npm run preview    # Produktions-Build lokal ansehen
npm run lint       # TypeScript-Typecheck
```

### Tests

```bash
npm test           # Unit-Tests (Vitest)
npm run test:passopt   # Pässeplaner-Optimierer gegen den echten Router (BRouter)
npm run test:tourgen   # Tour-Genius gegen den echten Router (BRouter)
```

> `test:passopt` und `test:tourgen` rufen den echten Routing-Dienst
> (brouter.de) auf und brauchen daher Netzwerkzugang sowie Node ≥ 22.

## Deployment

Push auf `main` (oder den konfigurierten Deploy-Branch) baut die App und
veröffentlicht sie über **GitHub Pages** (`.github/workflows/deploy.yml`).

## Tech-Stack

React + TypeScript + Vite, MapLibre GL JS für die Karte, `vite-plugin-pwa`
für die Installierbarkeit.

## Meilensteine

- [x] **M1 – Grundgerüst**: PWA-Setup, Karte, Standort.
- [x] **M2 – Routing-Kern**: Start/Ziel/Stopps, Motorrad-Routing (BRouter), Fahrstile.
- [x] **M3 – Route bearbeiten**: Wegpunkte verschieben, Distanz/Zeit/Höhenprofil.
- [ ] **M4 – Sehenswürdigkeiten**: POIs entlang der Route (geplant).
- [x] **M5 – Booking.com**: Deep-Link-Buttons pro Etappe/Ort.
- [x] **M6 – Speichern & PWA-Feinschliff**: Routen lokal speichern/laden, GPX, Teilen.
- [ ] **M7 (optional)**: Konten + Cloud-Sync, Offline-Karten.
