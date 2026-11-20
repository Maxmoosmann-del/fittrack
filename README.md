# FitTrack

Kalorien, Makros, Wasser, Gewohnheiten und Workouts tracken – als installierbare
Web-App (PWA). Alle Daten bleiben lokal im Browser (localStorage), es gibt keinen Server.

## Lokal starten

```bash
npm run serve        # http://localhost:8080
npm test             # Logik-Tests (node:test, keine Abhängigkeiten)
```

ES-Module und der Service Worker funktionieren nur über `http://`, nicht per Doppelklick
auf `index.html` (`file://`).

## Aufbau

```
index.html, style.css, sw.js, manifest.json, Icons
js/
  main.js        Start, Tabs, Datumsnavigation, PWA
  store.js       Datenmodell (db), Laden/Speichern, Schema-Migration, ID-Helfer
  util.js        Datum, Zahlen-Validierung, Escaping
  nutrition.js   Nährwert- und Cardio-Berechnung
  habits.js      Gewohnheiten: Streak, Aufräumen
  backup.js      Export/Import mit Plausibilitätsprüfung
  api.js         OpenFoodFacts (Barcode) und Gemini (Foto-Analyse)
  presets.js     Standard-Lebensmittel für den ersten Start
  ui/            DOM-Code je Bereich (today, foods, workouts, settings, scan) + Helfer
test/            Tests für alles in js/ außer ui/
tools/serve.js   Mini-Webserver für die Entwicklung
```

Die Dateien in `js/` (außer `ui/`) kennen kein DOM und laufen deshalb auch in Node.

## Daten

- Tageseinträge speichern eine **Kopie der Nährwerte**. Ändert oder löscht man später
  ein Lebensmittel, bleiben vergangene Tage korrekt.
- Einträge, Übungen und Cardio haben eigene IDs.
- `ft_schema` hält die Datenversion. Beim Start migriert `store.js` ältere Daten
  automatisch (aktuell: v2).
- Backups (Einstellungen → Exportieren) sind JSON. Ältere Backup-Formate werden beim
  Import übernommen.

## Updates ausliefern

Beim Ändern von Dateien in `sw.js` die Konstante `CACHE` hochzählen und neue Dateien in
`ASSETS` eintragen. Der Service Worker liefert alles aus dem versionierten Cache (schneller
Start, auch offline). Eine neue `CACHE`-Version lädt alle Dateien frisch und schaltet
gemeinsam um, damit nie alte und neue Module gemischt werden; die App zeigt dann
„Update verfügbar“. Lokal (`npm run serve`) ist der Service Worker abgeschaltet.

## KI-Scanner

Braucht einen eigenen Gemini-API-Key (Einstellungen). Das Modell ist dort ebenfalls
einstellbar; Standard ist der Alias `gemini-flash-latest`, damit Abschaltungen
einzelner Modellversionen die App nicht kaputt machen.

## Icons

Quellen liegen in `icons/` als SVG (`icon.svg`, `icon-maskable.svg`, `favicon.svg`).
Die PNGs im Hauptordner (192, 512, maskable 512, Favicon 64) werden daraus im Browser
über ein Canvas gerendert. Nach dem Austausch `CACHE` in `sw.js` hochzählen, sonst
behält die installierte App die alten Icons.
Auf Android werden Icons einer bereits installierten PWA oft erst nach einiger Zeit
oder nach Neuinstallation aktualisiert.
