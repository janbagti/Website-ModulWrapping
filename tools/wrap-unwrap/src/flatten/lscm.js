// Least-Squares Conformal Maps (Lévy et al. 2002, SIGGRAPH).
//
// Idee: Pro Dreieck schreibt man die Cauchy-Riemann-Bedingung über die
// lokalen 2D-Koordinaten der Triangel. Stapelt man alle Triangel in eine
// sparse Matrix M (2*F Zeilen, 2*V Spalten) und pinnt zwei UV-Werte, ergibt
// sich ein lineares Ausgleichsproblem:
//
//     min || M_free * x_free + M_pinned * x_pinned ||²
//
// Normalengleichungen:
//
//     (M_free^T M_free) * x_free = -M_free^T (M_pinned * x_pinned)
//
// Wir lösen ohne M_free^T M_free explizit zu bilden – Conjugate-Gradient
// auf der Operator-Form. Das ist O(nnz) pro Iteration und für unsere
// Mesh-Größen (≤ 200k Vertices) absolut tauglich im Browser.

const TOL = 1e-7;
const MAX_ITERS = 1500;

export function flattenLSCM(geometry, info) {
  const positions = geometry.attributes.position.array;
  const index = geometry.index.array;
  const vertCount = info.vertexCount;
  const faceCount = info.faceCount;

  if (info.boundaryLoops.length === 0) {
    return {
      ok: false,
      error: 'Mesh ist geschlossen — ohne Schnittlinien (Seams) gibt es nichts abzuwickeln.',
    };
  }

  const loop = info.boundaryLoops[0];
  // Zwei Pin-Vertices auf dem größten Rand, möglichst weit auseinander.
  // Fixiert Translation, Rotation und Skalierung. Den weitesten Abstand
  // finden wir mit 2x Farthest-Point: start beliebig, finde am weitesten
  // entfernten Punkt, dann von dort wieder den am weitesten entfernten.
  // Das ist eine 2-Approximation, in der Praxis fast immer perfekt.
  const farthestFrom = (idx) => {
    const px = positions[idx * 3], py = positions[idx * 3 + 1], pz = positions[idx * 3 + 2];
    let best = idx, bestD = -1;
    for (const v of loop) {
      const dx = positions[v * 3] - px;
      const dy = positions[v * 3 + 1] - py;
      const dz = positions[v * 3 + 2] - pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > bestD) { bestD = d; best = v; }
    }
    return best;
  };
  const pinA = farthestFrom(loop[0]);
  const pinB = farthestFrom(pinA);
  if (pinA === pinB) {
    return { ok: false, error: 'Boundary-Loop zu klein.' };
  }

  // Sparse-Matrix M als Triplets: (row, col, val).
  // Pro Dreieck 12 Einträge (2 Zeilen × 6 Spalten).
  const nnz = faceCount * 12;
  const rows = new Int32Array(nnz);
  const cols = new Int32Array(nnz);
  const vals = new Float64Array(nnz);

  const e1 = [0, 0, 0], e2 = [0, 0, 0], normal = [0, 0, 0];
  let triplet = 0;

  for (let f = 0; f < faceCount; f++) {
    const i0 = index[f * 3];
    const i1 = index[f * 3 + 1];
    const i2 = index[f * 3 + 2];

    const p0x = positions[i0 * 3],     p0y = positions[i0 * 3 + 1], p0z = positions[i0 * 3 + 2];
    const p1x = positions[i1 * 3],     p1y = positions[i1 * 3 + 1], p1z = positions[i1 * 3 + 2];
    const p2x = positions[i2 * 3],     p2y = positions[i2 * 3 + 1], p2z = positions[i2 * 3 + 2];

    e1[0] = p1x - p0x; e1[1] = p1y - p0y; e1[2] = p1z - p0z;
    e2[0] = p2x - p0x; e2[1] = p2y - p0y; e2[2] = p2z - p0z;

    // Normale und Fläche
    normal[0] = e1[1] * e2[2] - e1[2] * e2[1];
    normal[1] = e1[2] * e2[0] - e1[0] * e2[2];
    normal[2] = e1[0] * e2[1] - e1[1] * e2[0];
    const twoA = Math.hypot(normal[0], normal[1], normal[2]);
    if (twoA < 1e-14) {
      // Degeneriertes Dreieck – Beitrag = 0, einfach überspringen.
      // Wir füllen trotzdem 12 Triples mit Nullen damit die Indizierung stimmt.
      for (let k = 0; k < 12; k++) { rows[triplet] = 0; cols[triplet] = 0; vals[triplet] = 0; triplet++; }
      continue;
    }
    const area = twoA * 0.5;
    const sqrtA = Math.sqrt(area);

    // Lokale 2D-Basis: x-Achse entlang e1, y-Achse senkrecht im Triangleplane.
    const e1len = Math.hypot(e1[0], e1[1], e1[2]);
    const ux = e1[0] / e1len, uy = e1[1] / e1len, uz = e1[2] / e1len;

    // n = normal / |normal|
    const nx = normal[0] / twoA, ny = normal[1] / twoA, nz = normal[2] / twoA;

    // v = n × u
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;

    // Lokale Koordinaten
    const X1 = 0, Y1 = 0;
    const X2 = e1len, Y2 = 0;
    const X3 = e2[0] * ux + e2[1] * uy + e2[2] * uz;
    const Y3 = e2[0] * vx + e2[1] * vy + e2[2] * vz;

    // LSCM Constraint (komplex):
    //   (W3 - W2) * U1 + (W1 - W3) * U2 + (W2 - W1) * U3 = 0
    // mit W_k = X_k + i*Y_k.
    //
    // Reell aufgespalten in 2 Gleichungen (Real, Imag).
    // Gewichtet mit sqrt(A) wie in Mullen/Lévy üblich, damit das Energiefunktional richtig integriert.
    const dx1 = X3 - X2, dy1 = Y3 - Y2;
    const dx2 = X1 - X3, dy2 = Y1 - Y3;
    const dx3 = X2 - X1, dy3 = Y2 - Y1;

    const rowR = f * 2;
    const rowI = f * 2 + 1;

    // U_k = (u_k, v_k) -> Spalten 2k, 2k+1
    // (a + ib)(u + iv) = (au - bv) + i(av + bu)
    // Real-Teil:  dx1*u1 - dy1*v1 + dx2*u2 - dy2*v2 + dx3*u3 - dy3*v3 = 0
    // Imag-Teil:  dy1*u1 + dx1*v1 + dy2*u2 + dx2*v2 + dy3*u3 + dx3*v3 = 0

    // Real
    rows[triplet] = rowR; cols[triplet] = i0 * 2;     vals[triplet] =  dx1 * sqrtA; triplet++;
    rows[triplet] = rowR; cols[triplet] = i0 * 2 + 1; vals[triplet] = -dy1 * sqrtA; triplet++;
    rows[triplet] = rowR; cols[triplet] = i1 * 2;     vals[triplet] =  dx2 * sqrtA; triplet++;
    rows[triplet] = rowR; cols[triplet] = i1 * 2 + 1; vals[triplet] = -dy2 * sqrtA; triplet++;
    rows[triplet] = rowR; cols[triplet] = i2 * 2;     vals[triplet] =  dx3 * sqrtA; triplet++;
    rows[triplet] = rowR; cols[triplet] = i2 * 2 + 1; vals[triplet] = -dy3 * sqrtA; triplet++;
    // Imag
    rows[triplet] = rowI; cols[triplet] = i0 * 2;     vals[triplet] =  dy1 * sqrtA; triplet++;
    rows[triplet] = rowI; cols[triplet] = i0 * 2 + 1; vals[triplet] =  dx1 * sqrtA; triplet++;
    rows[triplet] = rowI; cols[triplet] = i1 * 2;     vals[triplet] =  dy2 * sqrtA; triplet++;
    rows[triplet] = rowI; cols[triplet] = i1 * 2 + 1; vals[triplet] =  dx2 * sqrtA; triplet++;
    rows[triplet] = rowI; cols[triplet] = i2 * 2;     vals[triplet] =  dy3 * sqrtA; triplet++;
    rows[triplet] = rowI; cols[triplet] = i2 * 2 + 1; vals[triplet] =  dx3 * sqrtA; triplet++;
  }

  // Pinned UVs: Achse durch pinA -> pinB. Skalierung ist willkürlich,
  // wir setzen pinA = (0,0), pinB = (D, 0) wobei D = 3D-Abstand zwischen den Pins.
  // So liefert LSCM nachher ein UV-Layout mit grob den Original-Maßen.
  const dx = positions[pinB * 3] - positions[pinA * 3];
  const dy = positions[pinB * 3 + 1] - positions[pinA * 3 + 1];
  const dz = positions[pinB * 3 + 2] - positions[pinA * 3 + 2];
  const D = Math.hypot(dx, dy, dz);

  const pinnedCols = new Set([pinA * 2, pinA * 2 + 1, pinB * 2, pinB * 2 + 1]);
  const pinnedValues = new Map([
    [pinA * 2, 0],
    [pinA * 2 + 1, 0],
    [pinB * 2, D],
    [pinB * 2 + 1, 0],
  ]);

  // Mapping freie Spalten -> reduzierter Index.
  const nVars = vertCount * 2;
  const freeIndex = new Int32Array(nVars); // alt -> neu
  let nFree = 0;
  for (let c = 0; c < nVars; c++) {
    if (pinnedCols.has(c)) freeIndex[c] = -1;
    else { freeIndex[c] = nFree++; }
  }

  // Triplets aufteilen.
  // M_free als (row, freeCol, val), M_pinned-Beitrag direkt in b einrechnen.
  const nRows = faceCount * 2;
  const b = new Float64Array(nRows);

  const freeRows = new Int32Array(triplet);
  const freeCols = new Int32Array(triplet);
  const freeVals = new Float64Array(triplet);
  let freeNNZ = 0;

  for (let k = 0; k < triplet; k++) {
    const c = cols[k];
    const v = vals[k];
    if (pinnedCols.has(c)) {
      // Wandert auf die rechte Seite: b -= v * pinnedValue
      b[rows[k]] -= v * pinnedValues.get(c);
    } else {
      freeRows[freeNNZ] = rows[k];
      freeCols[freeNNZ] = freeIndex[c];
      freeVals[freeNNZ] = v;
      freeNNZ++;
    }
  }

  // M_free * x  (Operator)
  const applyM = (x, out) => {
    out.fill(0);
    for (let k = 0; k < freeNNZ; k++) {
      out[freeRows[k]] += freeVals[k] * x[freeCols[k]];
    }
  };
  // M_free^T * y
  const applyMT = (y, out) => {
    out.fill(0);
    for (let k = 0; k < freeNNZ; k++) {
      out[freeCols[k]] += freeVals[k] * y[freeRows[k]];
    }
  };

  // Diagonale von M^T M  (für Jacobi-Preconditioner).
  const diag = new Float64Array(nFree);
  for (let k = 0; k < freeNNZ; k++) {
    diag[freeCols[k]] += freeVals[k] * freeVals[k];
  }
  const Minv = new Float64Array(nFree);
  for (let i = 0; i < nFree; i++) Minv[i] = diag[i] > 1e-14 ? 1 / diag[i] : 1;

  // Rechte Seite: rhs = M^T b
  const rhs = new Float64Array(nFree);
  applyMT(b, rhs);

  // Preconditioned Conjugate Gradient auf (M^T M) x = rhs.
  const x = new Float64Array(nFree);
  const r = new Float64Array(nFree);
  const z = new Float64Array(nFree);
  const p = new Float64Array(nFree);
  const tmp = new Float64Array(nRows);
  const Ap = new Float64Array(nFree);

  // r = rhs - (M^T M) x   (x=0, also r = rhs)
  for (let i = 0; i < nFree; i++) r[i] = rhs[i];
  for (let i = 0; i < nFree; i++) z[i] = Minv[i] * r[i];
  for (let i = 0; i < nFree; i++) p[i] = z[i];

  let rz = 0;
  for (let i = 0; i < nFree; i++) rz += r[i] * z[i];

  const rhsNorm = Math.sqrt(rhs.reduce((s, v) => s + v * v, 0)) || 1;

  let iters = 0;
  let lastResidual = Infinity;
  for (let k = 0; k < MAX_ITERS; k++) {
    // Ap = M^T (M p)
    applyM(p, tmp);
    applyMT(tmp, Ap);

    let pAp = 0;
    for (let i = 0; i < nFree; i++) pAp += p[i] * Ap[i];
    if (Math.abs(pAp) < 1e-30) break;

    const alpha = rz / pAp;
    for (let i = 0; i < nFree; i++) x[i] += alpha * p[i];
    for (let i = 0; i < nFree; i++) r[i] -= alpha * Ap[i];

    let rNorm = 0;
    for (let i = 0; i < nFree; i++) rNorm += r[i] * r[i];
    rNorm = Math.sqrt(rNorm);
    lastResidual = rNorm / rhsNorm;
    iters = k + 1;
    if (lastResidual < TOL) break;

    for (let i = 0; i < nFree; i++) z[i] = Minv[i] * r[i];
    let rzNew = 0;
    for (let i = 0; i < nFree; i++) rzNew += r[i] * z[i];
    const beta = rzNew / rz;
    for (let i = 0; i < nFree; i++) p[i] = z[i] + beta * p[i];
    rz = rzNew;
  }

  // UV-Array zusammensetzen.
  const uv = new Float32Array(vertCount * 2);
  for (let v = 0; v < vertCount; v++) {
    const cu = v * 2, cv = v * 2 + 1;
    uv[cu] = pinnedCols.has(cu) ? pinnedValues.get(cu) : x[freeIndex[cu]];
    uv[cv] = pinnedCols.has(cv) ? pinnedValues.get(cv) : x[freeIndex[cv]];
  }

  return {
    ok: true,
    uv,
    iterations: iters,
    residual: lastResidual,
    pins: [pinA, pinB],
  };
}
