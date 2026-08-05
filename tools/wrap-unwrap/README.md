# Wrap-Unwrap

Internes Werkzeug für Jan Bastke FolienDesign: 3D-Scans (OBJ/STL) im
Browser laden, mit LSCM (Least-Squares Conformal Maps) zu einer 2D-Bahn
abwickeln, Verzerrungs-Heatmap anzeigen.

## Lokal starten

```
cd tools/wrap-unwrap
npm install
npm run dev
```

Dev-Server läuft auf <http://localhost:5173>.

## Stack

- **three.js** — 3D-Viewer und 2D-Ortho-Viewer
- **LSCM in Vanilla-JS** — Lévy et al. 2002, gelöst mit Preconditioned
  Conjugate Gradient direkt im Browser (kein WASM nötig)
- **meshoptimizer (WASM)** — QEC-Dezimierung
- **Vite** — Dev-Server und Build

## Workflow

1. **OBJ/STL laden** (Drag-and-Drop oder Button)
2. **Dezimieren** (optional, aber bei > 100 k Faces dringend empfohlen)
3. **Flächen erkennen** (empfohlen für scharfkantige Objekte)
   - Winkelschwellwert einstellen (default 25° passt für Fahrzeug/Möbel)
   - Button „Flächen erkennen" → Mesh wird nach Panels eingefärbt
   - „Auswahl-Modus" aktivieren, dann Panels anklicken:
     - **Klick**: einzelne Fläche auswählen
     - **Shift-Klick**: zur Auswahl hinzufügen
     - **Cmd/Ctrl-Klick**: aus Auswahl entfernen
   - „Seams aus Auswahl" → Ränder der Auswahl werden zu Schnittlinien
4. **Alternativ Seams manuell malen** (für runde Objekte ohne klare Panels)
5. **Schnitte anwenden** → Mesh wird entlang der Seams getrennt
6. **Grafik laden** (optional) → Bild aus aktueller Kamera-Sicht projizieren
7. **Abwickeln (LSCM)** → pro zusammenhängender Komponente eine eigene Bahn,
   nebeneinander angeordnet (Shelf-Packing, max. Breite 1500 mm)
8. **Verzerrungs-Heatmap** zeigt wo die Folie arbeiten muss
   - Grün: ≤ 5 % Flächenfehler — Folie verarbeitet das problemlos
   - Gelb: 5–15 % — typisches Wrap-Material schafft das mit Wärme
   - Rot: ≥ 20 % — Bahn muss geteilt werden
9. **SVG-Export** → Bahnen-Datei mit Schnittlinien, Nummern und Grafik als Raster
10. **Übersicht (PNG)** → 3D-Ansicht mit farbigen Komponenten + Nummern, damit
    beim Aufkleben klar ist welche Bahn wohin gehört

## Flächenerkennung — universell für alle Fälle

Der Algorithmus (Dihedral-Angle-Watershed) prüft für jede Kante den Knickwinkel
zwischen den beiden angrenzenden Faces. Alles über dem Schwellwert wird als
Panel-Grenze markiert, Flood-Fill trennt die Regionen.

- **Scharfkantige Objekte** (Fahrzeug, Möbel, Verpackung, Elektronik-Gehäuse):
  Schwellwert 20–35°, alle Panels sauber getrennt. Türen, Motorhaube, Kotflügel
  erkennt der Algorithmus zuverlässig einzeln.
- **Weich gerundete Objekte** (Helm, organische Formen): Schwellwert niedriger
  (5–15°), fängt leichte Krümmungswechsel ab. Bei komplett glatten Objekten
  (Kugel) findet er nur 1 Region — dann Seams manuell malen.
- **Min-Faces** filtert winzige Fragmente raus (default 50) — die werden in
  ihre größten Nachbarn absorbiert.

## Mathematische Grenze

Doppelt gekrümmte Flächen (z. B. Karosserie) sind nach Gauß'schem
Theorema Egregium **nicht** verzerrungsfrei abwickelbar. Das Tool zeigt
genau wo und wie stark verzerrt wird, damit Bahnen so geplant werden
können, dass die physische Folie die Restverzerrung wegarbeitet.

## Geplant

- PDF-Export mit Seitenumbruch bei großen Layouts
- ARAP-Verfeinerung für gemischte Anforderung an Winkel- und Flächentreue
- Grafik-Overlay mit präziser Position-/Rotation-/Skalierung-Steuerung über UI
- Region-Merge-Button (falls Auto-Erkennung zwei Panels als eins liest)
