import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

// QEC-Dezimierung via meshoptimizer.
//
// Eingabe: BufferGeometry, ZielFaces
// Ausgabe: neue BufferGeometry mit der gewünschten Face-Anzahl (oder weniger,
//          wenn die Topologie nicht weiter vereinfachbar ist).
//
// targetError ist relativ zur Mesh-Diagonale (0..1). 0.01 = 1% — typisch
// gut, fast unsichtbarer Detailverlust. 0.05 ist aggressiver. 0 zwingt
// die Bibliothek nur durch Topologie zu stoppen.
export async function decimateMesh(geometry, targetFaceCount, {
  targetError = 0.05,
  preserveBorder = false,
} = {}) {
  await MeshoptSimplifier.ready;

  const positions = geometry.attributes.position.array;
  const indices = geometry.index.array;
  const stride = 3;
  const vertexCount = positions.length / 3;
  const faceCount = indices.length / 3;

  if (targetFaceCount >= faceCount) {
    // Nichts zu tun.
    return geometry;
  }

  // meshoptimizer arbeitet mit Uint32Array für Indizes.
  const srcIndices = indices instanceof Uint32Array
    ? indices
    : new Uint32Array(indices);

  // Position-Array als plain Float32Array übergeben (meshoptimizer kann
  // mit dem Float32BufferAttribute-array direkt).
  const srcPositions = positions instanceof Float32Array
    ? positions
    : new Float32Array(positions);

  const flags = [];
  if (preserveBorder) flags.push('LockBorder');
  // Prune entfernt isolierte Tri-Cluster — meistens sinnvoll bei Scans.
  flags.push('Prune');

  const targetIndexCount = targetFaceCount * 3;

  const [newIndices, error] = MeshoptSimplifier.simplify(
    srcIndices,
    srcPositions,
    stride,
    targetIndexCount,
    targetError,
    flags,
  );

  // Vertex-Array compactieren: nur die noch verwendeten Vertices behalten.
  const [remap, newVertexCount] = MeshoptSimplifier.compactMesh(newIndices);

  // remap[oldIdx] = newIdx (oder 0xffffffff für ungenutzt).
  const newPositions = new Float32Array(newVertexCount * 3);
  for (let oldIdx = 0; oldIdx < vertexCount; oldIdx++) {
    const newIdx = remap[oldIdx];
    if (newIdx === 0xffffffff) continue;
    newPositions[newIdx * 3]     = srcPositions[oldIdx * 3];
    newPositions[newIdx * 3 + 1] = srcPositions[oldIdx * 3 + 1];
    newPositions[newIdx * 3 + 2] = srcPositions[oldIdx * 3 + 2];
  }

  // newIndices verweist noch auf alte Vertex-Indizes -> umremappen.
  const remappedIndices = new Uint32Array(newIndices.length);
  for (let i = 0; i < newIndices.length; i++) {
    remappedIndices[i] = remap[newIndices[i]];
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  out.setIndex(new THREE.BufferAttribute(remappedIndices, 1));

  return { geometry: out, error, finalFaceCount: remappedIndices.length / 3 };
}
