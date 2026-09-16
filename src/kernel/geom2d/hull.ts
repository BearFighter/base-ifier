/**
 * Convex hull via Andrew's monotone chain.
 */
import type { Polygon2, Vec2 } from '../types';

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Computes the convex hull of a set of points, CCW, with collinear points
 * removed. Handles duplicate points. Returns [] if fewer than 3 distinct
 * points remain.
 */
export function convexHull(points: Vec2[]): Polygon2 {
  // Dedupe exact-duplicate points and sort lexicographically by (x, y).
  const seen = new Set<string>();
  const pts: Vec2[] = [];
  for (const p of points) {
    const key = `${p[0]},${p[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push(p);
  }
  pts.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));

  if (pts.length < 3) return [];

  const n = pts.length;
  const lower: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
      lower.pop();
    }
    lower.push(pts[i]);
  }

  const upper: Vec2[] = [];
  for (let i = n - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
      upper.pop();
    }
    upper.push(pts[i]);
  }

  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);

  if (hull.length < 3) return [];
  return hull;
}
