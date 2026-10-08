# Club-Touren: Website und Routenplaner verzahnt (Paket 5)

Die Touren des Clubs werden einmal im Pages CMS der Website gepflegt und
erscheinen an drei Orten:

| Ort | Was |
| --- | --- |
| `pudgilly.ch/touren/` | Seite mit allen Club-Touren: Region, Anspruch, Kilometer, Fahrzeit, Tage, Etappenorte, Highlights, nächste Ausfahrt, Button «Im Planer öffnen». |
| `pudgilly.ch/events/` | Termine mit Feld «Club-Tour» zeigen «Zur Tour» bzw. «Tour ansehen». |
| Routenplaner | Startbildschirm «Club-Touren» und «Meine Touren → Club-Touren»: Liste aus `pudgilly.ch/touren.json`, «Laden» holt die Tour auf die Karte. |

## So trägt der Admin eine Tour ein

1. Tour im Routenplaner planen (oder eine gespeicherte laden), warten bis die
   Route berechnet ist.
2. «Teilen» → «Link kopieren». Der Link enthält alle Punkte, Fahrstile, Tage
   und neu auch Distanz und Fahrzeit.
3. Pages CMS → **Club-Touren** → neuer Eintrag: Kürzel, Name, Region, Anspruch,
   Beschreibung, Highlights, **Planer-Link** einfügen, optional Bild.
4. Speichern. Der Website-Build läuft automatisch; danach steht die Tour auf
   `/touren/` und im Planer.
5. Optional: beim passenden Termin unter **Events** das Feld «Club-Tour» mit
   dem Kürzel füllen.

Kürzel: Kleinbuchstaben, Ziffern, Bindestrich (z. B. `buendnerrunde`). Die
Website normalisiert Umlaute und Grossbuchstaben selbst, Events dürfen also
auch `Bündnerrunde` eintragen. Doppelte Kürzel: die zweite Tour wird beim
Build mit Warnung verworfen.

## Datenmodell

`src/data/touren.json` im Website-Repo, ein Eintrag:

```json
{
  "slug": "gotthard-runde",
  "title": "Gotthard-Runde",
  "region": "Uri / Tessin",
  "level": "mittel",
  "description": "Klassiker über Gotthard und Nufenen, mit Übernachtung in Andermatt.",
  "highlights": ["Gotthard", "Nufenen", "Tremola"],
  "planerLink": "https://pudgilly.ch/planer/#r=eyJ2IjoxLCJ3IjpbWy4uLl1dLCJzIjpbMjQ1LDMyMF19",
  "image": "/galerie/gotthard.jpg"
}
```

Aus dem Planer-Link liest der Build (`src/data/touren.ts`):

| Feld | Herkunft |
| --- | --- |
| Punkte, Etappenorte | Zeilen des Links (`w`), Ortsname bis zum ersten Komma |
| Tage | 1 + Anzahl markierte Tagesabschlüsse (ohne Ziel) |
| Distanz, Fahrzeit | `s: [km, min]`, vom Planer beim Teilen eingebettet (seit Paket 5). Fehlt es, werden sie nicht angezeigt. |
| Planer-Button | immer `/planer/#r=…`, egal welche Adresse im CMS steht |

`src/pages/touren.json.ts` schreibt `dist/touren.json`:

```json
{
  "v": 1,
  "generated": "2026-10-08",
  "tours": [
    {
      "slug": "gotthard-runde",
      "title": "Gotthard-Runde",
      "region": "Uri / Tessin",
      "level": "mittel",
      "description": "…",
      "highlights": ["Gotthard", "Nufenen", "Tremola"],
      "distanceKm": 245,
      "durationMin": 320,
      "days": 2,
      "code": "eyJ2IjoxLCJ3IjpbWy4uLl1dfQ",
      "url": "https://pudgilly.ch/touren/#gotthard-runde",
      "next": { "date": "2027-07-03", "label": "Sa 3. Juli" }
    }
  ]
}
```

