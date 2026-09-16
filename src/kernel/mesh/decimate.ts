/**
 * Display-only mesh simplification by vertex clustering: vertices are snapped to
 * a uniform grid (averaged per cell) and triangles that collapse are dropped.
 * Fast (O(n)), tolerant of non-manifold input, and good enough for previewing
 * multi-million-triangle sculpts. Never used for export.
 */
import type { IndexedMesh, Soup } from '../types';

export interface DecimateResult {
  mesh: IndexedMesh;
  cell: number;
  inputTriangles: number;
}

/** Cluster a triangle soup on a grid of `cell` mm. */
export function decimateSoup(soup: Soup, cell: number): DecimateResult {
  const P = soup.positions;
  const n = soup.triCount;
  const nv = n * 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
  }
  const inv = 1 / cell;
  const cellOf = new Map<number, number>();
  const vertCell = new Uint32Array(nv);
  let count = 0;
  // key packs three grid indices; bases sized so the key stays below 2^53
  const B = 1 << 20;
  for (let i = 0; i < nv; i++) {
    const gx = Math.floor((P[i * 3] - minX) * inv), gy = Math.floor((P[i * 3 + 1] - minY) * inv), gz = Math.floor((P[i * 3 + 2] - minZ) * inv);
    const key = (gx * B + gy) * B + gz;
    let id = cellOf.get(key);
    if (id === undefined) { id = count++; cellOf.set(key, id); }
    vertCell[i] = id;
  }
  const sums = new Float64Array(count * 3);
  const counts = new Uint32Array(count);
  for (let i = 0; i < nv; i++) {
    const c = vertCell[i];
    sums[c * 3] += P[i * 3]; sums[c * 3 + 1] += P[i * 3 + 1]; sums[c * 3 + 2] += P[i * 3 + 2];
    counts[c]++;
  }
  const vertices = new Float32Array(count * 3);
  for (let c = 0; c < count; c++) {
    const k = counts[c] || 1;
    vertices[c * 3] = sums[c * 3] / k; vertices[c * 3 + 1] = sums[c * 3 + 1] / k; vertices[c * 3 + 2] = sums[c * 3 + 2] / k;
  }
  const idx = new Uint32Array(n * 3);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const a = vertCell[i * 3], b = vertCell[i * 3 + 1], c = vertCell[i * 3 + 2];
    if (a === b || b === c || c === a) continue;
    idx[t * 3] = a; idx[t * 3 + 1] = b; idx[t * 3 + 2] = c;
    t++;
  }
  return { mesh: { vertices, vertexCount: count, indices: idx.slice(0, t * 3), triCount: t }, cell, inputTriangles: n };
}

/** Indexed mesh → soup view (copy) for the clustering routine. */
function meshToSoup(m: IndexedMesh): Soup {
  const positions = new Float32Array(m.triCount * 9);
  for (let t = 0; t < m.triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const i = m.indices[t * 3 + v] * 3;
      positions[t * 9 + v * 3] = m.vertices[i]; positions[t * 9 + v * 3 + 1] = m.vertices[i + 1]; positions[t * 9 + v * 3 + 2] = m.vertices[i + 2];
    }
  }
  return { positions, triCount: m.triCount };
}

/**
 * Simplify for display down to roughly `targetTris`, starting at a fine grid
 * and coarsening until the target is met (at most 4 passes).
 */
export function decimateForDisplay(input: Soup | IndexedMesh, targetTris = 400_000): DecimateResult {
  const soup: Soup = 'indices' in input ? meshToSoup(input) : input;
  let cell = 0.15;
  let res = decimateSoup(soup, cell);
  for (let pass = 0; pass < 4 && res.mesh.triCount > targetTris * 1.25; pass++) {
    cell *= 1.5;
    res = decimateSoup(soup, cell);
  }
  return res;
}
