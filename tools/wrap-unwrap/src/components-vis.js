import * as THREE from 'three';

// Visualisierungs-Helpers für Multi-Komponenten-Ergebnisse.
//
// - Farbe pro Komponente nach Goldener-Winkel-Rotation -> immer gut unterscheidbar
// - Label-Sprites mit Bahnnummern für 3D-View
// - Optional dezenter Komponenten-Tint, damit man die Nahtgrenzen sieht

const HUE_STEP = 137.5;          // golden angle in degrees
const SAT = 0.55;
const LIGHT = 0.55;

// HSL -> RGB (0..1)
export function componentColor(i, out = new THREE.Color()) {
  const h = ((i * HUE_STEP) % 360) / 360;
  return out.setHSL(h, SAT, LIGHT);
}

// Per-vertex color array, gefärbt nach Komponenten-Zuordnung.
export function buildVertexColorsFromComponents(geometry, componentOf, count, opacity = 1) {
  const index = geometry.index.array;
  const vertexCount = geometry.attributes.position.count;
  const faceCount = index.length / 3;
  const colors = new Float32Array(vertexCount * 3);
  // Vertices erben die Komponentenfarbe der Faces, denen sie angehören.
  // Nach dem Cut gehört jeder Vertex zu genau einer Komponente,
  // also reicht eine einzige Zuweisung.
  const c = new THREE.Color();
  for (let f = 0; f < faceCount; f++) {
    componentColor(componentOf[f], c);
    for (let k = 0; k < 3; k++) {
      const v = index[f * 3 + k];
      colors[v * 3]     = c.r * opacity + (1 - opacity);
      colors[v * 3 + 1] = c.g * opacity + (1 - opacity);
      colors[v * 3 + 2] = c.b * opacity + (1 - opacity);
    }
  }
  return colors;
}

// Canvas-basierte Texture mit großer Zahl, die als Sprite gerendert wird.
export function makeNumberSprite(number, { sizePx = 128, bgColor = '#ffffff', textColor = '#000000' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, sizePx, sizePx);

  // Runder Hintergrund
  ctx.beginPath();
  ctx.arc(sizePx / 2, sizePx / 2, sizePx * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.lineWidth = sizePx * 0.05;
  ctx.strokeStyle = textColor;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = `bold ${Math.floor(sizePx * 0.55)}px Archivo Black, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), sizePx / 2, sizePx / 2 + sizePx * 0.03);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  return sprite;
}

// 3D-Centroid einer Komponente (Mittel der Face-Mittelpunkte, gewichtet mit Face-Area).
export function compute3DCentroid(geometry, componentOf, componentIdx) {
  const positions = geometry.attributes.position.array;
  const index = geometry.index.array;
  const faceCount = index.length / 3;
  let cx = 0, cy = 0, cz = 0, totalA = 0;
  for (let f = 0; f < faceCount; f++) {
    if (componentOf[f] !== componentIdx) continue;
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx0 = positions[c * 3], cy0 = positions[c * 3 + 1], cz0 = positions[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx0 - ax, e2y = cy0 - ay, e2z = cz0 - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const A = Math.hypot(nx, ny, nz) * 0.5;
    const mx = (ax + bx + cx0) / 3;
    const my = (ay + by + cy0) / 3;
    const mz = (az + bz + cz0) / 3;
    cx += mx * A; cy += my * A; cz += mz * A;
    totalA += A;
  }
  if (totalA < 1e-14) return new THREE.Vector3();
  return new THREE.Vector3(cx / totalA, cy / totalA, cz / totalA);
}

// 2D-Centroid (UV-Centroid) einer Komponente.
export function compute2DCentroid(uv, index, componentOf, componentIdx) {
  const faceCount = index.length / 3;
  let cu = 0, cv = 0, totalA = 0;
  for (let f = 0; f < faceCount; f++) {
    if (componentOf[f] !== componentIdx) continue;
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    const au = uv[a * 2], av = uv[a * 2 + 1];
    const bu = uv[b * 2], bv = uv[b * 2 + 1];
    const cu0 = uv[c * 2], cv0 = uv[c * 2 + 1];
    const A = Math.abs((bu - au) * (cv0 - av) - (cu0 - au) * (bv - av)) * 0.5;
    cu += ((au + bu + cu0) / 3) * A;
    cv += ((av + bv + cv0) / 3) * A;
    totalA += A;
  }
  if (totalA < 1e-14) return { u: 0, v: 0 };
  return { u: cu / totalA, v: cv / totalA };
}
