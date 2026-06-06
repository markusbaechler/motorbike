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

## Pässeplaner

Die App enthält einen **Pässeplaner**, der die *Passliste Europa*
(1063 Pässe, Quelle: [moto-pass.eu](https://moto-pass.eu/)) auf der Karte
nutzbar macht. Ablauf im linken Panel:

1. **Startort** eingeben.
2. **Rundtour** (ja/nein) wählen – falls nein, **Zielort** eingeben.
3. **Belag** wählen: *Nur Asphalt* oder *Inkl. Unbefestigt*.
4. **Pässe einblenden**: Pässe im Korridor zwischen Start und Ziel
   (bzw. im Umkreis bei Rundtour) werden auf der Karte angezeigt.
5. **Markieren**: Pässe per Klick auf der Karte oder in der Liste als
   **Need-to** (rot) oder **Nice-to** (gelb) markieren – markierte Pässe
   werden hervorgehoben und beschriftet.
6. **Route planen**: BRouter verbindet Start → markierte Pässe → Ziel zu
   einer Route; die Wegpunkte werden mit den Passnamen aufgelistet.

### Datenquelle & Koordinaten

Die Tabelle enthält **keine Koordinaten**. Diese werden daher einmalig
**vorab geokodiert und fest in der App abgelegt** in
[`src/data/pass-coords.json`](src/data/pass-coords.json)
(Format `{ "<pass-id>": [lon, lat] }`). Die App liest diese Koordinaten beim
Einblenden direkt – ohne Netzwerk.

Eine Auswahl bekannter Alpenpässe ist bereits eingetragen. Um **alle ~1063
Pässe** zu geokodieren, einmalig folgendes ausführen (in einer Umgebung mit
Internetzugang – das CI-/Web-Sandbox blockiert Geocoder):

```bash
npm run geocode                  # alle noch fehlenden Pässe geokodieren
RETRY_FAILED=1 npm run geocode   # zusätzlich frühere Fehlschläge erneut versuchen
ONLY=Schweiz npm run geocode     # nur ein Land (zum Testen)
```

Das Skript ([`scripts/geocode-passes.mjs`](scripts/geocode-passes.mjs)) nutzt
**Nominatim (OpenStreetMap)** richtlinienkonform (gültiger User-Agent,
max. 1 Anfrage/Sekunde), ist **fortsetzbar** (speichert laufend) und
schreibt das Ergebnis nach `src/data/pass-coords.json` – danach committen.

Für Pässe, die (noch) nicht in `pass-coords.json` stehen, fällt die App auf
eine **browserseitige Geokodierung** (Nominatim, in `localStorage`
gecacht) zurück, sodass nichts fehlt.

> **Hinweis zur Wintersperre:** Die Angabe in den Daten ist eine reine
> Höhen-Heuristik (≥2000 m = wahrscheinlich gesperrt) und **nicht
> verifiziert**. Für verbindliche Öffnungszeiten offizielle Strasseninfos
> bzw. den TCS konsultieren.

## Meilensteine

- [x] **M1 – Grundgerüst**: PWA-Setup, Karte, Standort.
- [x] **Pässeplaner**: Passliste Europa, Korridor-Filter, Markierung, Routing.
- [ ] **M2 – Routing-Kern**: Start/Ziel/Stopps, Motorrad-Routing (BRouter), Kurven-Regler.
- [ ] **M3 – Route bearbeiten**: Wegpunkte verschieben, Distanz/Zeit/Höhenprofil.
- [ ] **M4 – Sehenswürdigkeiten**: POIs entlang der Route, Filter.
- [ ] **M5 – Booking.com**: Deep-Link-Buttons pro Etappe/Ort.
- [ ] **M6 – Speichern & PWA-Feinschliff**: Routen lokal speichern/laden.
- [ ] **M7 (optional)**: Konten + Cloud-Sync, Offline-Karten.
