import * as THREE from 'three';

// Region-Picker.
//
// Modus wie SeamPicker, aber statt einzelner Kanten werden ganze Regionen
// selektiert. Voraussetzung: segmentMesh() wurde einmal gelaufen und
// regionOf ist bekannt.
//
// - Klick: Auswahl auf diese Region setzen (single-select)
// - Shift-Klick: Region der Auswahl hinzufügen
// - Ctrl-Klick / Cmd-Klick: Region aus der Auswahl entfernen
// - Zweiter Klick auf selbe Region: entfernt sie wieder (Toggle)

export class RegionPicker {
  constructor({ canvas, camera, controls }) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;

    this.mesh = null;
    this.geometry = null;
    this.regionOf = null;
    this.regionCount = 0;

    this.selected = new Set(); // set of region-index
    this.active = false;
    this._listeners = null;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    this.onSelectionChanged = null; // callback
  }

  bind(mesh, geometry, regionOf, regionCount) {
    this.mesh = mesh;
    this.geometry = geometry;
    this.regionOf = regionOf;
    this.regionCount = regionCount;
    this.selected = new Set();
  }

  clearSelection() {
    this.selected.clear();
    this.onSelectionChanged?.(this.selected);
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
  }

  _attach() {
    const onDown = (e) => this._onPointerDown(e);
    this.canvas.addEventListener('pointerdown', onDown);
    this._listeners = { onDown };
  }
  _detach() {
    if (!this._listeners) return;
    this.canvas.removeEventListener('pointerdown', this._listeners.onDown);
    this._listeners = null;
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    if (!this.mesh || !this.regionOf) return;
    const r = this.canvas.getBoundingClientRect();
    this._pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this._pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObject(this.mesh, false);
    if (hits.length === 0) return;
    const faceIdx = hits[0].faceIndex;
    if (faceIdx == null) return;
    const region = this.regionOf[faceIdx];
    if (region < 0 || region >= this.regionCount) return;

    if (e.shiftKey) {
      // add
      this.selected.add(region);
    } else if (e.ctrlKey || e.metaKey) {
      // remove
      this.selected.delete(region);
    } else {
      // Toggle single-select
      if (this.selected.size === 1 && this.selected.has(region)) {
        this.selected.clear();
      } else {
        this.selected.clear();
        this.selected.add(region);
      }
    }
    this.onSelectionChanged?.(this.selected);
  }
}
