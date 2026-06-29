import * as THREE from 'three';
import { distortionToColor } from './flatten/distortion.js';

// Einfacher orthographischer Viewer für die 2D-Abwicklung.
// Mausrad zoomt, Drag pannt.
export class Viewer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    this.camera.position.z = 10;

    this.mesh = null;
    this.wireMesh = null;
    this.wireVisible = true;
    this.heatmapOn = false;

    this._panStart = null;
    this._initialFrame = null;
    this._setupInput();

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
    this._updateProjection();
  }

  _updateProjection() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const aspect = w / h;
    const view = this._view || { cx: 0, cy: 0, height: 2 };
    const halfH = view.height / 2;
    const halfW = halfH * aspect;
    this.camera.left = view.cx - halfW;
    this.camera.right = view.cx + halfW;
    this.camera.top = view.cy + halfH;
    this.camera.bottom = view.cy - halfH;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.wireMesh) {
      this.scene.remove(this.wireMesh);
      this.wireMesh.geometry.dispose();
      this.wireMesh.material.dispose();
      this.wireMesh = null;
    }
  }

  setUnfold(geometry, uv, distortion) {
    this.clear();

    const index = geometry.index.array;
    const vertCount = uv.length / 2;

    // Flache Position aus UV.
    const positions = new Float32Array(vertCount * 3);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < vertCount; i++) {
      const u = uv[i * 2], v = uv[i * 2 + 1];
      positions[i * 3] = u;
      positions[i * 3 + 1] = v;
      positions[i * 3 + 2] = 0;
      if (u < minX) minX = u; if (u > maxX) maxX = u;
      if (v < minY) minY = v; if (v > maxY) maxY = v;
    }

    const flatGeo = new THREE.BufferGeometry();
    flatGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    flatGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));

    // Vertex-Farben aus Distortion (immer berechnen, einfach unsichtbar wenn aus).
    const colors = new Float32Array(vertCount * 3);
    if (distortion) {
      const perFace = distortion.perFace;
      const accum = new Float32Array(vertCount);
      const counts = new Uint32Array(vertCount);
      for (let f = 0; f < perFace.length; f++) {
        const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
        accum[a] += perFace[f]; counts[a]++;
        accum[b] += perFace[f]; counts[b]++;
        accum[c] += perFace[f]; counts[c]++;
      }
      const tmp = new THREE.Color();
      for (let i = 0; i < vertCount; i++) {
        const v = counts[i] > 0 ? accum[i] / counts[i] : 0;
        distortionToColor(v, tmp);
        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
      }
    } else {
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = 0.85; colors[i + 1] = 0.85; colors[i + 2] = 0.85;
      }
    }
    flatGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const fillMat = new THREE.MeshBasicMaterial({
      vertexColors: this.heatmapOn,
      color: this.heatmapOn ? 0xffffff : 0xeeeeee,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(flatGeo, fillMat);
    this.scene.add(this.mesh);

    // Wireframe als separate LineSegments.
    const wireGeo = new THREE.WireframeGeometry(flatGeo);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55 });
    this.wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    this.wireMesh.position.z = 0.001;
    this.wireMesh.visible = this.wireVisible;
    this.scene.add(this.wireMesh);

    // View framen.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const h = Math.max(maxY - minY, (maxX - minX) * 0.5, 1e-6) * 1.2;
    this._view = { cx, cy, height: h };
    this._initialFrame = { ...this._view };
    this._updateProjection();
  }

  setWireframe(on) {
    this.wireVisible = on;
    if (this.wireMesh) this.wireMesh.visible = on;
  }

  setHeatmap(on) {
    this.heatmapOn = on;
    if (this.mesh) {
      this.mesh.material.vertexColors = on;
      this.mesh.material.color.set(on ? 0xffffff : 0xeeeeee);
      this.mesh.material.needsUpdate = true;
    }
  }

  resetView() {
    if (this._initialFrame) {
      this._view = { ...this._initialFrame };
      this._updateProjection();
    }
  }

  _setupInput() {
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (!this._view) return;
      const factor = Math.exp(e.deltaY * 0.001);
      this._view.height *= factor;
      this._view.height = Math.max(this._view.height, 1e-5);
      this._updateProjection();
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', e => {
      this.canvas.setPointerCapture(e.pointerId);
      this._panStart = { x: e.clientX, y: e.clientY, view: { ...this._view } };
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!this._panStart || !this._view) return;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      const pxToWorld = this._view.height / h;
      const dx = (e.clientX - this._panStart.x) * pxToWorld;
      const dy = (e.clientY - this._panStart.y) * pxToWorld;
      this._view.cx = this._panStart.view.cx - dx;
      this._view.cy = this._panStart.view.cy + dy;
      this._updateProjection();
    });
    const endPan = e => {
      if (this._panStart && this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this._panStart = null;
    };
    this.canvas.addEventListener('pointerup', endPan);
    this.canvas.addEventListener('pointercancel', endPan);
  }

  _raf() {
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._raf);
  }
}
