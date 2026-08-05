// Mesh-Segmentierung nach Dihedral-Winkel-Watershed.
//
// Idee: Für jede Kante der Winkel zwischen den zwei angrenzenden Face-Normalen.
// Ist der Winkel > Schwellwert, gilt die Kante als "Crease" (Panel-Grenze).
// Flood-Fill zwischen den Nicht-Crease-Kanten → jede Region ist eine
// zusammenhängende glatte Fläche.
//
// Zusätzlich:
//  - Boundary-Kanten (die zu nur einer Face gehören) werden immer als Crease
//    behandelt — trennt automatisch getrennte Mesh-Teile.
//  - Kleine Regionen (< minRegionFaces) werden in ihren größten Nachbarn gemergt,
//    damit man nicht in tausenden Winzling-Fragmenten ertrinkt.
//
// Universell einsetzbar:
//  - Scharfkantig (Fahrzeug, Möbel): Schwellwert 20-35°, alle Panels sauber getrennt
//  - Weich gerundet (Helm, organisches Zeug): Schwellwert niedriger (5-15°)
//    detektiert leichte Krümmungswechsel. Bei komplett glatten Objekten (Kugel)
//    entsteht 1 Region — dann muss der User manuell Seams malen wie gehabt.

export function segmentMesh(positions, index, {
  angleThresholdDeg = 25,
  minRegionFaces = 20,
} = {}) {
  const faceCount = index.length / 3;
  const vertexCount = positions.length / 3;

  if (faceCount === 0) {
    return { regionOf: new Int32Array(0), regionCount: 0, creaseEdges: new Set() };
  }

  // 1) Face-Normalen
  const normals = new Float32Array(faceCount * 3);
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
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-14) {
      normals[f * 3]     = nx / len;
      normals[f * 3 + 1] = ny / len;
      normals[f * 3 + 2] = nz / len;
    }
  }

  // 2) Edge-Map: key -> {faces: [f1, f2]} + key-string erhalten
  const edgeMap = new Map();
  const addEdge = (a, b, f) => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * vertexCount + hi;
    let e = edgeMap.get(key);
    if (!e) { e = { lo, hi, faces: [] }; edgeMap.set(key, e); }
    e.faces.push(f);
  };
  for (let f = 0; f < faceCount; f++) {
    addEdge(index[f * 3],     index[f * 3 + 1], f);
    addEdge(index[f * 3 + 1], index[f * 3 + 2], f);
    addEdge(index[f * 3 + 2], index[f * 3],     f);
  }

  // 3) Crease-Kanten identifizieren
  const cosThreshold = Math.cos(angleThresholdDeg * Math.PI / 180);
  const creaseEdges = new Set(); // string "lo|hi"

  // 4) Face-Adjazenz nur über NICHT-Crease-Kanten
  const adj = new Array(faceCount);
  for (let f = 0; f < faceCount; f++) adj[f] = [];

  for (const e of edgeMap.values()) {
    if (e.faces.length !== 2) {
      // Boundary oder non-manifold → immer Crease (öffnet die Region-Grenze)
      creaseEdges.add(e.lo + '|' + e.hi);
      continue;
    }
    const f1 = e.faces[0], f2 = e.faces[1];
    const cosAngle =
      normals[f1 * 3]     * normals[f2 * 3] +
      normals[f1 * 3 + 1] * normals[f2 * 3 + 1] +
      normals[f1 * 3 + 2] * normals[f2 * 3 + 2];
    if (cosAngle < cosThreshold) {
      creaseEdges.add(e.lo + '|' + e.hi);
    } else {
      adj[f1].push(f2);
      adj[f2].push(f1);
    }
  }

  // 5) Region-Flood-Fill (BFS)
  const regionOf = new Int32Array(faceCount).fill(-1);
  let regionCount = 0;
  const queue = new Int32Array(faceCount);
  for (let start = 0; start < faceCount; start++) {
    if (regionOf[start] !== -1) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    regionOf[start] = regionCount;
    while (head < tail) {
      const f = queue[head++];
      for (const nf of adj[f]) {
        if (regionOf[nf] === -1) {
          regionOf[nf] = regionCount;
          queue[tail++] = nf;
        }
      }
    }
    regionCount++;
  }

  // 6) Kleine Regionen mergen (min-size filter)
  //    Berechne pro Region die Face-Anzahl und die Nachbar-Regionen.
  //    Zu kleine Regionen → in den größten Nachbarn absorbieren.
  const merged = mergeSmallRegions(regionOf, adj, edgeMap, creaseEdges, minRegionFaces);

  return {
    regionOf: merged.regionOf,
    regionCount: merged.regionCount,
    creaseEdges: merged.creaseEdges,
    normals,
  };
}

