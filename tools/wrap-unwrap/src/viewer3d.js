import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { distortionToColor } from './flatten/distortion.js';
import {
  buildVertexColorsFromComponents,
  makeNumberSprite,
  compute3DCentroid,
} from './components-vis.js';

export class Viewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x111111, 1);

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
    this.componentsOn = false;
    this.labelGroup = new THREE.Group();
    this.scene.add(this.labelGroup);
    this._spriteScale = 1;

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
    this._spriteScale = radius * 0.18;
    this.clearLabels();
    this.componentsOn = false;
    this.heatmapOn = false;
    this._componentColors = null;
    this._distortionColors = null;
    // Texture wieder anhängen falls vorhanden (geometry hat noch keine UVs,
    // aber der Material-Slot wird trotzdem wiederhergestellt).
    if (this.mesh) this.mesh.material.map = this._texture || null;
    this._applyColors();
  }

  clearLabels() {
    while (this.labelGroup.children.length) {
      const s = this.labelGroup.children[0];
      this.labelGroup.remove(s);
      if (s.material?.map) s.material.map.dispose();
      if (s.material) s.material.dispose();
    }
  }

  setComponents(geometry, componentOf, count, components) {
    this.componentsOn = true;
    this._componentColors = buildVertexColorsFromComponents(geometry, componentOf, count, 0.65);
    this._applyColors();
    this.clearLabels();
    for (const comp of components) {
      const centroid = compute3DCentroid(geometry, componentOf, comp.number - 1);
      const sprite = makeNumberSprite(comp.number);
      sprite.position.copy(centroid);
      const s = this._spriteScale;
      sprite.scale.set(s, s, 1);
      this.labelGroup.add(sprite);
    }
  }

  clearComponents() {
    this.componentsOn = false;
    this._componentColors = null;
    this.clearLabels();
    this._applyColors();
  }

  setTexture(texture) {
    this._texture = texture;
    if (!this.mesh) return;
    this.mesh.material.map = texture;
    // Mit Textur die Vertex-Farben unterdrücken, sonst tinted das Bild.
    this.mesh.material.needsUpdate = true;
    this._applyColors();
  }

  _applyColors() {
    if (!this.mesh) return;
    const g = this.mesh.geometry;
    let src = null;
    if (this.heatmapOn && this._distortionColors) src = this._distortionColors;
    else if (!this._texture && this.componentsOn && this._componentColors) src = this._componentColors;
    if (src) {
      g.setAttribute('color', new THREE.BufferAttribute(src, 3));
      this.mesh.material.vertexColors = true;
      this.mesh.material.color.set(0xffffff);
    } else {
      if (g.getAttribute('color')) g.deleteAttribute('color');
      this.mesh.material.vertexColors = false;
      this.mesh.material.color.set(this._texture ? 0xffffff : 0xeeeeee);
    }
    this.mesh.material.needsUpdate = true;
  }

  toDataURL(scale = 2) {
    // Render at a higher resolution for export. Restore size afterwards.
    const oldSize = new THREE.Vector2();
    this.renderer.getSize(oldSize);
    const oldRatio = this.renderer.getPixelRatio();
    const w = Math.floor(oldSize.x * scale);
    const h = Math.floor(oldSize.y * scale);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    // Restore
    this.renderer.setPixelRatio(oldRatio);
    this.renderer.setSize(oldSize.x, oldSize.y, false);
    this.camera.aspect = oldSize.x / oldSize.y;
    this.camera.updateProjectionMatrix();
    return url;
  }

  setWireframe(on) {
    this.wireVisible = on;
    if (this.wireMesh) this.wireMesh.visible = on;
  }

  setDistortion(distortion, on) {
    this.heatmapOn = on;
    if (!this.mesh) return;
    if (distortion) {
      this._distortionColors = vertexColorsFromDistortion(this.mesh.geometry, distortion);
    } else {
      this._distortionColors = null;
    }
    this._applyColors();
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

function vertexColorsFromDistortion(geometry, distortion) {
  const index = geometry.index.array;
  const vertCount = geometry.attributes.position.count;
  const perFace = distortion.perFace;
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
    distortionToColor(v, tmp);
    out[i * 3] = tmp.r; out[i * 3 + 1] = tmp.g; out[i * 3 + 2] = tmp.b;
  }
  return out;
}
