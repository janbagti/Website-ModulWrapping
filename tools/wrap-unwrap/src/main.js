import * as THREE from 'three';
import { Viewer3D } from './viewer3d.js';
import { Viewer2D } from './viewer2d.js';
import { loadOBJ } from './loaders/obj.js';
import { loadSTL } from './loaders/stl.js';
import { buildMeshInfo } from './mesh-info.js';
import { flattenAllComponents } from './flatten/multi.js';
import { cutMeshAlongSeams } from './flatten/cut.js';
import { SeamPicker } from './seam-picker.js';
import { RegionPicker } from './region-picker.js';
import { segmentMesh, seamsFromSelection } from './flatten/segment.js';
import { GraphicOverlay } from './graphic-overlay.js';
import { decimateMesh } from './decimate.js';
import { generateSVG, downloadSVG, downloadPNG } from './export-svg.js';

const els = {
  canvas3d:       document.getElementById('canvas-3d'),
  canvas2d:       document.getElementById('canvas-2d'),
  fileInput:      document.getElementById('file-input'),
  dropHint:       document.getElementById('drop-hint'),
  placeholder2d:  document.getElementById('placeholder-2d'),
  btnSeamMode:    document.getElementById('btn-seam-mode'),
  btnSeamClear:   document.getElementById('btn-seam-clear'),
  btnApplyCut:    document.getElementById('btn-apply-cut'),
  btnFlatten:     document.getElementById('btn-flatten'),
  btnExport:      document.getElementById('btn-export'),
  btnOverview:    document.getElementById('btn-overview'),
  btnResetView:   document.getElementById('btn-reset-view'),
  graphicInput:   document.getElementById('graphic-input'),
  btnGraphicProject: document.getElementById('btn-graphic-project'),
  btnGraphicClear: document.getElementById('btn-graphic-clear'),
  statGraphic:    document.getElementById('stat-graphic'),
  toggleRaster:   document.getElementById('toggle-raster'),
  decimateTarget: document.getElementById('decimate-target'),
  btnDecimate:    document.getElementById('btn-decimate'),
  segAngle:       document.getElementById('seg-angle'),
  segMinSize:     document.getElementById('seg-minsize'),
  btnSegment:     document.getElementById('btn-segment'),
  statRegions:    document.getElementById('stat-regions'),
  statSelection:  document.getElementById('stat-selection'),
  btnRegionMode:  document.getElementById('btn-region-mode'),
  btnRegionClear: document.getElementById('btn-region-clear'),
  btnSeamsFromSel: document.getElementById('btn-seams-from-selection'),
  toggleWire:     document.getElementById('toggle-wire'),
  toggleHeatmap:  document.getElementById('toggle-heatmap'),
  legend:         document.getElementById('legend'),
  toast:          document.getElementById('toast'),
  pane3d:         document.getElementById('pane-3d'),
  statVerts:      document.getElementById('stat-verts'),
  statFaces:      document.getElementById('stat-faces'),
  statSize:       document.getElementById('stat-size'),
  statBoundary:   document.getElementById('stat-boundary'),
  statSeams:      document.getElementById('stat-seams'),
  statFlattenStatus: document.getElementById('stat-flatten-status'),
  statComps:      document.getElementById('stat-comps'),
  statDistAvg:    document.getElementById('stat-dist-avg'),
  statDistMax:    document.getElementById('stat-dist-max'),
};

const state = {
  geometry: null,
  meshInfo: null,
  flatten: null, // { uv, componentOf, components, distortion }
  fileName: '',
};

const viewer3d = new Viewer3D(els.canvas3d);
const viewer2d = new Viewer2D(els.canvas2d);

const seamPicker = new SeamPicker({
  canvas: els.canvas3d,
  camera: viewer3d.camera,
  controls: viewer3d.controls,
  scene: viewer3d.scene,
});
seamPicker.onSeamsChanged = (seams) => {
  els.statSeams.textContent = String(seams.size);
  els.btnSeamClear.disabled = seams.size === 0;
  els.btnApplyCut.disabled = seams.size === 0;
};

const graphic = new GraphicOverlay();

const regionPicker = new RegionPicker({
  canvas: els.canvas3d,
  camera: viewer3d.camera,
  controls: viewer3d.controls,
});
regionPicker.onSelectionChanged = (sel) => {
  els.statSelection.textContent = sel.size === 0 ? '—' : `${sel.size} Fläche(n)`;
  els.btnRegionClear.disabled = sel.size === 0;
  els.btnSeamsFromSel.disabled = sel.size === 0;
  viewer3d.setRegionSelection(sel);
};

