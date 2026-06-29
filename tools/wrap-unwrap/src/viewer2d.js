import * as THREE from 'three';
import { distortionToColor } from './flatten/distortion.js';
import { buildVertexColorsFromComponents, compute2DCentroid } from './components-vis.js';

function computeVertexColorsFromFaceData(index, vertCount, perFace, valToColor) {
  const accum = new Float32Array(vertCount);
  const counts = new Uint32Array(vertCount);
  for (let f = 0; f < perFace.length; f++) {
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    accum[a] += perFace[f]; counts[a]++;
    accum[b] += perFace[f]; counts[b]++;
    accum[c] += perFace[f]; counts[c]++;
  }
  const out = new Float32Array(vertCount * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < vertCount; i++) {
    const v = counts[i] > 0 ? accum[i] / counts[i] : 0;
    valToColor(v, tmp);
    out[i * 3] = tmp.r; out[i * 3 + 1] = tmp.g; out[i * 3 + 2] = tmp.b;
  }
  return out;
}

// Einfacher orthographischer Viewer für die 2D-Abwicklung.
// Mausrad zoomt, Drag pannt.
export class Viewer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x111111, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    this.camera.position.z = 10;

    this.mesh = null;
    this.wireMesh = null;
    this.wireVisible = true;
    this.heatmapOn = false;
    this.componentsOn = false;

    // HTML-Layer für Bahnnummern. Liegt absolut über dem Canvas.
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    this.canvas.parentElement.appendChild(this.labelLayer);

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
    this._renderLabels();
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
    this._labelData = null;
    this._renderLabels();
  }

  setComponentLabels(uv, index, componentOf, components) {
    this._labelData = components.map(comp => {
      const c = compute2DCentroid(uv, index, componentOf, comp.number - 1);
      return { number: comp.number, u: c.u, v: c.v };
    });
    this._renderLabels();
  }

  setComponentColors(uv, index, componentOf, count) {
    this.componentsOn = true;
    const fakeGeo = {
      index: { array: index },
      attributes: { position: { count: uv.length / 2 } },
    };
    this._componentColors = buildVertexColorsFromComponents(fakeGeo, componentOf, count, 0.7);
    this._applyColors();
  }

  clearComponents() {
    this.componentsOn = false;
    this._componentColors = null;
    this._labelData = null;
    this._renderLabels();
    this._applyColors();
  }

  _renderLabels() {
    if (!this.labelLayer) return;
    this.labelLayer.innerHTML = '';
    if (!this._labelData) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!this._view) return;
    const halfH = this._view.height / 2;
    const halfW = halfH * (w / h);
    for (const lbl of this._labelData) {
      // Welt -> NDC -> Pixel
      const ndcX = (lbl.u - this._view.cx) / halfW;
      const ndcY = (lbl.v - this._view.cy) / halfH;
      const px = (ndcX + 1) * 0.5 * w;
      const py = (1 - (ndcY + 1) * 0.5) * h;
      if (px < 0 || px > w || py < 0 || py > h) continue;
      const el = document.createElement('div');
      el.className = 'label';
      el.textContent = String(lbl.number);
      el.style.left = px + 'px';
      el.style.top = py + 'px';
      this.labelLayer.appendChild(el);
    }
  }

  toDataURL(scale = 2) {
    const oldSize = new THREE.Vector2();
    this.renderer.getSize(oldSize);
    const oldRatio = this.renderer.getPixelRatio();
    const w = Math.floor(oldSize.x * scale);
    const h = Math.floor(oldSize.y * scale);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this._updateProjection();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(oldRatio);
    this.renderer.setSize(oldSize.x, oldSize.y, false);
    this._updateProjection();
    return url;
  }

  // Rendert die Szene exakt auf das angegebene UV-Rechteck mit der angegebenen
  // Auflösung. Wird für Raster-Export (mit Grafik) benutzt: das resultierende
  // PNG kann 1:1 in die SVG-Bahnen-Datei eingebettet werden.
  renderRaster(bounds, pixelsPerUnit = 4) {
    const { minU, minV, maxU, maxV } = bounds;
    const wWorld = maxU - minU;
    const hWorld = maxV - minV;
    const w = Math.max(1, Math.round(wWorld * pixelsPerUnit));
    const h = Math.max(1, Math.round(hWorld * pixelsPerUnit));

    // Save state
    const oldSize = new THREE.Vector2();
    this.renderer.getSize(oldSize);
    const oldRatio = this.renderer.getPixelRatio();
    const oldClear = this.renderer.getClearColor(new THREE.Color()).getHex();
    const oldClearA = this.renderer.getClearAlpha();
    const oldCam = {
      left: this.camera.left, right: this.camera.right, top: this.camera.top, bottom: this.camera.bottom,
    };
    // Switch wireframe and labels off — they would burn into the raster.
    const wireWas = this.wireMesh?.visible;
    if (this.wireMesh) this.wireMesh.visible = false;
    const labelsWere = this.labelLayer.style.display;
    this.labelLayer.style.display = 'none';
    // Heatmap off for clean print (the print is the graphic + cut lines).
    const hmWas = this.heatmapOn;
    const cmpWas = this.componentsOn;
    this.heatmapOn = false;
    this.componentsOn = false;
    this._applyColors();

    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.setSize(w, h, false);
    this.camera.left = minU;
    this.camera.right = maxU;
    this.camera.top = maxV;
    this.camera.bottom = minV;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');

    // Restore
    this.renderer.setPixelRatio(oldRatio);
    this.renderer.setSize(oldSize.x, oldSize.y, false);
    this.renderer.setClearColor(oldClear, oldClearA);
    this.camera.left = oldCam.left; this.camera.right = oldCam.right;
    this.camera.top = oldCam.top; this.camera.bottom = oldCam.bottom;
    this.camera.updateProjectionMatrix();
    if (this.wireMesh) this.wireMesh.visible = wireWas;
    this.labelLayer.style.display = labelsWere;
    this.heatmapOn = hmWas;
    this.componentsOn = cmpWas;
    this._applyColors();

    return url;
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
    // Textur-UVs aus dem 3D-Original-Geometry übernehmen, falls vorhanden.
    const srcUV = geometry.getAttribute('uv');
    if (srcUV) {
      flatGeo.setAttribute('uv', new THREE.Float32BufferAttribute(srcUV.array.slice(), 2));
    }

    // Distortion-Farben pro Vertex aus den Face-Werten gemittelt.
    this._distortionColors = null;
    if (distortion) {
      this._distortionColors = computeVertexColorsFromFaceData(
        index, vertCount, distortion.perFace,
        (v, out) => distortionToColor(v, out),
      );
    }
    this._componentColors = null;
    this._currentIndex = index;
    this._currentUV = uv;

    flatGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));

    const fillMat = new THREE.MeshBasicMaterial({
      vertexColors: false,
      color: 0xeeeeee,
      side: THREE.DoubleSide,
      map: this._texture || null,
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
    this._applyColors();
  }

  _applyColors() {
    if (!this.mesh) return;
    const colorAttr = this.mesh.geometry.getAttribute('color');
    if (!colorAttr) return;
    const arr = colorAttr.array;
    let src = null;
    if (this.heatmapOn && this._distortionColors) src = this._distortionColors;
    else if (!this._texture && this.componentsOn && this._componentColors) src = this._componentColors;
    if (src) {
      arr.set(src);
      colorAttr.needsUpdate = true;
      this.mesh.material.vertexColors = true;
      this.mesh.material.color.set(0xffffff);
    } else {
      this.mesh.material.vertexColors = false;
      this.mesh.material.color.set(this._texture ? 0xffffff : 0xeeeeee);
    }
    this.mesh.material.needsUpdate = true;
  }

  setTexture(texture) {
    this._texture = texture;
    if (this.mesh) {
      this.mesh.material.map = texture;
      this._applyColors();
    }
  }

  setWireframe(on) {
    this.wireVisible = on;
    if (this.wireMesh) this.wireMesh.visible = on;
  }

  setHeatmap(on) {
    this.heatmapOn = on;
    this._applyColors();
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