function mergeSmallRegions(regionOf, adj, edgeMap, creaseEdges, minSize) {
  const faceCount = regionOf.length;

  // Region-Größen
  let count = 0;
  for (let i = 0; i < regionOf.length; i++) if (regionOf[i] > count) count = regionOf[i];
  count++;
  const sizes = new Int32Array(count);
  for (let f = 0; f < faceCount; f++) sizes[regionOf[f]]++;

  // Region-Nachbarschaft: Map region -> Map(neighborRegion -> sharedEdgeCount)
  const regionNeighbors = new Array(count);
  for (let i = 0; i < count; i++) regionNeighbors[i] = new Map();

  // Wir müssen wissen welche Regionen sich (über Crease-Kanten) Nachbarn sind.
  // Iteration über edgeMap: für jede 2-Face-Kante, wenn die zwei Regionen
  // verschieden sind, sind sie Nachbarn.
  for (const e of edgeMap.values()) {
    if (e.faces.length !== 2) continue;
    const r1 = regionOf[e.faces[0]];
    const r2 = regionOf[e.faces[1]];
    if (r1 === r2) continue;
    incrementInMap(regionNeighbors[r1], r2);
    incrementInMap(regionNeighbors[r2], r1);
  }

  // Union-Find über Regionen
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i, j) => {
    const ri = find(i), rj = find(j);
    if (ri !== rj) {
      // In den größeren mergen
      if (sizes[ri] < sizes[rj]) { parent[ri] = rj; sizes[rj] += sizes[ri]; sizes[ri] = 0; }
      else                        { parent[rj] = ri; sizes[ri] += sizes[rj]; sizes[rj] = 0; }
    }
  };

  // Wiederhole bis stabil: kleinste zu-kleine Region → in größten Nachbarn.
  // Simpler Ansatz: einmal drüber, jede kleine Region absorbiert.
  let changed = true;
  const MAX_PASSES = 20;
  for (let pass = 0; changed && pass < MAX_PASSES; pass++) {
    changed = false;
    for (let r = 0; r < count; r++) {
      if (find(r) !== r) continue; // schon absorbiert
      if (sizes[r] >= minSize || sizes[r] === 0) continue;
      // Größten Nachbarn finden — via aktuelle Roots
      const nbrs = regionNeighbors[r];
      if (nbrs.size === 0) continue; // isolierte Region — leider nichts zu mergen
      let bestNbr = -1, bestSize = -1;
      for (const [n] of nbrs) {
        const rn = find(n);
        if (rn === find(r)) continue;
        if (sizes[rn] > bestSize) { bestSize = sizes[rn]; bestNbr = rn; }
      }
      if (bestNbr < 0) continue;
      union(r, bestNbr);
      changed = true;
    }
  }

  // Neue Region-IDs kompakt vergeben
  const oldToNew = new Int32Array(count).fill(-1);
  let newCount = 0;
  for (let i = 0; i < count; i++) {
    const root = find(i);
    if (oldToNew[root] === -1) oldToNew[root] = newCount++;
  }
  const newRegionOf = new Int32Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    newRegionOf[f] = oldToNew[find(regionOf[f])];
  }

  // Crease-Kanten neu berechnen: nur die Kanten die noch verschiedene Regionen
  // trennen, bleiben Creases.
  const newCrease = new Set();
  for (const e of edgeMap.values()) {
    if (e.faces.length !== 2) {
      newCrease.add(e.lo + '|' + e.hi);
      continue;
    }
    const r1 = newRegionOf[e.faces[0]];
    const r2 = newRegionOf[e.faces[1]];
    if (r1 !== r2) newCrease.add(e.lo + '|' + e.hi);
  }

  return { regionOf: newRegionOf, regionCount: newCount, creaseEdges: newCrease };
}

function incrementInMap(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

// Aus einer Menge selektierter Regionen die Seam-Kanten ableiten:
// alle Kanten wo eine adjacent-Face IN und die andere NICHT IN der Auswahl ist.
// Zusätzlich: bereits vorhandene Boundary-Kanten am Rand der Auswahl auch mitnehmen.
export function seamsFromSelection(index, positions, regionOf, selectedRegions) {
  const vertexCount = positions.length / 3;
  const faceCount = index.length / 3;

  const inSel = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    if (selectedRegions.has(regionOf[f])) inSel[f] = 1;
  }

  const edgeMap = new Map();
  const addEdge = (a, b, f) => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * vertexCount + hi;
    let e = edgeMap.get(key);
    if (!e) { e = { lo, hi, faces: [] }; edgeMap.set(key, e); }
    e.faces.push(f);
  };
  for (let f = 0; f < faceCount; f++) {
    addEdge(index[f * 3],     index[f * 3 + 1], f);
    addEdge(index[f * 3 + 1], index[f * 3 + 2], f);
    addEdge(index[f * 3 + 2], index[f * 3],     f);
  }

  const seams = new Set();
  for (const e of edgeMap.values()) {
    if (e.faces.length !== 2) continue;
    const a = inSel[e.faces[0]], b = inSel[e.faces[1]];
    if (a !== b) seams.add(e.lo + '|' + e.hi);
  }
  return seams;
}