// State pro Session: die aktuelle Segmentierung
state.segmentation = null; // { regionOf, regionCount, creaseEdges }

function toast(msg, kind = '') {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (kind ? ' ' + kind : '');
  els.toast.hidden = false;
  clearTimeout(toast._t);
  // Fehler bleiben stehen bis zum nächsten Toast — nicht automatisch ausblenden.
  if (kind !== 'error') {
    toast._t = setTimeout(() => { els.toast.hidden = true; }, 3500);
  }
}
// Klick auf den Toast schließt ihn.
els.toast.addEventListener('click', () => { els.toast.hidden = true; });

function fmtInt(n) { return n.toLocaleString('de-DE'); }
function fmtPct(x) { return (x * 100).toFixed(1) + ' %'; }

function refreshMeshStats() {
  const info = state.meshInfo;
  els.statVerts.textContent = fmtInt(info.vertexCount);
  els.statFaces.textContent = fmtInt(info.faceCount);
  const s = info.boundingSize;
  els.statSize.textContent = `${s.x.toFixed(0)} × ${s.y.toFixed(0)} × ${s.z.toFixed(0)}`;
  els.statBoundary.textContent = info.boundaryLoops.length === 0
    ? 'geschlossen'
    : `${info.boundaryLoops.length} Loop(s)`;
}

function clearFlattenResults() {
  state.flatten = null;
  els.statFlattenStatus.textContent = '—';
  els.statComps.textContent = '—';
  els.statDistAvg.textContent = '—';
  els.statDistMax.textContent = '—';
  els.btnExport.disabled = true;
  els.btnOverview.disabled = true;
  viewer2d.clear();
  viewer2d.clearComponents();
  els.placeholder2d.classList.remove('hidden');
  viewer3d.clearComponents();
  viewer3d.setDistortion(null, false);
}

async function handleFile(file) {
  const name = file.name.toLowerCase();
  toast(`Lese ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB) …`, '');
  console.log('[load]', file.name, file.size, 'bytes');

  // Mikropause damit der Toast vor dem CPU-Burn sichtbar wird.
  await new Promise(r => setTimeout(r, 16));

  let geometry;
  try {
    const t0 = performance.now();
    const buf = await file.arrayBuffer();
    if (name.endsWith('.obj')) {
      geometry = loadOBJ(new TextDecoder().decode(buf));
    } else if (name.endsWith('.stl')) {
      geometry = loadSTL(buf);
    } else {
      toast('Nur OBJ oder STL.', 'error');
      return;
    }
    console.log('[load] parsed in', (performance.now() - t0).toFixed(0), 'ms');
  } catch (e) {
    console.error('[load] parse error:', e);
    toast('Datei konnte nicht gelesen werden: ' + e.message, 'error');
    return;
  }

  if (!geometry || geometry.attributes.position.count === 0) {
    console.error('[load] empty geometry');
    toast('Mesh ist leer — Datei enthielt keine gültigen Vertices.', 'error');
    return;
  }

  console.log('[load] vertices:', geometry.attributes.position.count, 'faces:', (geometry.index?.count ?? 0) / 3);

  try {
    const t1 = performance.now();
    geometry.computeVertexNormals();
    console.log('[load] normals in', (performance.now() - t1).toFixed(0), 'ms');

    const t2 = performance.now();
    const info = buildMeshInfo(geometry);
    console.log('[load] meshInfo in', (performance.now() - t2).toFixed(0), 'ms — boundary loops:', info.boundaryLoops.length);

    state.geometry = geometry;
    state.meshInfo = info;
    state.fileName = file.name;

    const t3 = performance.now();
    viewer3d.setGeometry(geometry, info);
    console.log('[load] viewer3d.setGeometry in', (performance.now() - t3).toFixed(0), 'ms');

    seamPicker.bind(viewer3d.mesh, geometry);
    els.statSeams.textContent = '0';
    els.btnSeamClear.disabled = true;
    els.btnApplyCut.disabled = true;

    refreshMeshStats();
    clearFlattenResults();

    // Toggle-State zurücksetzen damit Checkbox-UI nicht von viewer-State driftet.
    els.toggleHeatmap.checked = false;
    els.toggleWire.checked = false;
    els.legend.hidden = true;

    clearSegmentation();

    els.dropHint.classList.add('hidden');
    els.btnFlatten.disabled = false;
    els.btnResetView.disabled = false;
    els.btnSeamMode.disabled = false;
    els.btnDecimate.disabled = false;
    els.btnSegment.disabled = false;

    // Vorschlag: 10 % der aktuellen Faces, aber zwischen 5 k und 50 k.
    const suggest = Math.max(5000, Math.min(50000, Math.round(info.faceCount * 0.1 / 1000) * 1000));
    els.decimateTarget.value = String(suggest);

    toast(`Geladen: ${fmtInt(info.vertexCount)} Vertices, ${fmtInt(info.faceCount)} Faces`, 'success');
  } catch (e) {
    console.error('[load] post-parse error:', e);
    toast('Mesh konnte nicht eingerichtet werden: ' + e.message, 'error');
  }
}

