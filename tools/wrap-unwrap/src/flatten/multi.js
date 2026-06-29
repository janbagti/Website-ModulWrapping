import * as THREE from 'three';
import { findConnectedComponents, splitByComponents } from './cut.js';
import { flattenLSCM } from './lscm.js';
import { computeDistortion } from './distortion.js';
import { buildMeshInfo } from '../mesh-info.js';
import { shelfPack } from './layout.js';

// Multi-Komponenten-Abwicklung.
//
// Geometrie -> Komponenten-Erkennung -> pro Komponente LSCM ->
// Bin-Packing der 2D-Bboxen -> kombinierte UV-Karte über alle Vertices.
//
// Ergebnis:
//   {
//     ok: bool,
//     uv: Float32Array(2 * vertexCount)     // im globalen Layout-Space
//     componentOf: Int32Array(faceCount)    // 0-basiert
//     components: [{
//       number: 1-basiert,
//       faces: number[],                     // Original-Face-Indizes
//       vertices: number[],                  // Original-Vertex-Indizes
//       bbox: {minU, minV, maxU, maxV},
//       offset: {x, y},
//       iterations, residual,
//       distortion: { perFace, avg, max }   // global indices, only this component's faces filled
//     }],
//     distortion: { perFace, avg, max }     // aggregated over all faces
//   }
export function flattenAllComponents(geometry, { maxLayoutWidth = 1500, padding = 20 } = {}) {
  const positions = geometry.attributes.position.array;
  const index = geometry.index.array;
  const vertexCount = positions.length / 3;
  const faceCount = index.length / 3;

  const { componentOf, count } = findConnectedComponents(positions, index);

  if (count === 0) {
    return { ok: false, error: 'Leeres Mesh.' };
  }

  const subs = splitByComponents(positions, index, componentOf, count);

  // LSCM pro Komponente.
  const subFlat = new Array(count);
  for (let c = 0; c < count; c++) {
    const sub = subs[c];
    const subGeo = new THREE.BufferGeometry();
    subGeo.setAttribute('position', new THREE.Float32BufferAttribute(sub.positions, 3));
    subGeo.setIndex(new THREE.BufferAttribute(sub.index.slice(), 1));
    const subInfo = buildMeshInfo(subGeo);
    if (subInfo.boundaryLoops.length === 0) {
      return {
        ok: false,
        error: `Komponente ${c + 1} ist geschlossen — bitte Schnittlinien setzen.`,
      };
    }
    const r = flattenLSCM(subGeo, subInfo);
    if (!r.ok) return { ok: false, error: `Komponente ${c + 1}: ${r.error}` };
    subFlat[c] = { sub, uv: r.uv, iterations: r.iterations, residual: r.residual, subGeo, subInfo };
  }

  // 2D-Bboxen + Normalisierung auf (0,0)-Origin.
  const boxes = [];
  for (let c = 0; c < count; c++) {
    const uv = subFlat[c].uv;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.length; i += 2) {
      if (uv[i] < minU) minU = uv[i]; if (uv[i] > maxU) maxU = uv[i];
      if (uv[i + 1] < minV) minV = uv[i + 1]; if (uv[i + 1] > maxV) maxV = uv[i + 1];
    }
    // Shift this component's UVs so its bbox starts at (0,0).
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] -= minU;
      uv[i + 1] -= minV;
    }
    subFlat[c].localBBox = { minU: 0, minV: 0, maxU: maxU - minU, maxV: maxV - minV };
    boxes.push({ w: maxU - minU, h: maxV - minV });
  }

  // Bin-Pack.
  const offsets = shelfPack(boxes, { maxWidth: maxLayoutWidth, padding });

  // Global UV-Array.
  const uvOut = new Float32Array(vertexCount * 2);
  // Pro Vertex: welcher Komponente gehört er? Aus oldToNew der splitByComponents.
  // Wir invertieren oldToNew zu newToOld implizit, indem wir über die Map iterieren.
  for (let c = 0; c < count; c++) {
    const sub = subFlat[c].sub;
    const subUV = subFlat[c].uv;
    const off = offsets[c];
    for (const [origIdx, newIdx] of sub.oldToNew) {
      uvOut[origIdx * 2]     = subUV[newIdx * 2] + off.x;
      uvOut[origIdx * 2 + 1] = subUV[newIdx * 2 + 1] + off.y;
    }
    subFlat[c].offset = off;
  }

  // Distortion über alle Faces (global indices).
  const dist = computeDistortion(geometry, uvOut);

  // Komponenten-Metadaten.
  const compMeta = [];
  for (let c = 0; c < count; c++) {
    const sub = subFlat[c].sub;
    const faces = sub.originalFaces.slice();
    const vertSet = new Set();
    for (const f of faces) {
      vertSet.add(index[f * 3]);
      vertSet.add(index[f * 3 + 1]);
      vertSet.add(index[f * 3 + 2]);
    }
    const vertices = Array.from(vertSet);
    const off = subFlat[c].offset;
    const lb = subFlat[c].localBBox;
    compMeta.push({
      number: c + 1,
      faces,
      vertices,
      bbox: { minU: off.x, minV: off.y, maxU: off.x + lb.maxU, maxV: off.y + lb.maxV },
      offset: off,
      iterations: subFlat[c].iterations,
      residual: subFlat[c].residual,
    });
  }

  return {
    ok: true,
    uv: uvOut,
    componentOf,
    componentCount: count,
    components: compMeta,
    distortion: dist,
  };
}
