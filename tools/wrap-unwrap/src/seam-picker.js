import * as THREE from 'three';

// Seam-Painting auf dem 3D-Mesh.
//
// - Aktivieren: enable(). Orbit-Kontrolle wird deaktiviert. Hover zeigt
//   nächste Kante als gelben Highlight. Klick toggelt Seam-Status.
// - Seams werden als Set von "lo|hi" Strings gespeichert (gleiche Kodierung
//   wie cut.js erwartet).
// - update() rendert alle Seams als roten Linien-Overlay.

const COLOR_SEAM = 0xff3838;
const COLOR_HOVER = 0xffe600;

export class SeamPicker {
  constructor({ canvas, camera, controls, scene }) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.scene = scene;

    this.geometry = null;
    this.mesh = null;
    this.seams = new Set(); // "lo|hi"
    this.active = false;
    this._listeners = null;

    this.seamLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: COLOR_SEAM, linewidth: 2 }),
    );
    this.seamLines.renderOrder = 5;
    this.scene.add(this.seamLines);

    this.hoverLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: COLOR_HOVER, linewidth: 3 }),
    );
    this.hoverLine.renderOrder = 6;
    this.scene.add(this.hoverLine);

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._currentHover = null; // [a, b] sorted

    this.onSeamsChanged = null; // callback
  }

  bind(mesh, geometry) {
    this.mesh = mesh;
    this.geometry = geometry;
    this.seams = new Set();
    this._refresh();
    this._clearHover();
  }

  clearSeams() {
    this.seams.clear();
    this._refresh();
    this.onSeamsChanged?.(this.seams);
  }

  setSeams(set) {
    this.seams = new Set(set);
    this._refresh();
  }

  enable() {
    if (this.active) return;
    this.active = true;
    if (this.controls) this.controls.enabled = false;
    this.canvas.style.cursor = 'crosshair';
    this._attach();
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    if (this.controls) this.controls.enabled = true;
    this.canvas.style.cursor = '';
    this._detach();
    this._clearHover();
  }

  _attach() {
    const onMove = (e) => this._onPointerMove(e);
    const onDown = (e) => this._onPointerDown(e);
    const onLeave = () => this._clearHover();
    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerdown', onDown);
    this.canvas.addEventListener('pointerleave', onLeave);
    this._listeners = { onMove, onDown, onLeave };
  }
  _detach() {
    if (!this._listeners) return;
    this.canvas.removeEventListener('pointermove', this._listeners.onMove);
    this.canvas.removeEventListener('pointerdown', this._listeners.onDown);
    this.canvas.removeEventListener('pointerleave', this._listeners.onLeave);
    this._listeners = null;
  }

  _ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    this._pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this._pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  _pickEdge(e) {
    if (!this.mesh) return null;
    this._ndc(e);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObject(this.mesh, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    if (hit.faceIndex == null) return null;

    const index = this.geometry.index.array;
    const positions = this.geometry.attributes.position.array;
    const f = hit.faceIndex;
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];

    // Distanz vom Trefferpunkt zur jeweiligen Kante.
    const edges = [[a, b], [b, c], [c, a]];
    let bestKey = null, bestDist = Infinity, bestPair = null;
    const P = hit.point;
    const va = new THREE.Vector3(), vb = new THREE.Vector3();
    for (const [u, v] of edges) {
      va.set(positions[u * 3], positions[u * 3 + 1], positions[u * 3 + 2]);
      vb.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      const d = distanceToSegment(P, va, vb);
      if (d < bestDist) {
        bestDist = d;
        bestPair = [u, v];
        const lo = u < v ? u : v, hi = u < v ? v : u;
        bestKey = lo + '|' + hi;
      }
    }
    return { key: bestKey, a: bestPair[0], b: bestPair[1] };
  }

  _onPointerMove(e) {
    const pick = this._pickEdge(e);
    if (!pick) { this._clearHover(); return; }
    if (this._currentHover && this._currentHover.key === pick.key) return;
    this._currentHover = pick;
    this._setHoverGeometry(pick.a, pick.b);
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    const pick = this._pickEdge(e);
    if (!pick) return;
    if (this.seams.has(pick.key)) this.seams.delete(pick.key);
    else this.seams.add(pick.key);
    this._refresh();
    this.onSeamsChanged?.(this.seams);
  }

  _clearHover() {
    this._currentHover = null;
    this.hoverLine.geometry.dispose();
    this.hoverLine.geometry = new THREE.BufferGeometry();
  }

  _setHoverGeometry(a, b) {
    const p = this.geometry.attributes.position.array;
    const verts = new Float32Array([
      p[a * 3], p[a * 3 + 1], p[a * 3 + 2],
      p[b * 3], p[b * 3 + 1], p[b * 3 + 2],
    ]);
    this.hoverLine.geometry.dispose();
    this.hoverLine.geometry = new THREE.BufferGeometry();
    this.hoverLine.geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  }

  _refresh() {
    if (!this.geometry) return;
    const p = this.geometry.attributes.position.array;
    const verts = new Float32Array(this.seams.size * 6);
    let i = 0;
    for (const key of this.seams) {
      const [aStr, bStr] = key.split('|');
      const a = +aStr, b = +bStr;
      verts[i++] = p[a * 3];     verts[i++] = p[a * 3 + 1]; verts[i++] = p[a * 3 + 2];
      verts[i++] = p[b * 3];     verts[i++] = p[b * 3 + 1]; verts[i++] = p[b * 3 + 2];
    }
    this.seamLines.geometry.dispose();
    this.seamLines.geometry = new THREE.BufferGeometry();
    this.seamLines.geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  }
}

function distanceToSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