async function handleFlatten() {
  if (!state.geometry) return;
  const faceCount = state.meshInfo.faceCount;
  if (faceCount > 100_000) {
    const ok = confirm(
      `Dieses Mesh hat ${fmtInt(faceCount)} Faces. LSCM in reinem JS skaliert linear ` +
      `mit Faces × Iterationen — das kann hier 10–60 s dauern und etwa ` +
      `${Math.round(faceCount * 0.2)} MB RAM brauchen.\n\nFortfahren?`
    );
    if (!ok) return;
  }
  els.statFlattenStatus.textContent = 'läuft …';
  els.btnFlatten.disabled = true;
  console.log('[flatten] starting, faces:', faceCount);
  const t0 = performance.now();
  await new Promise(r => setTimeout(r, 16));

  try {
    const result = flattenAllComponents(state.geometry, { maxLayoutWidth: 1500, padding: 20 });
    console.log('[flatten] done in', (performance.now() - t0).toFixed(0), 'ms');
    if (!result.ok) {
      els.statFlattenStatus.textContent = 'Fehler';
      toast('Abwicklung fehlgeschlagen: ' + result.error, 'error');
      return;
    }
    state.flatten = result;

    els.statFlattenStatus.textContent = 'ok';
    els.statComps.textContent = String(result.componentCount);
    els.statDistAvg.textContent = fmtPct(result.distortion.avg);
    els.statDistMax.textContent = fmtPct(result.distortion.max);

    const index = state.geometry.index.array;

    viewer2d.setUnfold(state.geometry, result.uv, result.distortion);
    viewer2d.setComponentColors(result.uv, index, result.componentOf, result.componentCount);
    viewer2d.setComponentLabels(result.uv, index, result.componentOf, result.components);

    viewer3d.setComponents(state.geometry, result.componentOf, result.componentCount, result.components);
    viewer3d.setDistortion(result.distortion, els.toggleHeatmap.checked);

    els.placeholder2d.classList.add('hidden');
    els.btnExport.disabled = false;
    els.btnOverview.disabled = false;
  } catch (e) {
    console.error(e);
    els.statFlattenStatus.textContent = 'Fehler';
    toast('Abwicklung fehlgeschlagen: ' + e.message, 'error');
  } finally {
    els.btnFlatten.disabled = false;
  }
}

function clearSegmentation() {
  state.segmentation = null;
  viewer3d.clearRegions();
  regionPicker.bind(null, null, null, 0);
  els.statRegions.textContent = '—';
  els.statSelection.textContent = '—';
  els.btnRegionMode.disabled = true;
  els.btnRegionClear.disabled = true;
  els.btnSeamsFromSel.disabled = true;
  setRegionMode(false);
}

