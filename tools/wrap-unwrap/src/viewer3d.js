import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { distortionToColor } from './flatten/distortion.js';

const DEFAULT_COLOR = new THREE.Color(0x9a9a9a);

export class Viewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    this.camera.position.set(2.5, 2, 3);

    const hemi = new THREE.HemisphereLight(0xf0f0f0, 0x202020, 0.7);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 5, 2);
    this.scene.add(dir);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    this.mesh = null;
    this.wireMesh = null;
    this.wireVisible = true;
    this.heatmapOn = false;

    this._raf = this._raf.bind(this);
    requestAnimationFrame(this._raf);
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setGeometry(geometry, info) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
    if (this.wireMesh) { this.scene.remove(this.wireMesh); this.wireMesh.geometry.dispose(); this.wireMesh.material.dispose(); }

    const mat = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      metalness: 0.05,
      roughness: 0.85,
      side: THREE.DoubleSide,
      flatShading: false,
      vertexColors: false,
    });
    this.mesh = new THREE.Mesh(geometry, mat);
    this.scene.add(this.mesh);

    const wireGeo = new THREE.WireframeGeometry(geometry);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
    this.wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    this.scene.add(this.wireMesh);
    this.wireMesh.visible = this.wireVisible;

    // Frame the camera on the mesh.
    const bb = info.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    const size = info.boundingSize;
    const radius = Math.max(size.x, size.y, size.z) * 0.6;

    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(radius * 2, radius * 1.4, radius * 2.4));
    this.camera.near = Math.max(radius * 0.01, 0.001);
    this.camera.far = Math.max(radius * 100, 100);
    this.camera.updateProjectionMatrix();
    this._initialView = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
  }

  setWireframe(on) {
    this.wireVisible = on;
    if (this.wireMesh) this.wireMesh.visible = on;
  }

  setDistortion(distortion, on) {
    this.heatmapOn = on;
    if (!this.mesh) return;
    const mat = this.mesh.material;
    if (!on || !distortion) {
      mat.vertexColors = false;
      mat.color.set(0xeeeeee);
      mat.needsUpdate = true;
      const g = this.mesh.geometry;
      if (g.getAttribute('color')) g.deleteAttribute('color');
      return;
    }
    applyVertexColors(this.mesh.geometry, distortion);
    mat.vertexColors = true;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
  }

  resetView() {
    if (!this._initialView) return;
    this.camera.position.copy(this._initialView.pos);
    this.controls.target.copy(this._initialView.target);
    this.controls.update();
  }

  _raf() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._raf);
  }
}

// Wandelt per-Face Distortion in per-Vertex Farben (Mittelwert der inzidenten Faces).
export function applyVertexColors(geometry, distortion) {
  const index = geometry.index.array;
  const vertCount = geometry.attributes.position.count;
  const perFace = distortion.perFace;
  const accum = new Float32Array(vertCount); // sum of values
  const counts = new Uint32Array(vertCount);

  for (let f = 0; f < perFace.length; f++) {
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    accum[a] += perFace[f]; counts[a]++;
    accum[b] += perFace[f]; counts[b]++;
    accum[c] += perFace[f]; counts[c]++;
  }

  const colors = new Float32Array(vertCount * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < vertCount; i++) {
    const v = counts[i] > 0 ? accum[i] / counts[i] : 0;
    distortionToColor(v, tmp);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
