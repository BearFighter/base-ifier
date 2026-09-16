import type { Bounds3, IndexedMesh, Soup } from '../types';

export interface ComponentsResult {
  /** Component label (0..count-1) for each triangle, indexed the same as the soup. */
  triLabel: Int32Array;
  /** Number of distinct components. */
  count: number;
  /** Triangle count per label. */
  triCounts: Int32Array;
  /** Component label for each welded vertex. */
  vertexLabel: Int32Array;
}

function find(parent: Int32Array, x: number): number {
  let root = x;
  while (parent[root] !== root) root = parent[root];
  while (parent[x] !== root) {
    const next = parent[x];
    parent[x] = root;
    x = next;
  }
  return root;
}

function union(parent: Int32Array, rank: Uint8Array, a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra === rb) return;
  if (rank[ra] < rank[rb]) {
    parent[ra] = rb;
  } else if (rank[ra] > rank[rb]) {
    parent[rb] = ra;
  } else {
    parent[rb] = ra;
    rank[ra]++;
  }
}

/**
 * Connected components of a welded mesh via union-find over vertices.
 * Triangles are numbered identically to the source soup, so `triLabel`
 * indexes the soup's triangles directly.
 */
export function connectedComponents(mesh: IndexedMesh): ComponentsResult {
  const { vertexCount, indices, triCount } = mesh;
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const rank = new Uint8Array(vertexCount);

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];
    union(parent, rank, i0, i1);
    union(parent, rank, i1, i2);
  }

  // Compact root indices to labels 0..count-1, in order of first encounter.
  const rootLabel = new Int32Array(vertexCount).fill(-1);
  const vertexLabel = new Int32Array(vertexCount);
  let count = 0;
  for (let v = 0; v < vertexCount; v++) {
    const root = find(parent, v);
    let label = rootLabel[root];
    if (label === -1) {
      label = count++;
      rootLabel[root] = label;
    }
    vertexLabel[v] = label;
  }

  const triLabel = new Int32Array(triCount);
  const triCounts = new Int32Array(count);
  for (let t = 0; t < triCount; t++) {
    const label = vertexLabel[indices[t * 3]];
    triLabel[t] = label;
    triCounts[label]++;
  }

  return { triLabel, count, triCounts, vertexLabel };
}

export function extractComponent(soup: Soup, triLabel: Int32Array, label: number): Soup {
  const src = soup.positions;
  let n = 0;
  for (let t = 0; t < soup.triCount; t++) if (triLabel[t] === label) n++;

  const positions = new Float32Array(n * 9);
  let o = 0;
  for (let t = 0; t < soup.triCount; t++) {
    if (triLabel[t] === label) {
      positions.set(src.subarray(t * 9, t * 9 + 9), o);
      o += 9;
    }
  }
  return { positions, triCount: n };
}

/** Extracts triangles whose label is any of the given labels. */
export function extractComponents(soup: Soup, triLabel: Int32Array, labels: Iterable<number>): Soup {
  const wanted = new Set<number>(labels);
  const src = soup.positions;
  let n = 0;
  for (let t = 0; t < soup.triCount; t++) if (wanted.has(triLabel[t])) n++;

  const positions = new Float32Array(n * 9);
  let o = 0;
  for (let t = 0; t < soup.triCount; t++) {
    if (wanted.has(triLabel[t])) {
      positions.set(src.subarray(t * 9, t * 9 + 9), o);
      o += 9;
    }
  }
  return { positions, triCount: n };
}

/** Per-label axis-aligned bounds, indexed the same as `comps`'s labels. */
export function componentBounds(mesh: IndexedMesh, comps: ComponentsResult): Bounds3[] {
  const bounds: Bounds3[] = [];
  for (let i = 0; i < comps.count; i++) {
    bounds.push({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  }

  const { vertices, vertexCount } = mesh;
  const { vertexLabel } = comps;
  for (let v = 0; v < vertexCount; v++) {
    const b = bounds[vertexLabel[v]];
    const x = vertices[v * 3], y = vertices[v * 3 + 1], z = vertices[v * 3 + 2];
    if (x < b.min[0]) b.min[0] = x;
    if (y < b.min[1]) b.min[1] = y;
    if (z < b.min[2]) b.min[2] = z;
    if (x > b.max[0]) b.max[0] = x;
    if (y > b.max[1]) b.max[1] = y;
    if (z > b.max[2]) b.max[2] = z;
  }
  return bounds;
}