async function handleSegment() {
  if (!state.geometry) return;
  const angle = parseFloat(els.segAngle.value);
  const minSize = parseInt(els.segMinSize.value, 10);
  if (!Number.isFinite(angle) || angle < 1 || angle > 89) {
    toast('Winkel muss zwischen 1 und 89 Grad liegen.', 'error');
    return;
  }
  if (!Number.isFinite(minSize) || minSize < 1) {
    toast('Min-Faces muss ≥ 1 sein.', 'error');
    return;
  }

  toast('Erkenne Flächen …', '');
  els.btnSegment.disabled = true;
  await new Promise(r => setTimeout(r, 16));

  try {
    const t0 = performance.now();
    const positions = state.geometry.attributes.position.array;
    const index = state.geometry.index.array;
    const seg = segmentMesh(positions, index, {
      angleThresholdDeg: angle,
      minRegionFaces: minSize,
    });
    const ms = performance.now() - t0;
    console.log('[segment]', ms.toFixed(0), 'ms', seg.regionCount, 'Regionen');

    state.segmentation = seg;
    viewer3d.setRegions(seg.regionOf, seg.regionCount);
    regionPicker.bind(viewer3d.mesh, state.geometry, seg.regionOf, seg.regionCount);
    els.statRegions.textContent = fmtInt(seg.regionCount);
    els.statSelection.textContent = '—';
    els.btnRegionMode.disabled = false;
    els.btnRegionClear.disabled = true;
    els.btnSeamsFromSel.disabled = true;

    if (seg.regionCount === 1) {
      toast(
        `Nur 1 Fläche erkannt bei ${angle}° — Mesh ist zu glatt/rund. ` +
        `Winkel niedriger setzen oder Seams manuell malen.`,
        'error',
      );
    } else {
      toast(`${seg.regionCount} Flächen erkannt in ${ms.toFixed(0)} ms. Auswahl-Modus aktivieren und Flächen anklicken.`, 'success');
    }
  } catch (e) {
    console.error('[segment] error:', e);
    toast('Segmentierung fehlgeschlagen: ' + e.message, 'error');
  } finally {
    els.btnSegment.disabled = false;
  }
}

function setRegionMode(on) {
  if (on) {
    // Erst Seam-Modus aus falls aktiv — die beiden schließen sich aus.
    if (seamPicker.active) setSeamMode(false);
    regionPicker.enable();
    els.btnRegionMode.classList.add('active');
    els.btnRegionMode.textContent = 'Auswahl-Modus aus';
  } else {
    regionPicker.disable();
    els.btnRegionMode.classList.remove('active');
    els.btnRegionMode.textContent = 'Auswahl-Modus';
  }
}

function handleSeamsFromSelection() {
  if (!state.segmentation || regionPicker.selected.size === 0) {
    toast('Erst Flächen auswählen.', 'error');
    return;
  }
  const positions = state.geometry.attributes.position.array;
  const index = state.geometry.index.array;
  const seams = seamsFromSelection(
    index,
    positions,
    state.segmentation.regionOf,
    regionPicker.selected,
  );
  seamPicker.setSeams(seams);
  els.statSeams.textContent = String(seams.size);
  els.btnSeamClear.disabled = seams.size === 0;
  els.btnApplyCut.disabled = seams.size === 0;
  toast(`${seams.size} Seams aus Auswahl gesetzt. Jetzt „Schnitte anwenden".`, 'success');
}

function setSeamMode(on) {
  if (on) {
    // Region-Modus aus falls aktiv — beide schließen sich aus.
    if (regionPicker.active) setRegionMode(false);
    seamPicker.enable();
    els.btnSeamMode.classList.add('active');
    els.btnSeamMode.textContent = 'Seam-Modus aus';
  } else {
    seamPicker.disable();
    els.btnSeamMode.classList.remove('active');
    els.btnSeamMode.textContent = 'Seams malen';
  }
}

async function handleDecimate() {
  if (!state.geometry) return;
  const target = parseInt(els.decimateTarget.value, 10);
  if (!Number.isFinite(target) || target < 100) {
    toast('Ziel-Faces muss eine Zahl ≥ 100 sein.', 'error');
    return;
  }
  const currentFaces = state.meshInfo.faceCount;
  if (target >= currentFaces) {
    toast(`Mesh hat schon ${fmtInt(currentFaces)} Faces — nichts zu reduzieren.`, '');
    return;
  }

  els.btnDecimate.disabled = true;
  toast('Dezimiere …', '');
  await new Promise(r => setTimeout(r, 16));

  const t0 = performance.now();
  try {
    const res = await decimateMesh(state.geometry, target, { targetError: 0.05 });
    const dt = performance.now() - t0;
    console.log('[decimate]', dt.toFixed(0), 'ms');

    const newGeo = res.geometry;
    newGeo.computeVertexNormals();
    const info = buildMeshInfo(newGeo);
    state.geometry = newGeo;
    state.meshInfo = info;

    viewer3d.setGeometry(newGeo, info);
    seamPicker.bind(viewer3d.mesh, newGeo);
    clearSegmentation();
    // Bestehende Seams sind topologisch nicht mehr gültig nach Dezimierung.
    els.statSeams.textContent = '0';
    els.btnSeamClear.disabled = true;
    els.btnApplyCut.disabled = true;

    // Texturen-UVs sind nach Dezimierung auch ungültig — leise droppen.
    if (graphic.image) {
      els.statGraphic.textContent = `${graphic.image.naturalWidth}×${graphic.image.naturalHeight} (neu projizieren)`;
      viewer3d.setTexture(null);
      viewer2d.setTexture(null);
    }

    refreshMeshStats();
    clearFlattenResults();

    toast(
      `Dezimiert: ${fmtInt(currentFaces)} → ${fmtInt(res.finalFaceCount)} Faces ` +
      `(Fehler ${(res.error * 100).toFixed(3)}% der Diagonale, ${dt.toFixed(0)} ms)`,
      'success',
    );
  } catch (e) {
    console.error(e);
    toast('Dezimierung fehlgeschlagen: ' + e.message, 'error');
  } finally {
    els.btnDecimate.disabled = false;
  }
}

