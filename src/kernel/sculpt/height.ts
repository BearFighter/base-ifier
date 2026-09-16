/**
 * Vertical height queries on the sculpt: what is the top (and bottom) surface
 * height at a point, and how thick is the material over a footprint. Used to
 * decide whether a cut base needs a plate under it, where a plug's floor goes,
 * and to offer plug cuts on tall terrain.
 */
import type { IndexedMesh, Polygon2, Vec2 } from '../types';
import { collectTriangles, type Bins } from './bins';
import { insetConvex } from '../geom2d/offset';
import { pointInConvexPolygon, polygonBounds } from '../geom2d/polygon';

export interface HeightSample {
  top: number;
  bottom: number;
}

/** Highest and lowest surface z on the vertical line through (x, y), or null when the mesh is not there. */
export function heightsAt(mesh: IndexedMesh, bins: Bins | null, x: number, y: number): HeightSample | null {
  const V = mesh.vertices, I = mesh.indices;
  let top = -Infinity, bottom = Infinity;
  const test = (t: number) => {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ax = V[a], ay = V[a + 1], bx = V[b], by = V[b + 1], cx = V[c], cy = V[c + 1];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) return;
    const l0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const l1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    const l2 = 1 - l0 - l1;
    const eps = -1e-9;
    if (l0 < eps || l1 < eps || l2 < eps) return;
    const z = l0 * V[a + 2] + l1 * V[b + 2] + l2 * V[c + 2];
    if (z > top) top = z;
    if (z < bottom) bottom = z;
  };
  if (bins) {
    const ids = collectTriangles(bins, x, y, x, y);
    for (let i = 0; i < ids.length; i++) test(ids[i]);
  } else {
    for (let t = 0; t < mesh.triCount; t++) test(t);
  }
  return top === -Infinity ? null : { top, bottom };
}

export interface ColumnStats {
  /** grid points that hit the mesh */
  samples: number;
  /** grid points inside the footprint that hit nothing (holes in the terrain) */
  misses: number;
  minTop: number;
  maxTop: number;
  minBottom: number;
  maxBottom: number;
}

/**
 * Sample the material column over a footprint polygon on a grid (`step` mm,
 * inset a little from the edge so the edge itself is not sampled). Returns
 * null when nothing under the footprint hits the mesh.
 */
export function columnStats(mesh: IndexedMesh, bins: Bins | null, footprint: Polygon2, step = 1.5): ColumnStats | null {
  const inner = insetConvex(footprint, 0.3);
  const poly = inner.length >= 3 ? inner : footprint;
  const b = polygonBounds(poly);
  const pts: Vec2[] = [];
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  const nx = Math.ceil((b.max[0] - b.min[0]) / step), ny = Math.ceil((b.max[1] - b.min[1]) / step);
  for (let j = -ny; j <= ny; j++) {
    for (let i = -nx; i <= nx; i++) {
      const x = cx + i * step, y = cy + j * step;
      if (x < b.min[0] || x > b.max[0] || y < b.min[1] || y > b.max[1]) continue;
      if (pointInConvexPolygon(poly, x, y)) pts.push([x, y]);
    }
  }
  for (const p of poly) pts.push(p);
  if (pts.length === 0) pts.push([cx, cy]);
  let samples = 0, misses = 0, minTop = Infinity, maxTop = -Infinity, minBottom = Infinity, maxBottom = -Infinity;
  for (const [x, y] of pts) {
    const h = heightsAt(mesh, bins, x, y);
    if (!h) { misses++; continue; }
    samples++;
    if (h.top < minTop) minTop = h.top;
    if (h.top > maxTop) maxTop = h.top;
    if (h.bottom < minBottom) minBottom = h.bottom;
    if (h.bottom > maxBottom) maxBottom = h.bottom;
  }
  if (samples === 0) return null;
  return { samples, misses, minTop, maxTop, minBottom, maxBottom };
}
