# Wetter entlang der Route (Paket 2) – Design

Stand: 2026-10-10 · Status: zur Freigabe

## Ziel

Bei der Planung sehen, welches Wetter einen **unterwegs zur jeweiligen
Durchfahrtszeit** erwartet – vor allem auf Pässen – statt nur einen Tageswert
pro Wegpunkt.

## Ausgangslage

Der Planer zeigt heute schon Wetter (`src/lib/weather.ts`, Open-Meteo,
Tageswerte): pro Wegpunkt Höchst/Tiefst, Regenwahrscheinlichkeit – aber nur,
wenn der Tag ein Datum (`dayDate`) hat. Fahrzeiten pro Abschnitt liegen in
`RouteResult.legs[].durationMin` (aus Distanz und Durchschnittstempo,
`routing.ts`).

## Festgelegte Regeln

| Thema | Regel |
|---|---|
| Datum | Tag ohne `dayDate` → Tag 1 = heute, Tag n = heute + (n−1). Ein gesetztes Datum hat Vorrang; folgende Tage ohne Datum zählen ab dem letzten gesetzten weiter. |
| Startzeit | Pro Tag einstellbar. Standard: Datum = heute → jetzt, aufgerundet auf die nächste Viertelstunde; sonst 09:00. |
| Pausen | +15 Min nach je 150 km gefahrener Strecke (150, 300, …) **und** 1 Std Mittag, sobald die Uhr 12:00 erreicht. Startet der Tag um/nach 12:00, entfällt der Mittag. |
| Fahrzeit | Wie bisher aus `legs[].durationMin`, innerhalb eines Abschnitts linear über die Distanz verteilt. |

## Was man sieht

**Routen-Panel, pro Tag**
- Zeile «Start 09:00» mit Zeitauswahl (`<input type="time">`). Eine eigene
  Zeit wird gespeichert; «Standard» setzt sie zurück.
- Zusammenfassung: «Unterwegs 6–21° · max. 70 % Regen · bis 4 mm».
- Wetterband: horizontal scrollbare Leiste mit Stationen (Uhrzeit, Symbol,
  °C, Regen-%, mm wenn > 0). Pässe mit Namen.
- Bei jedem Wegpunkt statt Tageswerten: «an ca. 11:20 · ⛅ 17° · 20 %».
- Ab Tag 3 nach heute: Hinweis «Trend, unsicher».
- Ausserhalb des Prognosefensters (vergangen oder > 14 Tage): «Noch keine
  Prognose» – keine Zahlen.

**Karte**
- Kleine Wetterkreise (Symbol + °C) an jeder Station; Tipp/Klick zeigt
  Uhrzeit, Ort, °C, Regen-%, mm, Wind.
- Schalter «Wetter» in der Karte, Standard an, Einstellung bleibt gespeichert.

## Stationen (Messorte)

Pro Tag: Start, dann etwa alle 30 km entlang der Routenlinie, jeder bekannte
Pass auf der Route (aus der vorhandenen Pass-Erkennung), jeder Wegpunkt, Ziel.
Stationen näher als 8 km zueinander werden zusammengelegt (Pass und Wegpunkt
haben Vorrang). Höchstens ca. 25 Stationen pro Tag.

## Technik

Neue, getrennt testbare Module:

- `lib/schedule.ts` – reine Rechnung: Route + Tage + Startzeiten → Liste von
  Stationen mit Koordinate, Höhe, Distanz, Name/Art, Ankunftszeit
  (inkl. Pausenregeln und Standard-Datum/-Start). Keine Netzwerkzugriffe.
- `lib/weather.ts` (erweitert) – `fetchHourly(stations, date)`: **eine**
  Sammelabfrage pro Tag an Open-Meteo (mehrere Koordinaten, `hourly=
  temperature_2m,precipitation_probability,precipitation,weather_code,
  wind_speed_10m`, Höhe der Station mitgegeben, `timezone=Europe/Zurich`).
  Werte werden auf die Ankunftsstunde interpoliert.
  Zwischenspeicher pro (Koordinate gerundet, Datum) für 30 Min, damit
  Verschieben eines Punkts nur betroffene Orte neu holt.
- `components/WeatherStrip.tsx` – Wetterband + Zusammenfassung pro Tag.
- `MapView.tsx` – zusätzliche GeoJSON-Ebene für Wetterkreise + Schalter.
- Daten: `Waypoint.dayStart?: string` ("HH:MM"), wie `dayDate` am
  Tagesziel-Punkt. Mitgeführt in Speicherung, `validate.ts` und Teilen-Link
  (`share.ts`, neue optionale Spalte; alte Links bleiben gültig).
- Die bisherige Tages-Abfrage `fetchWeather` wird ersetzt; das Roadbook
  verwendet die neuen Werte bei den Wegpunkten.

## Fehlerfälle

- Open-Meteo nicht erreichbar / Fehler → Wetter-Bereiche zeigen «Wetter
  gerade nicht verfügbar», Planer funktioniert normal weiter. Kein Absturz.
- Route noch nicht berechnet → kein Wetter.
- Abfrage erst, wenn die Route ca. 1 s stabil ist (kein Feuern bei jedem
  Ziehen), laufende Abfragen werden bei Änderungen abgebrochen
  (AbortController). Die BRouter-Warteschlange (`queue.ts`) bleibt davon
  unberührt.

## Tests

- Unit-Tests für `schedule.ts`: Standard-Datum, Standard-Start (heute/jetzt
  vs. 09:00), Pausen (150-km-Regel, Mittag vor/nach 12:00, Start nach 12:00),
  Stationswahl (Abstand, Zusammenlegen, Pässe, Obergrenze).
- Unit-Tests für das Auslesen/Interpolieren der Open-Meteo-Antwort und für
  den Teilen-Link mit/ohne `dayStart`.
- Browser-Test an einer echten Tour (ein- und mehrtägig), Screenshots Handy
  und Desktop, inkl. Offline/Fehlerfall.

## Nicht Teil davon

Regenradar (Paket 1), Übersicht 24/48/72 h (Paket 3), Passsperren/Warnungen.
