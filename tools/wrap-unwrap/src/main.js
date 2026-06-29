import * as THREE from 'three';
import { Viewer3D } from './viewer3d.js';
import { Viewer2D } from './viewer2d.js';
import { loadOBJ } from './loaders/obj.js';
import { loadSTL } from './loaders/stl.js';
import { buildMeshInfo } from './mesh-info.js';
import { flattenLSCM } from './flatten/lscm.js';
import { computeDistortion } from './flatten/distortion.js';

const els = {
  canvas3d:       document.getElementById('canvas-3d'),
  canvas2d:       document.getElementById('canvas-2d'),
  fileInput:      document.getElementById('file-input'),
  dropHint:       document.getElementById('drop-hint'),
  placeholder2d:  document.getElementById('placeholder-2d'),
  btnFlatten:     document.getElementById('btn-flatten'),
  btnResetView:   document.getElementById('btn-reset-view'),
  toggleWire:     document.getElementById('toggle-wire'),
  toggleHeatmap:  document.getElementById('toggle-heatmap'),
  legend:         document.getElementById('legend'),
  toast:          document.getElementById('toast'),
  pane3d:         document.getElementById('pane-3d'),
  statVerts:      document.getElementById('stat-verts'),
  statFaces:      document.getElementById('stat-faces'),
  statSize:       document.getElementById('stat-size'),
  statBoundary:   document.getElementById('stat-boundary'),
  statFlattenStatus: document.getElementById('stat-flatten-status'),
  statIters:      document.getElementById('stat-iters'),
  statDistAvg:    document.getElementById('stat-dist-avg'),
  statDistMax:    document.getElementById('stat-dist-max'),
};

const state = {
  geometry: null,
  meshInfo: null,
  uv: null,
  distortion: null,
};

const viewer3d = new Viewer3D(els.canvas3d);
const viewer2d = new Viewer2D(els.canvas2d);

function toast(msg, kind = '') {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (kind ? ' ' + kind : '');
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

function fmtInt(n) { return n.toLocaleString('de-DE'); }
function fmtPct(x) { return (x * 100).toFixed(1) + ' %'; }

async function handleFile(file) {
  const name = file.name.toLowerCase();
  let geometry;
  try {
    const buf = await file.arrayBuffer();
    if (name.endsWith('.obj')) {
      geometry = loadOBJ(new TextDecoder().decode(buf));
    } else if (name.endsWith('.stl')) {
      geometry = loadSTL(buf);
    } else {
      toast('Nur OBJ oder STL.', 'error');
      return;
    }
  } catch (e) {
    console.error(e);
    toast('Datei konnte nicht gelesen werden: ' + e.message, 'error');
    return;
  }

  if (!geometry || geometry.attributes.position.count === 0) {
    toast('Mesh ist leer.', 'error');
    return;
  }

  geometry.computeVertexNormals();
  const info = buildMeshInfo(geometry);

  state.geometry = geometry;
  state.meshInfo = info;
  state.uv = null;
  state.distortion = null;

  viewer3d.setGeometry(geometry, info);
  viewer2d.clear();

  els.statVerts.textContent = fmtInt(info.vertexCount);
  els.statFaces.textContent = fmtInt(info.faceCount);
  const s = info.boundingSize;
  els.statSize.textContent = `${s.x.toFixed(0)} × ${s.y.toFixed(0)} × ${s.z.toFixed(0)}`;
  els.statBoundary.textContent = info.boundaryLoops.length === 0
    ? 'geschlossen'
    : `${info.boundaryLoops.length} Loop(s)`;
  els.statFlattenStatus.textContent = '—';
  els.statIters.textContent = '—';
  els.statDistAvg.textContent = '—';
  els.statDistMax.textContent = '—';

  els.dropHint.classList.add('hidden');
  els.btnFlatten.disabled = false;
  els.btnResetView.disabled = false;

  toast(`Geladen: ${fmtInt(info.vertexCount)} Vertices, ${fmtInt(info.faceCount)} Faces`, 'success');
}

async function handleFlatten() {
  if (!state.geometry || !state.meshInfo) return;
  els.statFlattenStatus.textContent = 'läuft …';
  els.btnFlatten.disabled = true;

  // Yield so the UI can repaint before we hog the main thread.
  await new Promise(r => setTimeout(r, 16));

  try {
    const result = flattenLSCM(state.geometry, state.meshInfo);
    if (!result.ok) {
      els.statFlattenStatus.textContent = 'Fehler';
      toast('Abwicklung fehlgeschlagen: ' + result.error, 'error');
      els.btnFlatten.disabled = false;
      return;
    }
    state.uv = result.uv;
    state.distortion = computeDistortion(state.geometry, result.uv);

    els.statFlattenStatus.textContent = 'ok';
    els.statIters.textContent = fmtInt(result.iterations);
    els.statDistAvg.textContent = fmtPct(state.distortion.avg);
    els.statDistMax.textContent = fmtPct(state.distortion.max);

    viewer2d.setUnfold(state.geometry, result.uv, state.distortion);
    viewer3d.setDistortion(state.distortion, els.toggleHeatmap.checked);
    els.placeholder2d.classList.add('hidden');
  } catch (e) {
    console.error(e);
    els.statFlattenStatus.textContent = 'Fehler';
    toast('Abwicklung fehlgeschlagen: ' + e.message, 'error');
  } finally {
    els.btnFlatten.disabled = false;
  }
}

// ---- Events ----

els.fileInput.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (f) handleFile(f);
});

['dragover', 'dragenter'].forEach(ev => {
  els.pane3d.addEventListener(ev, e => {
    e.preventDefault();
    els.dropHint.classList.add('dragover');
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

els.toggleWire.addEventListener('change', e => {
  viewer3d.setWireframe(e.target.checked);
  viewer2d.setWireframe(e.target.checked);
});
els.toggleHeatmap.addEventListener('change', e => {
  const on = e.target.checked;
  viewer3d.setDistortion(state.distortion, on);
  viewer2d.setHeatmap(on);
  els.legend.hidden = !on;
});

// Resize handling
const ro = new ResizeObserver(() => { viewer3d.resize(); viewer2d.resize(); });
ro.observe(els.canvas3d.parentElement);
ro.observe(els.canvas2d.parentElement);
