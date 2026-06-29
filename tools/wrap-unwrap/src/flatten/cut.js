// Mesh-Cutting entlang Seams.
//
// Eingabe: positions (Float32Array, [x,y,z,x,y,z,...]), index (Uint32Array,
// 3 pro Face), seamEdges (Set<string> mit Schlüssel "lo|hi" wobei lo < hi).
//
// Ausgabe: { positions, index } mit zusätzlichen Vertex-Kopien an Seams,
// sodass jede Seam-Kante zur Boundary wird.
//
// Algorithmus pro Vertex v:
//   1. Sammle alle inzidenten Faces.
//   2. Verbinde zwei Faces, wenn sie sich eine *Nicht-Seam-Kante* an v teilen.
//   3. Die Zusammenhangskomponenten = "Wedges". Jeder Wedge nach dem ersten
//      bekommt einen neuen Vertex-Kopie.
//
// O(F * avg_valence) ≈ O(F) für gute Meshes.

export function cutMeshAlongSeams(positions, index, seamEdges) {
  const vertexCount = positions.length / 3;
  const faceCount = index.length / 3;

  // Pro Vertex: Liste der inzidenten {face, corner}.
  const incident = new Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) incident[v] = [];
  for (let f = 0; f < faceCount; f++) {
    incident[index[f * 3]].push({ face: f, corner: 0 });
    incident[index[f * 3 + 1]].push({ face: f, corner: 1 });
    incident[index[f * 3 + 2]].push({ face: f, corner: 2 });
  }

  const newIndex = new Uint32Array(index);
  const newPositions = Array.from(positions);
  let nextV = vertexCount;

  // Wiederverwendete Hilfs-Strukturen pro Vertex.
  for (let v = 0; v < vertexCount; v++) {
    const faces = incident[v];
    if (faces.length <= 1) continue;

    // edgeToFaces: w (Nachbar von v über Nicht-Seam-Kante) -> [Indizes in faces[]]
    const edgeToFaces = new Map();
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i].face;
      const c = faces[i].corner;
      const w1 = newIndex[f * 3 + (c + 1) % 3];
      const w2 = newIndex[f * 3 + (c + 2) % 3];
      for (const w of [w1, w2]) {
        if (w === v) continue; // Degenerated triangle guard.
        const lo = v < w ? v : w;
        const hi = v < w ? w : v;
        if (seamEdges.has(lo + '|' + hi)) continue;
        let arr = edgeToFaces.get(w);
        if (!arr) { arr = []; edgeToFaces.set(w, arr); }
        arr.push(i);
      }
    }

    // Union-Find über Face-Indizes innerhalb dieses Vertex-Sterns.
    const parent = new Int32Array(faces.length);
    for (let i = 0; i < faces.length; i++) parent[i] = i;
    const find = (i) => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    const union = (i, j) => {
      const ri = find(i), rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    };
    for (const arr of edgeToFaces.values()) {
      for (let k = 1; k < arr.length; k++) union(arr[0], arr[k]);
    }

    // Gruppen sammeln.
    const groupOfRoot = new Map(); // root -> array of face slots
    for (let i = 0; i < faces.length; i++) {
      const r = find(i);
      let g = groupOfRoot.get(r);
      if (!g) { g = []; groupOfRoot.set(r, g); }
      g.push(i);
    }

    if (groupOfRoot.size <= 1) continue; // Kein Split nötig.

    // Erste Gruppe behält v, alle weiteren bekommen eine Kopie.
    let isFirst = true;
    for (const grp of groupOfRoot.values()) {
      if (isFirst) { isFirst = false; continue; }
      const newV = nextV++;
      const px = positions[v * 3];
      const py = positions[v * 3 + 1];
      const pz = positions[v * 3 + 2];
      newPositions.push(px, py, pz);
      for (const slot of grp) {
        const { face, corner } = faces[slot];
        newIndex[face * 3 + corner] = newV;
      }
    }
  }

  return {
    positions: new Float32Array(newPositions),
    index: newIndex,
  };
}

// Zusammenhangskomponenten: BFS über Face-Adjazenz (Faces teilen sich Kante).
// Liefert { componentOf: Int32Array(faceCount), count }.
export function findConnectedComponents(positions, index) {
  const vertexCount = positions.length / 3;
  const faceCount = index.length / 3;

  // Edge -> [faces].
  const edgeMap = new Map();
  const pushEdge = (a, b, f) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * vertexCount + hi;
    let arr = edgeMap.get(key);
    if (!arr) { arr = []; edgeMap.set(key, arr); }
    arr.push(f);
  };
  for (let f = 0; f < faceCount; f++) {
    pushEdge(index[f * 3],     index[f * 3 + 1], f);
    pushEdge(index[f * 3 + 1], index[f * 3 + 2], f);
    pushEdge(index[f * 3 + 2], index[f * 3],     f);
  }

  // Face-Adjazenz aus shared edges.
  const adj = new Array(faceCount);
  for (let f = 0; f < faceCount; f++) adj[f] = [];
  for (const arr of edgeMap.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        adj[arr[i]].push(arr[j]);
        adj[arr[j]].push(arr[i]);
      }
    }
  }

  const componentOf = new Int32Array(faceCount).fill(-1);
  let count = 0;
  const queue = new Int32Array(faceCount);
  for (let start = 0; start < faceCount; start++) {
    if (componentOf[start] !== -1) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    componentOf[start] = count;
    while (head < tail) {
      const f = queue[head++];
      for (const nf of adj[f]) {
        if (componentOf[nf] === -1) {
          componentOf[nf] = count;
          queue[tail++] = nf;
        }
      }
    }
    count++;
  }
  return { componentOf, count };
}

// Eingabe-Mesh + Komponenten-Zuordnung -> separate Submeshes pro Komponente.
// Jeder Submesh hat sein eigenes positions[] (Vertices remappt).
export function splitByComponents(positions, index, componentOf, componentCount) {
  const faceCount = index.length / 3;
  const out = [];
  for (let c = 0; c < componentCount; c++) {
    out.push({ positions: [], index: [], oldToNew: new Map(), originalFaces: [] });
  }
  for (let f = 0; f < faceCount; f++) {
    const c = componentOf[f];
    const comp = out[c];
    const a = index[f * 3], b = index[f * 3 + 1], d = index[f * 3 + 2];
    const remap = (vi) => {
      let nv = comp.oldToNew.get(vi);
      if (nv === undefined) {
        nv = comp.positions.length / 3;
        comp.positions.push(
          positions[vi * 3],
          positions[vi * 3 + 1],
          positions[vi * 3 + 2],
        );
        comp.oldToNew.set(vi, nv);
      }
      return nv;
    };
    comp.index.push(remap(a), remap(b), remap(d));
    comp.originalFaces.push(f);
  }
  return out.map(c => ({
    positions: new Float32Array(c.positions),
    index: new Uint32Array(c.index),
    oldToNew: c.oldToNew,
    originalFaces: c.originalFaces,
  }));
}
