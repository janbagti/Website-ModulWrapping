import * as THREE from 'three';

// Minimaler OBJ-Parser. Wir lesen nur 'v' und 'f' Zeilen. Negative Indizes
// werden unterstützt, Quads werden in zwei Dreiecke aufgelöst, Polygone
// per Fan-Triangulation. Alles andere ignoriert.
export function loadOBJ(text) {
  const positions = [];
  const indices = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];

    if (tag === 'v') {
      positions.push(
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3]),
      );
    } else if (tag === 'f') {
      const vCount = parts.length - 1;
      const verts = new Array(vCount);
      for (let j = 0; j < vCount; j++) {
        const tok = parts[j + 1];
        const slash = tok.indexOf('/');
        const vstr = slash < 0 ? tok : tok.slice(0, slash);
        let v = parseInt(vstr, 10);
        if (v < 0) v = positions.length / 3 + v;
        else v -= 1;
        verts[j] = v;
      }
      // fan triangulation
      for (let j = 1; j < vCount - 1; j++) {
        indices.push(verts[0], verts[j], verts[j + 1]);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}
