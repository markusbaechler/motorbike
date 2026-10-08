# Datenschutz-Abschnitt für die Website (pudgilly.ch)

Vorschlag für Abschnitt 5 der Datenschutzerklärung (`src/pages/datenschutz.astro`
im Website-Repo). Er ersetzt den heutigen Absatz «Eingebetteter Routenplaner» und
nennt die Dienste, die der Planer tatsächlich anspricht. Sobald der Planer unter
`pudgilly.ch/planer/` läuft, entfällt der Satz zu GitHub Pages.

---

## 5. Routenplaner

Unser Routenplaner läuft vollständig in deinem Browser. Es gibt kein Konto, und
die von dir geplanten Touren werden nur lokal auf deinem Gerät gespeichert
(Browser-Speicher). Sie verlassen dein Gerät nur, wenn du eine Tour selbst teilst
oder exportierst.

Damit Karte, Routen und Wetter funktionieren, fragt der Planer bei der Nutzung
folgende Dienste ab. Dabei wird jeweils deine IP-Adresse übermittelt, bei der
Routenberechnung zusätzlich die Koordinaten deiner Start-, Zwischen- und
Zielpunkte, bei der Ortssuche der eingegebene Suchtext und beim Wetter der Ort
und das Datum der Übernachtung:

- **Kartendarstellung:** OpenFreeMap (Betreiber: Hyperknot, Ungarn, Daten von
  OpenStreetMap). <https://openfreemap.org/>
- **Routenberechnung:** BRouter, öffentlicher Server brouter.de (Betreiber:
  BRouter-Projekt, Deutschland). <https://brouter.de/>
- **Ortssuche:** Photon (Betreiber: komoot GmbH, Deutschland, Daten von
  OpenStreetMap). <https://photon.komoot.io/>
- **Wetter:** Open-Meteo (Betreiber: Open-Meteo, Schweiz).
  <https://open-meteo.com/en/terms>
- **Übernachtungen:** Der Button «Hotels» öffnet Booking.com (Booking.com B.V.,
  Niederlande) in einem neuen Fenster mit Ort, Datum und Reisendenzahl. Erst mit
  dem Klick werden Daten an Booking.com übermittelt. Die Links können eine
  Partner-Kennung des Clubs enthalten; der Preis für dich ändert sich dadurch
  nicht.

Deinen Standort verwendet der Planer nur, wenn du das im Browser ausdrücklich
erlaubst (Knopf «Standort» auf der Karte); er wird nicht gespeichert.

Der Planer wird derzeit bei GitHub Pages gehostet (GitHub Inc., USA). Beim
Aufruf wird deine IP-Adresse an GitHub übermittelt. Details in der
[Datenschutzerklärung von GitHub](https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement).
