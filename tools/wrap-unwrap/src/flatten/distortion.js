import * as THREE from 'three';

// Pro Dreieck: relative Flächenänderung |A_2d - A_3d| / A_3d.
// Das ist ein konservatives Maß für Stretching/Stauchung, weil LSCM
// winkeltreu ist – Flächenfehler ist damit der relevante Indikator.
//
// Ergebnis ist global normalisiert auf den Median, sodass „Skalierungs-Bias"
// (LSCM-Lösungen können global skaliert sein) nicht den Heatmap dominiert.
export function computeDistortion(geometry, uv) {
  const positions = geometry.attributes.position.array;
  const index = geometry.index.array;
  const faceCount = index.length / 3;

  const perFace = new Float32Array(faceCount);
  const areas3D = new Float64Array(faceCount);
  const areas2D = new Float64Array(faceCount);

  let totalArea3D = 0;
  let totalArea2D = 0;

  for (let f = 0; f < faceCount; f++) {
    const i0 = index[f * 3], i1 = index[f * 3 + 1], i2 = index[f * 3 + 2];

    const ax = positions[i0 * 3],     ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3],     by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3],     cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const a3 = Math.hypot(nx, ny, nz) * 0.5;

    const u0 = uv[i0 * 2], v0 = uv[i0 * 2 + 1];
    const u1 = uv[i1 * 2], v1 = uv[i1 * 2 + 1];
    const u2 = uv[i2 * 2], v2 = uv[i2 * 2 + 1];
    const a2 = Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) * 0.5;

    areas3D[f] = a3;
    areas2D[f] = a2;
    totalArea3D += a3;
    totalArea2D += a2;
  }

  // Globaler Skalierungsfaktor: 2D-Fläche soll im Schnitt der 3D-Fläche entsprechen.
  // Schutz gegen totalArea==0 (degenerate Lösung) — Distortion wird dann 0
  // gelassen damit nichts NaN wird.
  const rawScale = totalArea3D > 0 ? totalArea2D / totalArea3D : 1;
  const globalScale = rawScale > 1e-30 ? rawScale : 1;

  let sum = 0, count = 0, maxV = 0;
  for (let f = 0; f < faceCount; f++) {
    if (areas3D[f] < 1e-14) { perFace[f] = 0; continue; }
    const scaledA2 = areas2D[f] / globalScale;
    const ratio = scaledA2 / areas3D[f];
    // Symmetrisches Maß: log(ratio) wäre formal sauber, hier reicht abs(ratio-1).
    const d = Math.abs(ratio - 1);
    perFace[f] = d;
    sum += d;
    count++;
    if (d > maxV) maxV = d;
  }

  const avg = count > 0 ? sum / count : 0;

  return {
    perFace,
    avg,
    max: maxV,
    globalScale,
  };
}

// Maps Verzerrungswert d in [0, ∞) auf eine Farbe.
// 0% -> grün, 5% -> gelbgrün, 10% -> gelb, 15% -> orange, ≥ 25% -> rot.
export function distortionToColor(d, out) {
  // Normalisieren auf [0,1] mit Cap bei 0.25.
  const t = Math.min(d / 0.25, 1);
  // 5-Stops linear: grün -> gelbgrün -> gelb -> orange -> rot.
  const stops = [
    [0.00, 0x00c853],
    [0.25, 0xb8d600],
    [0.50, 0xffd600],
    [0.75, 0xff8c00],
    [1.00, 0xff1744],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo = stops[i]; hi = stops[i + 1]; break;
    }
  }
  const span = hi[0] - lo[0];
  const localT = span > 0 ? (t - lo[0]) / span : 0;
  const cLo = lo[1], cHi = hi[1];
  const r = lerp((cLo >> 16) & 0xff, (cHi >> 16) & 0xff, localT) / 255;
  const g = lerp((cLo >> 8) & 0xff, (cHi >> 8) & 0xff, localT) / 255;
  const b = lerp(cLo & 0xff, cHi & 0xff, localT) / 255;
  out.setRGB(r, g, b);
}

function lerp(a, b, t) { return a + (b - a) * t; }
