# 🏍️ Motorbike – Routenplaner

Eine installierbare Web-App (PWA) zum Planen **kurviger, spektakulärer
Motorradrouten**, zum Anpassen der Route unterwegs, zum Entdecken von
**Sehenswürdigkeiten** (Aussichtspunkte/Natur, Motorrad-Spots, Gastronomie)
und zum Finden von **Übernachtungen via Booking.com**.

## Grundsätze

- **Komplett kostenlos**: ausschließlich freie, schlüssellose Dienste.
- **Reine statische App**: kein eigener Server, kein Backend → keine laufenden Kosten.
- **Lokal-first**: Routen werden zunächst lokal im Browser gespeichert
  (Cloud-Sync ist als späterer Schritt vorgesehen).

## Verwendete freie Dienste

| Zweck | Dienst | Schlüssel nötig? |
| --- | --- | --- |
| Kartenkacheln | [OpenFreeMap](https://openfreemap.org/) | nein |
| Kurven-Routing | [BRouter](https://brouter.de/) *(ab M2)* | nein |
| Sehenswürdigkeiten | OpenStreetMap / Overpass + Wikidata *(ab M4)* | nein |
| Übernachtung | Booking.com Deep-Links *(ab M5)* | nein |

## Entwicklung

```bash
npm install      # Abhängigkeiten installieren
npm run dev      # Entwicklungsserver starten (http://localhost:5173)
npm run build    # Produktions-Build nach dist/
npm run preview  # Produktions-Build lokal ansehen
```

## Tech-Stack

React + TypeScript + Vite, MapLibre GL JS für die Karte, `vite-plugin-pwa`
für die Installierbarkeit.

## Meilensteine

- [x] **M1 – Grundgerüst**: PWA-Setup, Karte, Standort.
- [ ] **M2 – Routing-Kern**: Start/Ziel/Stopps, Motorrad-Routing (BRouter), Kurven-Regler.
- [ ] **M3 – Route bearbeiten**: Wegpunkte verschieben, Distanz/Zeit/Höhenprofil.
- [ ] **M4 – Sehenswürdigkeiten**: POIs entlang der Route, Filter.
- [ ] **M5 – Booking.com**: Deep-Link-Buttons pro Etappe/Ort.
- [ ] **M6 – Speichern & PWA-Feinschliff**: Routen lokal speichern/laden.
- [ ] **M7 (optional)**: Konten + Cloud-Sync, Offline-Karten.