function handleApplyCut() {
  if (!state.geometry) return;
  if (seamPicker.seams.size === 0) {
    toast('Keine Seams markiert.', 'error');
    return;
  }

  try {
    const positions = state.geometry.attributes.position.array;
    const index = state.geometry.index.array;
    const cut = cutMeshAlongSeams(positions, index, seamPicker.seams);
    const added = cut.positions.length / 3 - positions.length / 3;

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(cut.positions, 3));
    newGeo.setIndex(new THREE.BufferAttribute(cut.index, 1));
    newGeo.computeVertexNormals();

    const info = buildMeshInfo(newGeo);
    state.geometry = newGeo;
    state.meshInfo = info;

    viewer3d.setGeometry(newGeo, info);
    seamPicker.bind(viewer3d.mesh, newGeo);
    clearSegmentation();
    els.statSeams.textContent = '0';
    els.btnSeamClear.disabled = true;
    els.btnApplyCut.disabled = true;

    // Grafik-UVs sind nach dem Cut nicht mehr gültig — leise droppen damit
    // die Textur nicht mit Default-(0,0)-UVs blöd auf das Mesh klebt.
    if (graphic.image) {
      els.statGraphic.textContent = `${graphic.image.naturalWidth}×${graphic.image.naturalHeight} (neu projizieren)`;
      viewer3d.setTexture(null);
      viewer2d.setTexture(null);
    }

    refreshMeshStats();
    clearFlattenResults();

    setSeamMode(false);
    toast(`Geschnitten: ${fmtInt(added)} zusätzliche Vertices, ${fmtInt(info.boundaryLoops.length)} Boundary-Loop(s)`, 'success');
  } catch (e) {
    console.error('[apply-cut] error:', e);
    toast('Schnitt fehlgeschlagen: ' + e.message, 'error');
  }
}

function handleExport() {
  if (!state.flatten) return;
  const baseName = state.fileName.replace(/\.[^.]+$/, '') || 'abwicklung';
  const r = state.flatten;

  // Raster nur einbetten wenn Grafik vorhanden und Toggle an.
  let rasterDataURL = null;
  let rasterBounds = null;
  if (graphic.texture && els.toggleRaster.checked && state.geometry.getAttribute('uv')) {
    // Volle Layout-Bbox als Bounds.
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    const uv = r.uv;
    for (let i = 0; i < uv.length; i += 2) {
      if (uv[i] < minU) minU = uv[i]; if (uv[i] > maxU) maxU = uv[i];
      if (uv[i + 1] < minV) minV = uv[i + 1]; if (uv[i + 1] > maxV) maxV = uv[i + 1];
    }
    rasterBounds = { minU, minV, maxU, maxV };
    // 8 px/mm ist ein guter Kompromiss für ~200 dpi Print.
    rasterDataURL = viewer2d.renderRaster(rasterBounds, 8);
  }

  const svg = generateSVG({
    uv: r.uv,
    index: state.geometry.index.array,
    distortion: r.distortion,
    components: r.components,
    componentOf: r.componentOf,
    rasterDataURL,
    rasterBounds,
    unit: 'mm',
    triangulation: false,
    heatmap: els.toggleHeatmap.checked && !rasterDataURL,
    margin: 15,
    label: baseName,
  });
  downloadSVG(svg, `${baseName}-bahnen.svg`);
  toast('SVG exportiert.', 'success');
}

function handleOverviewExport() {
  if (!state.flatten) return;
  const baseName = state.fileName.replace(/\.[^.]+$/, '') || 'abwicklung';
  // Ensure components are visible (not just heatmap) for the overview.
  const wasHeatmap = els.toggleHeatmap.checked;
  if (wasHeatmap) {
    els.toggleHeatmap.checked = false;
    viewer3d.setDistortion(state.flatten.distortion, false);
    viewer2d.setHeatmap(false);
  }
  // Give a frame to update.
  requestAnimationFrame(() => {
    const url = viewer3d.toDataURL(2);
    downloadPNG(url, `${baseName}-uebersicht.png`);
    if (wasHeatmap) {
      els.toggleHeatmap.checked = true;
      viewer3d.setDistortion(state.flatten.distortion, true);
      viewer2d.setHeatmap(true);
    }
    toast('Übersicht exportiert.', 'success');
  });
}

