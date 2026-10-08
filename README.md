# 🏍️ Routenplaner der Pudgilly Riders

Installierbare Web-App (PWA) zum Planen **kurviger Motorradtouren**: Tage,
Pässe, Wetter und Übernachtungen, GPX-Export fürs Navi. Läuft komplett im
Browser, ohne Konto und ohne eigenen Server.

Der Planer ist Teil der Website des Motorradclubs **Pudgilly Riders**
([pudgilly.ch](https://pudgilly.ch), Repo `pudgilly-riders`) und übernimmt
deren Designsystem (Farben, Schrift, Radien). Der Code-Name des Projekts ist
weiterhin `motorbike`.

## Begriffe

| Begriff | Bedeutung in der App |
| --- | --- |
| **Tour** | Die geplante Ausfahrt als Ganzes: das, was gespeichert, geteilt und exportiert wird |
| **Route** | Die vom Router berechnete Linie zwischen den Punkten |
| **Punkt** | Start, Zwischenziel oder Ziel |
| **Abschnitt** | Strecke zwischen zwei Punkten, mit eigenem Fahrstil |
| **Tag** | Tagesabschnitt einer mehrtägigen Tour, endet an der Übernachtung |
| **Fahrstil** | Fun 1 (kurvig), Fun 2 (maximal kurvig), Schnell (direkt) |
| **Muss / Kann** | Pässe im Pässeplaner, die sicher bzw. nach Möglichkeit angefahren werden |

## Funktionen

- **Routing** mit drei Fahrstilen (Fun 1, Fun 2, Schnell) über BRouter, inkl.
  eigenem Kurven-Profil; Fahrstil pro Abschnitt wählbar, Umkehren, Rundtour.
- **Punkte setzen** per Ortssuche, Tipp auf die Karte, Marker verschieben oder
  Streckenlinie ziehen (fügt einen Zwischenpunkt ein).
- **Mehrtages-Touren**: Tagesenden, Tagesnamen und Daten, Wetter pro Tag,
  Hotel-Suche via Booking.com-Link.
- **Tour-Genius**: Rundtouren oder Strecken zu einem Zielort automatisch
  generieren, bewerten und als Varianten durchblättern.
- **Pässeplaner**: Pässe im Korridor auf der Karte als Need-to / Nice-to
  markieren; ein router-geprüfter Optimierer baut daraus eine saubere Schlaufe.
- **Routen-Details**: Bewertung (Kurven, Berge, Landschaft), Statistik,
  Höhenprofil, Roadbook zum Drucken, Kartenkacheln der Route offline laden.
- **Export und Teilen**: GPX (Beeline-Route, Detail-Route, Track, pro Tag),
  Routendatei (JSON) zum Sichern oder Übertragen, Teilen per Link und QR-Code.
- **Speichern**: Routen lokal im Browser; die aktuelle Route wird automatisch
  als Entwurf gesichert und kann beim nächsten Start fortgesetzt werden.
- **PWA**: installierbar, App-Shell und bereits gesehene Kartenkacheln offline.

Noch nicht enthalten: Sehenswürdigkeiten/POIs entlang der Route, Konten und
Cloud-Sync.

## Club-Touren

Die Touren des Clubs werden im Pages CMS der Website gepflegt und von der
Website als `pudgilly.ch/touren.json` veröffentlicht. Der Planer listet sie
unter «Club-Touren» und lädt sie wie einen geteilten Link; der Teilen-Link
des Planers ist umgekehrt der «Planer-Link» im CMS. Ablauf und Datenmodell:
`docs/club-touren.md`.

## Umgang mit dem Routing-Dienst

brouter.de ist ein geteilter, kostenloser Server und drosselt pro IP. Darum
laufen alle Anfragen durch eine Warteschlange (`src/lib/queue.ts`, drei
gleichzeitig), werden bei 403/429/5xx mit Backoff wiederholt, und fertige
Etappen bleiben pro `lonlats|profile` im Speicher (`src/lib/routing.ts`):
Punkt ziehen, Tag setzen oder «Erneut versuchen» lädt nur, was fehlt. Bei
Drosselung gibt es keinen stillen Wechsel auf ein anderes Profil.

## Grundsätze

- **Komplett kostenlos**: ausschliesslich freie, schlüssellose Dienste.
- **Reine statische App**: kein eigener Server, kein Backend, keine laufenden Kosten.
- **Lokal-first**: Routen bleiben im Browser des Geräts.

## Verwendete freie Dienste

| Zweck | Dienst |
| --- | --- |
| Kartenkacheln | [OpenFreeMap](https://openfreemap.org/) |
| Routing | [BRouter](https://brouter.de/) (öffentlicher Server) |
| Ortssuche | [Photon](https://photon.komoot.io/) (komoot, OpenStreetMap-Daten) |
| Wetter | [Open-Meteo](https://open-meteo.com/) |
| Pässe | Eigene Listen: `src/lib/passes.ts` (Tour-Genius, siehe `docs/passes.md`) und `public/passes-europe.json` (Pässeplaner) |
| Übernachtung | Booking.com Deep-Links (optional mit Affiliate-ID) |

## Entwicklung

```bash
npm install          # Abhängigkeiten installieren
npm run dev          # Entwicklungsserver (http://localhost:5173)
npm run build        # Produktions-Build nach dist/
npm run preview      # Produktions-Build lokal ansehen
npm run lint         # Typprüfung (tsc)
npm test             # Unit-Tests (Vitest)
npm run test:tourgen # Tour-Genius gegen den echten Router (brouter.de)
npm run test:passopt # Pässe-Optimierer gegen den echten Router
```

Build-Variablen (siehe `.env.example`): `VITE_BOOKING_AID` setzt die
Booking.com-Partner-ID des Clubs in die Hotel-Links; ohne Wert funktionieren die
Links genauso, nur ohne Provision. `VITE_MOVED_TO` wird nur auf der alten
Adresse (GitHub Pages) gesetzt und blendet die Umzugskarte ein.
`VITE_CLUB_TOURS_URL` übersteuert die Quelle der Club-Touren (Standard:
`https://pudgilly.ch/touren.json`), nützlich für die lokale Entwicklung.

## Tech-Stack

React 18 + TypeScript + Vite, MapLibre GL JS für die Karte, `vite-plugin-pwa`
für die Installierbarkeit, Vitest für Tests.

## Deployment

Der Planer ist Teil von [pudgilly.ch](https://pudgilly.ch) und läuft unter
`https://pudgilly.ch/planer/`: der Workflow des Website-Repos
(`markusbaechler/pudgilly-riders`) checkt dieses Repo aus, baut es und legt
`dist/` nach `dist/planer/`, bevor die Website per rsync deployt wird. Der
Base-Pfad ist relativ, deshalb läuft derselbe Build unter jedem Unterpfad.

`.github/workflows/deploy.yml` in diesem Repo veröffentlicht zusätzlich auf
GitHub Pages (Übergangsadresse mit Umzugskarte) und stösst, wenn das Secret
`WEBSITE_DISPATCH_TOKEN` gesetzt ist, den Website-Build an. Ablauf, Variablen
und die fertigen Website-Dateien: `docs/umzug-planer.md` und `docs/website/`.
