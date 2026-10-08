# Umzug des Routenplaners nach pudgilly.ch/planer/

Der Planer wird nicht mehr per iframe von GitHub Pages eingebettet, sondern vom
Website-Workflow mitgebaut und als Teil von pudgilly.ch ausgeliefert
(`https://pudgilly.ch/planer/`). Der Code bleibt in diesem Repo; die Website
holt ihn beim Bauen.

Was das bringt: gleicher Ursprung wie die Website (keine iframe-Eigenheiten,
PWA-Installation direkt von pudgilly.ch, Service Worker mit Scope `/planer/`),
Hosting in der Schweiz, kein GitHub-Hinweis mehr in der Datenschutzerklärung,
Tourlinks `pudgilly.ch/planer/#r=…`.

## Stand

| Datum | Was |
| --- | --- |
| 08.10.2026 | Schritt 1 umgesetzt (pudgilly-riders PR #2, gemerged), Planer läuft unter `https://pudgilly.ch/planer/`, `/touren/` leitet um. Schritt 2 umgesetzt: `PLANER_MOVED_TO` gesetzt, alte Adresse zeigt die Umzugskarte. Schritt 3: `WEBSITE_DISPATCH_TOKEN` hinterlegt. `BOOKING_AID` nicht gesetzt (keine Partner-ID). |

## Wie der Umzug technisch läuft

| Baustein | Wo | Was |
| --- | --- | --- |
| Website-Workflow | `pudgilly-riders/.github/workflows/deploy.yml` | Checkt dieses Repo nach `planer-src/` aus, baut es (`npm ci && npm run build`), kopiert `planer-src/dist/` nach `dist/planer/`, rsync wie bisher. Neuer Trigger `repository_dispatch: planer-updated`. |
| Umleitung | `pudgilly-riders/astro.config.mjs` | `redirects: { '/touren/': '/planer/' }` plus Sitemap-Eintrag für `/planer/`. |
| Navigation | `Header.astro`, `Footer.astro`, `index.astro` | Links auf `/planer/`. |
| Alte Seite | `src/pages/touren.astro` | Löschen (der iframe entfällt). |
| Datenschutz | `datenschutz.astro` | Abschnitt 5 durch den Text in `docs/website/src/pages/datenschutz.astro.snippet.html` ersetzen. |
| Umzugskarte | dieses Repo, `src/components/Home.tsx` | Nur wenn die Build-Variable `VITE_MOVED_TO` gesetzt ist (GitHub Pages): Karte «Der Routenplaner ist umgezogen» mit Link, der die gespeicherten Touren mitnimmt. |
| Import | dieses Repo, `src/lib/migrate.ts`, `App.tsx` | Neue Adresse liest `#migrate=…` einmalig, übernimmt Touren, Entwurf, Reisende-Einstellung und zuletzt gesuchte Orte, entfernt den Hash, zeigt einen Hinweis. |
| Anstoss | `.github/workflows/deploy.yml` (dieses Repo) | Job `notify-website` schickt nach jedem Push ein `repository_dispatch` an die Website, sofern das Secret `WEBSITE_DISPATCH_TOKEN` gesetzt ist. |

Warum ein Link mit Hash: Browser-Speicher gilt pro Ursprung. Touren, die auf
`markusbaechler.github.io` gespeichert wurden, sind auf `pudgilly.ch` nicht
sichtbar. Der Link packt sie base64-kodiert in den URL-Fragment (`#…`), das nie
an einen Server geschickt wird. Die neue Adresse übernimmt nur, was noch fehlt
(gleicher Name + gleiche Punkte = schon vorhanden); den Link zweimal zu öffnen
verdoppelt nichts. Sehr grosse Sammlungen (Richtwert: über 50 Touren mit vielen
Punkten) ergeben lange URLs; dann einzelne Touren über «Meine Touren → Datei
exportieren» mitnehmen.

## Schritt 1 – Website-Repo anpassen (pudgilly-riders)

Alle fertigen Dateien liegen unter `docs/website/` in diesem Repo, mit der
Verzeichnisstruktur des Website-Repos:

| Datei in `docs/website/` | Ziel im Website-Repo | Art |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | gleicher Pfad | ersetzen |
| `astro.config.mjs` | gleicher Pfad | ersetzen |
| `src/components/Header.astro` | gleicher Pfad | ersetzen (nur Zeile 7: `/touren/` → `/planer/`) |
| `src/components/Footer.astro` | gleicher Pfad | ersetzen (nur Zeile 21: `/touren/` → `/planer/`) |
| `src/pages/index.astro.snippet.html` | Block «Routenplaner-Teaser» in `src/pages/index.astro` | Block ersetzen |
| `src/pages/datenschutz.astro.snippet.html` | Abschnitt 5 in `src/pages/datenschutz.astro` | Abschnitt ersetzen |

Dazu:

1. `src/pages/touren.astro` löschen.
2. Optional, Aufräumen: in `src/pages/index.astro` das ungenutzte CSS
   `.tour-card`, `.tour-card__level`, `.tour-card__region`, `.tour-card__meta`
   entfernen.
3. Repo-Variable anlegen: Website-Repo → **Settings → Secrets and variables →
   Actions → Variables → New repository variable**: `BOOKING_AID` = die
   Booking.com-Partner-ID des Clubs (leer lassen ist erlaubt; die Hotel-Links
   funktionieren dann ohne Provision).
4. Push auf `main`. Der Workflow «Build & Deploy» baut Website und Planer und
   deployt beides.

Prüfen, sobald der Workflow grün ist:

- `https://pudgilly.ch/planer/` zeigt den Startbildschirm, die Karte lädt.
- Eine Tour planen, speichern, Seite neu laden: Tour ist unter «Meine Touren».
- `https://pudgilly.ch/touren/` leitet auf `/planer/` um.
- Header- und Footer-Link «Routenplaner» führen auf `/planer/`.
- Auf dem Handy: «Als App installieren» bietet die Installation von pudgilly.ch an.
- Datenschutz-Seite zeigt den neuen Abschnitt 5.

Der tägliche Neuaufbau (03:00 UTC) baut den Planer ab jetzt ebenfalls mit; das
Repo `markusbaechler/motorbike` muss dafür öffentlich bleiben (sonst braucht der
Checkout-Schritt ein Token).

## Schritt 2 – Alte Adresse auf «umgezogen» stellen (dieses Repo)

1. Repo-Variable anlegen: motorbike-Repo → **Settings → Secrets and variables →
   Actions → Variables**: `PLANER_MOVED_TO` = `https://pudgilly.ch/planer/`.
2. Optional, gleiche Stelle: `BOOKING_AID` auch hier setzen, damit die alte
   Adresse in der Übergangszeit dieselben Hotel-Links hat.
3. Workflow «Deploy PWA to GitHub Pages» im Actions-Tab manuell starten
   (**Run workflow**), oder einfach den nächsten Push abwarten.
4. `https://markusbaechler.github.io/motorbike/` aufrufen: der Startbildschirm
   zeigt die Umzugskarte. «Touren mitnehmen und wechseln» öffnet die neue
   Adresse, dort erscheint kurz «Umzug abgeschlossen: … Touren übernommen».

Wer die alte Adresse als App installiert hat, bekommt die Karte ebenfalls
(Service Worker aktualisiert sich beim nächsten Start) und sollte die App einmal
neu von pudgilly.ch installieren; die alte Installation kann danach gelöscht
werden.

Die alte Adresse bleibt bewusst stehen, bis die Mitglieder gewechselt haben
(Empfehlung: mindestens eine Saison). Abschalten später: motorbike-Repo →
**Settings → Pages → Source: None** und in `.github/workflows/deploy.yml` die
Jobs `build` und `deploy` entfernen (`notify-website` bleibt).

## Schritt 3 – Optional: Website automatisch neu bauen

Ohne diesen Schritt erscheint eine neue Planer-Version auf pudgilly.ch erst beim
nächsten Website-Push oder beim täglichen Neuaufbau um 03:00 UTC. Mit Token
sofort nach jedem Push in diesem Repo:

1. GitHub → eigenes Profil → **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories** → `pudgilly-riders`.
   - Permissions → Repository permissions → **Contents: Read and write**
     (das ist die Berechtigung, die `repository_dispatch` verlangt).
   - Ablaufdatum nach Wahl; bei Ablauf einfach ein neues Token hinterlegen.
2. motorbike-Repo → **Settings → Secrets and variables → Actions → Secrets →
   New repository secret**: `WEBSITE_DISPATCH_TOKEN` = das Token.
3. Nächster Push auf `main`: im Workflow-Lauf meldet der Job `notify-website`
   «Website-Build angestossen», im Website-Repo startet «Build & Deploy» mit
   dem Auslöser `repository_dispatch`.

Ohne Secret überspringt der Job den Aufruf mit einer Meldung; nichts schlägt
fehl.

## Lokal testen

```bash
# Umzugskarte ansehen (zeigt auf einen zweiten lokalen Server)
VITE_MOVED_TO=http://127.0.0.1:4173/ npm run build
npx vite preview --port 4173            # "neue" Adresse unter 127.0.0.1
npx vite preview --port 4174            # "alte" Adresse unter localhost
# http://localhost:4174/ → Umzugskarte → Link öffnet 127.0.0.1:4173/#migrate=…
```

`localhost` und `127.0.0.1` sind für den Browser verschiedene Ursprünge mit
getrenntem Speicher, genau wie github.io und pudgilly.ch.

## Danach: Paket 5

Mit dem Planer unter `/planer/` wird `/touren/` frei für die Club-Touren
(Tourenliste aus dem Pages CMS, Events mit Tour-Link, «In den Planer laden»).
Dann die Umleitung in `astro.config.mjs` wieder entfernen.
