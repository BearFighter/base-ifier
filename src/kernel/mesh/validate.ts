import type { IndexedMesh, Soup } from '../types';
import { weld } from './weld';

export interface ManifoldReport {
  /** Number of distinct undirected edges. */
  edges: number;
  /** Edges used by exactly one triangle. */
  boundaryEdges: number;
  /** Edges used by more than two triangles. */
  nonManifoldEdges: number;
  watertight: boolean;
}

/**
 * Counts occurrences of each undirected edge (min vertex index, max vertex
 * index) by packing each pair into a single sortable number and sorting a
 * typed array of those keys, rather than using a Map of strings — this
 * scales to millions of edges.
 */
export function manifoldReport(mesh: IndexedMesh): ManifoldReport {
  const { indices, triCount, vertexCount } = mesh;
  const edgeSlots = triCount * 3;
  const keys = new Float64Array(edgeSlots);

  // Pack (lo, hi) as lo*mult + hi. Since 0 <= hi < vertexCount = mult, this
  // is a unique base-`mult` encoding, and for realistic mesh sizes (up to
  // low tens of millions of vertices) lo*mult+hi stays well within
  // Number.MAX_SAFE_INTEGER, so no precision is lost.
  const mult = Math.max(vertexCount, 1);

  let k = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    keys[k++] = (i0 < i1 ? i0 : i1) * mult + (i0 < i1 ? i1 : i0);
    keys[k++] = (i1 < i2 ? i1 : i2) * mult + (i1 < i2 ? i2 : i1);
    keys[k++] = (i2 < i0 ? i2 : i0) * mult + (i2 < i0 ? i0 : i2);
  }

  // TypedArray#sort defaults to numeric ascending order (unlike Array#sort).
  keys.sort();

  let edges = 0;
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;

  let i = 0;
  while (i < edgeSlots) {
    let j = i + 1;
    while (j < edgeSlots && keys[j] === keys[i]) j++;
    const occurrences = j - i;
    edges++;
    if (occurrences === 1) boundaryEdges++;
    else if (occurrences > 2) nonManifoldEdges++;
    i = j;
  }

  const watertight = edges > 0 && boundaryEdges === 0 && nonManifoldEdges === 0;

  return { edges, boundaryEdges, nonManifoldEdges, watertight };
}

/** Welds the soup and reports whether the resulting mesh is closed and manifold. */
export function isWatertight(soup: Soup): boolean {
  return manifoldReport(weld(soup)).watertight;
}