// ---- Events ----

els.fileInput.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (f) handleFile(f);
  // Wert zurücksetzen damit dieselbe Datei erneut geladen werden kann.
  e.target.value = '';
});

['dragover', 'dragenter'].forEach(ev => {
  els.pane3d.addEventListener(ev, e => {
    e.preventDefault();
    if (!seamPicker.active) els.dropHint.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(ev => {
  els.pane3d.addEventListener(ev, e => {
    e.preventDefault();
    els.dropHint.classList.remove('dragover');
  });
});
els.pane3d.addEventListener('drop', e => {
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
});

els.btnFlatten.addEventListener('click', handleFlatten);
els.btnResetView.addEventListener('click', () => {
  viewer3d.resetView();
  viewer2d.resetView();
});
els.btnSeamMode.addEventListener('click', () => setSeamMode(!seamPicker.active));
els.btnSeamClear.addEventListener('click', () => seamPicker.clearSeams());
els.btnApplyCut.addEventListener('click', handleApplyCut);
els.btnDecimate.addEventListener('click', handleDecimate);
els.btnSegment.addEventListener('click', handleSegment);
els.btnRegionMode.addEventListener('click', () => setRegionMode(!regionPicker.active));
els.btnRegionClear.addEventListener('click', () => regionPicker.clearSelection());
els.btnSeamsFromSel.addEventListener('click', handleSeamsFromSelection);
els.btnExport.addEventListener('click', handleExport);
els.btnOverview.addEventListener('click', handleOverviewExport);

els.graphicInput.addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    await graphic.loadFromFile(f);
    els.statGraphic.textContent = `${f.name} (${graphic.image.naturalWidth}×${graphic.image.naturalHeight})`;
    els.btnGraphicProject.disabled = !state.geometry;
    els.btnGraphicClear.disabled = false;
    toast('Grafik geladen. Kamera ausrichten und „Aus Ansicht projizieren" klicken.', 'success');
  } catch (err) {
    console.error(err);
    toast('Grafik konnte nicht geladen werden.', 'error');
  } finally {
    e.target.value = ''; // allow re-upload
  }
});

els.btnGraphicProject.addEventListener('click', () => {
  if (!graphic.image || !state.geometry) return;
  graphic.projectFromCamera(state.geometry, viewer3d.camera, viewer3d.controls.target);
  viewer3d.setTexture(graphic.texture);
  // Falls schon eine Abwicklung vorliegt: neu rendern damit die UVs ankommen.
  if (state.flatten) {
    const index = state.geometry.index.array;
    viewer2d.setUnfold(state.geometry, state.flatten.uv, state.flatten.distortion);
    viewer2d.setTexture(graphic.texture);
    viewer2d.setComponentColors(state.flatten.uv, index, state.flatten.componentOf, state.flatten.componentCount);
    viewer2d.setComponentLabels(state.flatten.uv, index, state.flatten.componentOf, state.flatten.components);
  } else {
    viewer2d.setTexture(graphic.texture);
  }
  toast('Grafik projiziert.', 'success');
});

els.btnGraphicClear.addEventListener('click', () => {
  graphic.clear();
  if (state.geometry?.getAttribute('uv')) state.geometry.deleteAttribute('uv');
  viewer3d.setTexture(null);
  viewer2d.setTexture(null);
  els.statGraphic.textContent = '—';
  els.btnGraphicProject.disabled = true;
  els.btnGraphicClear.disabled = true;
  toast('Grafik entfernt.', '');
});

els.toggleWire.addEventListener('change', e => {
  viewer3d.setWireframe(e.target.checked);
  viewer2d.setWireframe(e.target.checked);
});
els.toggleHeatmap.addEventListener('change', e => {
  const on = e.target.checked;
  viewer3d.setDistortion(state.flatten?.distortion || null, on);
  viewer2d.setHeatmap(on);
  els.legend.hidden = !on;
});

const ro = new ResizeObserver(() => { viewer3d.resize(); viewer2d.resize(); });
ro.observe(els.canvas3d.parentElement);
ro.observe(els.canvas2d.parentElement);
