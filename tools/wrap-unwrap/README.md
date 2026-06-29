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

1. OBJ/STL laden (Drag-and-Drop oder Button)
2. Mesh sollte mindestens einen offenen Rand haben (Loch / Schnitt).
   Geschlossene Meshes müssen vorher gesehnt werden (kommt später).
3. "Abwickeln (LSCM)" klicken — Pin-Vertices werden automatisch auf
   den größten Boundary-Loop gesetzt
4. Verzerrungs-Heatmap einschalten, um zu sehen wo die Folie arbeiten muss
   - Grün: ≤ 5 % Flächenfehler — Folie verarbeitet das problemlos
   - Gelb: 5–15 % — typisches Wrap-Material schafft das mit Wärme
   - Rot: ≥ 20 % — Bahn muss geteilt werden

## Mathematische Grenze

Doppelt gekrümmte Flächen (z. B. Karosserie) sind nach Gauß'schem
Theorema Egregium **nicht** verzerrungsfrei abwickelbar. Das Tool zeigt
genau wo und wie stark verzerrt wird, damit Bahnen so geplant werden
können, dass die physische Folie die Restverzerrung wegarbeitet.

## Geplant

- Seam-Painting auf dem Mesh, automatische Patch-Segmentierung
- SVG-Export 1:1 mit Bahnnummern und Passmarken
- Grafik-Overlay (Bild auf 3D-Surface projizieren, zur Abwicklung mitnehmen)
- ARAP-Verfeinerung für Bahnen mit gemischter Anforderung an Winkel- und Flächentreue
