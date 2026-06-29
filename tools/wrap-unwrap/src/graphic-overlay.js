import * as THREE from 'three';

// Grafik-Overlay: Bild aus Datei laden, dann per planarer Projektion aus der
// aktuellen Kamera-Richtung auf das 3D-Mesh aufbringen (Texture-UVs werden in
// das Geometry-uv Attribut geschrieben). Beim Cutten gehen UVs verloren, also
// vor dem Flatten projizieren oder nach jedem Cut erneut projizieren.
export class GraphicOverlay {
  constructor() {
    this.image = null;
    this.texture = null;
    this.aspect = 1;
    this.projected = false;
  }

  async loadFromFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageElement(url);
      this.image = img;
      this.aspect = img.naturalWidth / img.naturalHeight;
      if (this.texture) this.texture.dispose();
      this.texture = new THREE.Texture(img);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.needsUpdate = true;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.projected = false;
      return true;
    } finally {
      // Don't revoke immediately — keep the URL alive for the Image element.
      // The Image's data is loaded into the texture already though, so it's safe.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  // Schreibt das uv-Attribut in die Geometry basierend auf der Kamera-Sicht.
  projectFromCamera(geometry, camera, target, fit = 'contain') {
    if (!this.image) throw new Error('Keine Grafik geladen.');
    const positions = geometry.attributes.position.array;
    const vc = positions.length / 3;

    // Kamera-Basis in World-Space.
    camera.updateMatrixWorld();
    const mw = camera.matrixWorld;
    const right = new THREE.Vector3(1, 0, 0).transformDirection(mw);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(mw);

    const cx = target.x, cy = target.y, cz = target.z;
    const px = new Float64Array(vc);
    const py = new Float64Array(vc);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < vc; i++) {
      const dx = positions[i * 3]     - cx;
      const dy = positions[i * 3 + 1] - cy;
      const dz = positions[i * 3 + 2] - cz;
      const x = dx * right.x + dy * right.y + dz * right.z;
      const y = dx * up.x + dy * up.y + dz * up.z;
      px[i] = x; py[i] = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const meshW = maxX - minX, meshH = maxY - minY;
    // Skalieren so dass das Bild ins Mesh-Rechteck passt (contain) oder
    // es ausfüllt (cover) – Aspektverhältnis bleibt erhalten.
    const meshAR = meshW / meshH;
    let imgW, imgH;
    if (fit === 'cover' ? this.aspect > meshAR : this.aspect < meshAR) {
      imgH = meshH; imgW = meshH * this.aspect;
    } else {
      imgW = meshW; imgH = meshW / this.aspect;
    }
    const cxImg = (minX + maxX) / 2 - imgW / 2;
    const cyImg = (minY + maxY) / 2 - imgH / 2;

    const uv = new Float32Array(vc * 2);
    for (let i = 0; i < vc; i++) {
      uv[i * 2]     = (px[i] - cxImg) / imgW;
      uv[i * 2 + 1] = (py[i] - cyImg) / imgH;
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.projected = true;
  }

  clear() {
    if (this.texture) this.texture.dispose();
    this.texture = null;
    this.image = null;
    this.projected = false;
  }
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
    img.src = url;
  });
}
