// SVG-Export der 2D-Abwicklung.
//
// Ausgabe: SVG mit width/height in mm und einem viewBox in Modell-Einheiten.
// 1 SVG-User-Unit = 1 Modell-Einheit, das ist bei Scans normalerweise 1 mm.
//
// Inhalt:
//  - Outer-Boundary jeder Komponente als geschlossener Pfad
//  - Optional: Triangulation als dünnes Wireframe (zum Verifizieren)
//  - Optional: Heatmap als gefüllte Triangel
//  - Passmarken: kleine Kreuze in 4 Ecken jeder Komponente, beschriftet

import { distortionToColor } from './flatten/distortion.js';

// Minimaler Pfad: Outer Boundary einer 2D-Triangulation.
// Eingabe: positions (Float32Array, [u,v,...]), index (Uint32Array).
// Ausgabe: array of arrays of vertex indices (eine Liste pro Boundary-Loop).
function extractBoundaryLoops2D(positions, index) {
  const vertexCount = positions.length / 2;
  const faceCount = index.length / 3;
  const edgeMap = new Map();
  for (let f = 0; f < faceCount; f++) {
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const lo = u < v ? u : v, hi = u < v ? v : u;
      const k = lo * vertexCount + hi;
      let e = edgeMap.get(k);
      if (!e) { e = { u: lo, v: hi, count: 0 }; edgeMap.set(k, e); }
      e.count++;
    }
  }
  const adj = new Map();
  for (const e of edgeMap.values()) {
    if (e.count !== 1) continue;
    if (!adj.has(e.u)) adj.set(e.u, []);
    if (!adj.has(e.v)) adj.set(e.v, []);
    adj.get(e.u).push(e.v);
    adj.get(e.v).push(e.u);
  }
  const loops = [];
  const visited = new Set();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const loop = [];
    let cur = start, prev = -1;
    let safety = adj.size + 2;
    while (safety-- > 0) {
      loop.push(cur);
      visited.add(cur);
      const nbs = adj.get(cur) || [];
      const next = nbs.find(n => n !== prev && !visited.has(n));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// Hauptfunktion. Liefert SVG-Text.
export function generateSVG({
  uv,            // Float32Array, 2 per vertex
  index,         // Uint32Array, 3 per face
  distortion,    // { perFace }  optional
  unit = 'mm',
  triangulation = false,
  heatmap = false,
  margin = 10,   // mm
  label = '',
}) {
  // Bounding box of UV.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < uv.length; i += 2) {
    if (uv[i] < minU) minU = uv[i]; if (uv[i] > maxU) maxU = uv[i];
    if (uv[i + 1] < minV) minV = uv[i + 1]; if (uv[i + 1] > maxV) maxV = uv[i + 1];
  }
  const w = maxU - minU;
  const h = maxV - minV;

  // Wir flippen Y für SVG (Y-Achse zeigt nach unten in SVG).
  const flipY = (v) => (maxV - v) + minV;

  const out = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1"`);
  out.push(`  width="${(w + margin * 2).toFixed(3)}${unit}"`);
  out.push(`  height="${(h + margin * 2).toFixed(3)}${unit}"`);
  out.push(`  viewBox="${(minU - margin).toFixed(3)} ${(minV - margin).toFixed(3)} ${(w + margin * 2).toFixed(3)} ${(h + margin * 2).toFixed(3)}">`);

  // Hintergrund-Rechteck als Schnittrahmen
  out.push(`  <rect x="${(minU - margin).toFixed(3)}" y="${(minV - margin).toFixed(3)}" width="${(w + margin * 2).toFixed(3)}" height="${(h + margin * 2).toFixed(3)}" fill="white" stroke="none"/>`);

  out.push(`  <g id="layout" transform="translate(0,${(minV + maxV).toFixed(3)}) scale(1,-1)">`);

  if (heatmap && distortion) {
    // Triangel als gefüllte Polygone in Distortion-Farben.
    out.push(`    <g id="heatmap" stroke="none">`);
    const c = { r: 0, g: 0, b: 0, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } };
    const faceCount = index.length / 3;
    for (let f = 0; f < faceCount; f++) {
      const a = index[f * 3], b = index[f * 3 + 1], d = index[f * 3 + 2];
      distortionToColor(distortion.perFace[f], c);
      const hex = '#' + [c.r, c.g, c.b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
      out.push(`      <polygon points="${uv[a*2].toFixed(3)},${uv[a*2+1].toFixed(3)} ${uv[b*2].toFixed(3)},${uv[b*2+1].toFixed(3)} ${uv[d*2].toFixed(3)},${uv[d*2+1].toFixed(3)}" fill="${hex}"/>`);
    }
    out.push(`    </g>`);
  }

  if (triangulation) {
    out.push(`    <g id="tri" stroke="#cccccc" stroke-width="0.15" fill="none">`);
    const faceCount = index.length / 3;
    for (let f = 0; f < faceCount; f++) {
      const a = index[f * 3], b = index[f * 3 + 1], d = index[f * 3 + 2];
      out.push(`      <polygon points="${uv[a*2].toFixed(3)},${uv[a*2+1].toFixed(3)} ${uv[b*2].toFixed(3)},${uv[b*2+1].toFixed(3)} ${uv[d*2].toFixed(3)},${uv[d*2+1].toFixed(3)}"/>`);
    }
    out.push(`    </g>`);
  }

  // Outer boundary loops as closed paths
  const loops = extractBoundaryLoops2D(uv, index);
  out.push(`    <g id="boundary" stroke="black" stroke-width="0.4" fill="none">`);
  for (const loop of loops) {
    const d = loop.map((vi, i) => `${i === 0 ? 'M' : 'L'} ${uv[vi*2].toFixed(3)},${uv[vi*2+1].toFixed(3)}`).join(' ') + ' Z';
    out.push(`      <path d="${d}"/>`);
  }
  out.push(`    </g>`);

  // Passmarken: kleine Kreuze in den 4 Ecken der Bounding-Box.
  out.push(`    <g id="regmarks" stroke="black" stroke-width="0.3" fill="none">`);
  const m = 5;
  for (const [cx, cy] of [[minU, minV], [maxU, minV], [maxU, maxV], [minU, maxV]]) {
    out.push(`      <line x1="${(cx - m).toFixed(3)}" y1="${cy.toFixed(3)}" x2="${(cx + m).toFixed(3)}" y2="${cy.toFixed(3)}"/>`);
    out.push(`      <line x1="${cx.toFixed(3)}" y1="${(cy - m).toFixed(3)}" x2="${cx.toFixed(3)}" y2="${(cy + m).toFixed(3)}"/>`);
  }
  out.push(`    </g>`);

  out.push(`  </g>`);

  // Beschriftung außerhalb des Layers, damit die Schrift normal orientiert ist.
  if (label) {
    out.push(`  <text x="${(minU - margin + 2).toFixed(3)}" y="${(maxV + margin - 2).toFixed(3)}"`);
    out.push(`    font-family="sans-serif" font-size="4" fill="black">${escapeXML(label)}</text>`);
  }
  // Maßstab-Hinweis
  out.push(`  <text x="${(maxU + margin - 30).toFixed(3)}" y="${(maxV + margin - 2).toFixed(3)}"`);
  out.push(`    font-family="sans-serif" font-size="3" fill="black">1:1 — ${w.toFixed(1)} × ${h.toFixed(1)} ${unit}</text>`);

  out.push(`</svg>`);
  return out.join('\n');
}

function escapeXML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Hilfsfunktion: Browser-Download auslösen.
export function downloadSVG(svgText, filename = 'abwicklung.svg') {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
