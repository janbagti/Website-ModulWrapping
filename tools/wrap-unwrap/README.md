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
- **Vite** — Dev-Server und Build

## Workflow

1. **OBJ/STL laden** (Drag-and-Drop oder Button)
2. **Dezimieren** (optional, aber bei > 100 k Faces dringend empfohlen)
   → Ziel-Faces in der Seitenleiste eingeben, Button drücken.
   meshoptimizer macht QEC mit Topologie-Erhaltung in ~1 s pro 100 k Faces.
3. **Seams malen** → auf Kanten klicken um eine durchgehende Schnitt-Linie zu zeichnen
4. **Schnitte anwenden** → Mesh wird entlang der Seams getrennt, Bahnen entstehen
4. **Grafik laden** (optional) → Bild auf den Scan projizieren aus aktueller Ansicht
6. **Abwickeln (LSCM)** → pro zusammenhängender Komponente eine eigene Bahn,
   nebeneinander angeordnet (Shelf-Packing, max. Breite 1500 mm)
7. **Verzerrungs-Heatmap** zeigt wo die Folie arbeiten muss
   - Grün: ≤ 5 % Flächenfehler — Folie verarbeitet das problemlos
   - Gelb: 5–15 % — typisches Wrap-Material schafft das mit Wärme
   - Rot: ≥ 20 % — Bahn muss geteilt werden
8. **Grafik laden** (optional) → Bild aus aktueller Kamera-Sicht projizieren
9. **SVG-Export** → Bahnen-Datei mit Schnittlinien, Nummern und Grafik als Raster
10. **Übersicht (PNG)** → 3D-Ansicht mit farbigen Komponenten + Nummern, damit
    beim Aufkleben klar ist welche Bahn wohin gehört

## Mathematische Grenze

Doppelt gekrümmte Flächen (z. B. Karosserie) sind nach Gauß'schem
Theorema Egregium **nicht** verzerrungsfrei abwickelbar. Das Tool zeigt
genau wo und wie stark verzerrt wird, damit Bahnen so geplant werden
können, dass die physische Folie die Restverzerrung wegarbeitet.

## Geplant

- Automatische Patch-Segmentierung (Cluster nach Krümmung)
- PDF-Export mit Seitenumbruch bei großen Layouts
- ARAP-Verfeinerung für gemischte Anforderung an Winkel- und Flächentreue
- Grafik-Overlay mit präziser Position-/Rotation-/Skalierung-Steuerung über UI
