import * as THREE from 'three';

// STL Loader (binary + ASCII). STL hat keine geteilten Vertices, daher
// werden diese hier deduped per Hash, damit das Mesh anschließend ein
// echtes Halbkanten-Netz bildet (das braucht LSCM).
export function loadSTL(buffer) {
  const isBinary = detectBinary(buffer);
  return isBinary ? parseBinary(buffer) : parseASCII(new TextDecoder().decode(buffer));
}

function detectBinary(buffer) {
  if (buffer.byteLength < 84) return false;

  // 1) Trianglezähler aus dem Header lesen und plausibel prüfen.
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  if (triCount > 0 && triCount < 50_000_000) {
    const expected = 84 + triCount * 50;
    // Permissiv: Größe muss mindestens die Daten enthalten und darf
    // bis zu 1 KB Padding/Müll am Ende haben. Viele Writer hängen
    // sowas an (NULL, CR/LF, Markierungen).
    if (buffer.byteLength >= expected && buffer.byteLength <= expected + 1024) {
      return true;
    }
    if (buffer.byteLength === expected) return true;
  }

  // 2) Fallback: ASCII-STL fängt mit "solid " an und enthält im
  //    Header nur druckbare Zeichen. Binär hat dort fast immer
  //    Null-Bytes oder Steuerzeichen.
  const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 256));
  let nonPrintable = 0;
  for (let i = 0; i < head.length; i++) {
    const b = head[i];
    if (b === 0 || (b > 0 && b < 9) || (b > 13 && b < 32) || b > 127) {
      nonPrintable++;
    }
  }
  return nonPrintable > 10;
}

function parseBinary(buffer) {
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  let p = 0;
  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    offset += 12; // normal
    for (let v = 0; v < 3; v++) {
      positions[p++] = view.getFloat32(offset, true);
      positions[p++] = view.getFloat32(offset + 4, true);
      positions[p++] = view.getFloat32(offset + 8, true);
      offset += 12;
    }
    offset += 2; // attribute byte count
  }
  return finalize(positions);
}

function parseASCII(text) {
  const positions = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    positions.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  return finalize(new Float32Array(positions));
}

function finalize(positions) {
  // Vertices deduplizieren über Hash-Quantisierung.
  const triCount = positions.length / 9;
  const map = new Map();
  const dedupedPos = [];
  const indices = new Uint32Array(triCount * 3);

  // Quantisierungsgrid für Hashing: ~1e-6 der Mesh-Diagonale.
  const bbox = computeBoundsForArray(positions);
  const diag = Math.hypot(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  );
  const eps = Math.max(diag * 1e-6, 1e-9);
  const inv = 1 / eps;

  let nextIdx = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const key =
      Math.round(x * inv) + '|' +
      Math.round(y * inv) + '|' +
      Math.round(z * inv);
    let idx = map.get(key);
    if (idx === undefined) {
      idx = nextIdx++;
      map.set(key, idx);
      dedupedPos.push(x, y, z);
    }
    indices[i / 3] = idx;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(dedupedPos, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function computeBoundsForArray(arr) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) {
    if (arr[i] < min[0]) min[0] = arr[i];
    if (arr[i + 1] < min[1]) min[1] = arr[i + 1];
    if (arr[i + 2] < min[2]) min[2] = arr[i + 2];
    if (arr[i] > max[0]) max[0] = arr[i];
    if (arr[i + 1] > max[1]) max[1] = arr[i + 1];
    if (arr[i + 2] > max[2]) max[2] = arr[i + 2];
  }
  return { min, max };
}
