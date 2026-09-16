/**
 * Convex polygon edge insetting (a straight-skeleton-free offset for convex
 * loops only): each edge's supporting line is shifted inward along its
 * inward normal, and new vertices are the intersections of adjacent offset
 * lines.
 */
import type { Polygon2, Vec2 } from '../types';
import { pointInConvexPolygon, polygonArea } from './polygon';

interface OffsetLine {
  pt: Vec2;
  dir: Vec2;
}

/**
 * Moves edge i (p[i] -> p[i+1]) inward (to the left) by insets[i] (0 allowed,
 * negative = outward). New vertex k is the intersection of the offset lines
 * of edge k-1 and edge k; if those edges are parallel the degenerate vertex
 * is skipped. Returns [] if the result is empty/inverted (area <= 0, or any
 * vertex lies outside the original polygon).
 */
export function insetConvexEdges(p: Polygon2, insets: number[]): Polygon2 {
  const n = p.length;
  if (n < 3) return [];

  const lines: OffsetLine[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const inset = insets[i] ?? 0;
    if (len < 1e-15) {
      lines.push({ pt: a, dir: [dx, dy] });
      continue;
    }
    // Inward normal for a CCW polygon: rotate the edge direction 90° CCW.
    const nx = -dy / len;
    const ny = dx / len;
    lines.push({ pt: [a[0] + nx * inset, a[1] + ny * inset], dir: [dx, dy] });
  }

  const result: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const prev = lines[(k - 1 + n) % n];
    const cur = lines[k];
    const cross = prev.dir[0] * cur.dir[1] - prev.dir[1] * cur.dir[0];
    if (Math.abs(cross) < 1e-12) {
      continue; // parallel consecutive edges: skip the degenerate vertex
    }
    const t =
      ((cur.pt[0] - prev.pt[0]) * cur.dir[1] - (cur.pt[1] - prev.pt[1]) * cur.dir[0]) / cross;
    result.push([prev.pt[0] + prev.dir[0] * t, prev.pt[1] + prev.dir[1] * t]);
  }

  if (result.length < 3) return [];
  if (polygonArea(result) <= 1e-9) return [];
  for (const [x, y] of result) {
    if (!pointInConvexPolygon(p, x, y, 1e-6)) return [];
  }
  return result;
}

/** Uniform inset of every edge by `d`. */
export function insetConvex(p: Polygon2, d: number): Polygon2 {
  return insetConvexEdges(p, new Array(p.length).fill(d));
}
