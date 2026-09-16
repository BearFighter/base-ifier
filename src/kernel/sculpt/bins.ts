/**
 * Uniform XY grid over an indexed mesh's triangles (CSR layout) so that a convex
 * prism cut only visits triangles near the cutter.
 */
import type { IndexedMesh } from '../types';

export interface Bins {
  cell: number;
  minX: number;
  minY: number;
  nx: number;
  ny: number;
  /** length nx*ny+1 */
  cellStart: Uint32Array;
  /** triangle ids, grouped by cell */
  tris: Uint32Array;
  triCount: number;
}

export function buildBins(mesh: IndexedMesh, cell = 2): Bins {
  const V = mesh.vertices, I = mesh.indices, nT = mesh.triCount;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = V[i * 3], y = V[i * 3 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!(minX <= maxX)) { minX = minY = 0; maxX = maxY = 0; }
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const counts = new Uint32Array(nx * ny + 1);
  const tb = new Int32Array(nT * 4); // cx0, cy0, cx1, cy1 per triangle
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const x0 = Math.min(V[a * 3], V[b * 3], V[c * 3]), x1 = Math.max(V[a * 3], V[b * 3], V[c * 3]);
    const y0 = Math.min(V[a * 3 + 1], V[b * 3 + 1], V[c * 3 + 1]), y1 = Math.max(V[a * 3 + 1], V[b * 3 + 1], V[c * 3 + 1]);
    const cx0 = clampi(Math.floor((x0 - minX) / cell), 0, nx - 1), cx1 = clampi(Math.floor((x1 - minX) / cell), 0, nx - 1);
    const cy0 = clampi(Math.floor((y0 - minY) / cell), 0, ny - 1), cy1 = clampi(Math.floor((y1 - minY) / cell), 0, ny - 1);
    tb[t * 4] = cx0; tb[t * 4 + 1] = cy0; tb[t * 4 + 2] = cx1; tb[t * 4 + 3] = cy1;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) counts[cy * nx + cx + 1]++;
  }
  const cellStart = new Uint32Array(nx * ny + 1);
  for (let i = 0; i < nx * ny; i++) cellStart[i + 1] = cellStart[i] + counts[i + 1];
  const fill = cellStart.slice(0, nx * ny);
  const tris = new Uint32Array(cellStart[nx * ny]);
  for (let t = 0; t < nT; t++) {
    const cx0 = tb[t * 4], cy0 = tb[t * 4 + 1], cx1 = tb[t * 4 + 2], cy1 = tb[t * 4 + 3];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * nx + cx;
      tris[fill[c]++] = t;
    }
  }
  return { cell, minX, minY, nx, ny, cellStart, tris, triCount: nT };
}

function clampi(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Collect triangle ids from all cells overlapping [x0,x1]x[y0,y1], optionally
 * filtered by a per-cell predicate on the cell's rectangle. Ids may repeat.
 */
export function collectTriangles(
  bins: Bins,
  x0: number, y0: number, x1: number, y1: number,
  cellFilter?: (cx0: number, cy0: number, cx1: number, cy1: number) => boolean,
): Uint32Array {
  const { cell, minX, minY, nx, ny, cellStart, tris } = bins;
  const cx0 = clampi(Math.floor((x0 - minX) / cell), 0, nx - 1), cx1 = clampi(Math.floor((x1 - minX) / cell), 0, nx - 1);
  const cy0 = clampi(Math.floor((y0 - minY) / cell), 0, ny - 1), cy1 = clampi(Math.floor((y1 - minY) / cell), 0, ny - 1);
  let total = 0;
  const cells: number[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (cellFilter) {
        const rx0 = minX + cx * cell, ry0 = minY + cy * cell;
        if (!cellFilter(rx0, ry0, rx0 + cell, ry0 + cell)) continue;
      }
      const c = cy * nx + cx;
      const len = cellStart[c + 1] - cellStart[c];
      if (len === 0) continue;
      cells.push(c);
      total += len;
    }
  }
  const out = new Uint32Array(total);
  let off = 0;
  for (const c of cells) {
    const s = cellStart[c], e = cellStart[c + 1];
    out.set(tris.subarray(s, e), off);
    off += e - s;
  }
  return out;
}