Der Planer (`src/lib/clubtours.ts`) prüft jeden Eintrag streng: ohne gültiges
`code` (mindestens zwei Punkte), `slug` und `title` fällt die Tour weg. Die
Liste wird pro Sitzung einmal geladen; ein Fehler lässt sich wiederholen. Auf
der alten Adresse (GitHub Pages) ist der Einstieg ausgeblendet, weil der Feed
dort wegen der Browser-Herkunftsregel nicht lesbar ist.

## Website-Repo anpassen (pudgilly-riders)

Fertige Dateien unter `docs/website/`, Struktur wie im Website-Repo:

| Datei | Ziel | Art |
| --- | --- | --- |
| `.pages.yml` | gleicher Pfad | ersetzen (neu: Club-Touren, Feld «Club-Tour» bei Events, Seitentexte Touren) |
| `astro.config.mjs` | gleicher Pfad | ersetzen (Umleitung `/touren/` entfällt) |
| `src/data/touren.json` | gleicher Pfad | neu (leere Liste) |
| `src/data/touren.ts` | gleicher Pfad | neu |
| `src/data/pages/touren.json` | gleicher Pfad | neu |
| `src/data/events.ts` | gleicher Pfad | ersetzen (Feld `tour`) |
| `src/pages/touren.astro` | gleicher Pfad | neu |
| `src/pages/touren.json.ts` | gleicher Pfad | neu |
| `src/pages/events.astro` | gleicher Pfad | ersetzen (Tour-Links) |
| `src/components/Header.astro`, `Footer.astro` | gleicher Pfad | ersetzen (Link «Touren») |
| `src/pages/index.astro.snippet.html` | Block «Routenplaner-Teaser» in `index.astro` | Block ersetzen |

Diese Dateien wurden mit einem Nachbau des Website-Repos (Astro 5, Node 20)
gebaut und geprüft: `/touren/`, `/events/` und `/touren.json` entstehen, kaputte
oder doppelte Einträge werden mit Warnung übersprungen.

Prompt für eine Session im Website-Repo:

```text
Du arbeitest im Repo markusbaechler/pudgilly-riders (Astro-5-Website von pudgilly.ch).
Aufgabe: Club-Touren einführen (Paket 5). Die fertigen Dateien liegen im öffentlichen
Repo markusbaechler/motorbike auf main unter docs/website/ (gleiche Ordnerstruktur wie
dieses Repo), die Beschreibung unter docs/club-touren.md. Lies zuerst die Beschreibung,
Abschnitt «Website-Repo anpassen». Rohdateien z. B. unter
https://raw.githubusercontent.com/markusbaechler/motorbike/main/docs/club-touren.md

Auf einem neuen Branch:
1. Die Tabelle im Abschnitt «Website-Repo anpassen» abarbeiten: ersetzen bzw. neu
   anlegen, Inhalt 1:1 übernehmen. Für index.astro nur den Block «Routenplaner-Teaser»
   durch das Snippet ersetzen (HTML-Kommentar am Anfang weglassen).
2. Prüfen: grep nach "/touren/" zeigt keine Umleitung mehr in astro.config.mjs.
3. npm ci && npm run build fehlerfrei; dist/touren/index.html, dist/events/index.html
   und dist/touren.json existieren; dist/touren.json enthält {"v":1,"tours":[]}.
4. Testweise einen Eintrag in src/data/touren.json anlegen (Beispiel in
   docs/club-touren.md, Planer-Link aus dem Routenplaner unter https://pudgilly.ch/planer/
   per «Teilen → Link kopieren» holen oder den Beispiel-Link aus der Doku nehmen),
   bauen, dist/touren/index.html muss die Tour zeigen; danach den Testeintrag
   wieder entfernen, ausser ich sage, er soll bleiben.
5. Committen (Deutsch, ss statt ß), pushen, Pull Request gegen main mit Zusammenfassung
   und Prüfergebnis. PR-Link melden und auf mein OK zum Merge warten; nach dem Merge
   den Workflow «Build & Deploy» beobachten und Fehler beheben, bis er grün ist.

Antworte auf Deutsch (Schweiz), ss statt ß.
```

Nach dem Merge: Pages CMS neu laden, unter **Club-Touren** die ersten Touren
eintragen. Der Planer zeigt sie nach dem nächsten Website-Build.
