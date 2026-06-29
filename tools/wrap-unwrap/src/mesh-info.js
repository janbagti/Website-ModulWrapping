import * as THREE from 'three';

// Berechnet Bounding-Box, Halbkanten-Topologie und Boundary-Loops.
// LSCM braucht die Boundary, um zwei Pin-Vertices zu wählen.
export function buildMeshInfo(geometry) {
  const positions = geometry.attributes.position.array;
  const index = geometry.index?.array;

  if (!index) {
    throw new Error('Mesh hat keinen Index – Loader sollte das vor LSCM lösen.');
  }

  const vertexCount = positions.length / 3;
  const faceCount = index.length / 3;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const boundingSize = new THREE.Vector3();
  bb.getSize(boundingSize);

  // Edge -> faces: schlüssel "min|max"
  const edgeMap = new Map();
  for (let f = 0; f < faceCount; f++) {
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    const tri = [[a, b], [b, c], [c, a]];
    for (const [u, v] of tri) {
      const lo = u < v ? u : v;
      const hi = u < v ? v : u;
      const key = lo * vertexCount + hi;
      let entry = edgeMap.get(key);
      if (!entry) { entry = { u: lo, v: hi, count: 0 }; edgeMap.set(key, entry); }
      entry.count++;
    }
  }

  // Boundary-Kanten: nur einmal vorkommend.
  const boundaryAdj = new Map(); // vertex -> Set(neighbor on boundary)
  for (const e of edgeMap.values()) {
    if (e.count === 1) {
      if (!boundaryAdj.has(e.u)) boundaryAdj.set(e.u, []);
      if (!boundaryAdj.has(e.v)) boundaryAdj.set(e.v, []);
      boundaryAdj.get(e.u).push(e.v);
      boundaryAdj.get(e.v).push(e.u);
    }
  }

  // Loops extrahieren.
  const boundaryLoops = [];
  const visited = new Set();
  for (const start of boundaryAdj.keys()) {
    if (visited.has(start)) continue;
    const loop = [];
    let cur = start, prev = -1;
    let safety = boundaryAdj.size + 2;
    while (safety-- > 0) {
      loop.push(cur);
      visited.add(cur);
      const nbs = boundaryAdj.get(cur) || [];
      const next = nbs.find(n => n !== prev && !visited.has(n));
      if (next === undefined) {
        const close = nbs.find(n => n === start);
        if (close !== undefined && loop.length > 2) {
          // closed loop
        }
        break;
      }
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) boundaryLoops.push(loop);
  }

  // Größten Loop zuerst – das ist üblicherweise der äußere Rand.
  boundaryLoops.sort((a, b) => b.length - a.length);

  return {
    vertexCount,
    faceCount,
    boundingBox: bb,
    boundingSize,
    boundaryLoops,
  };
}
