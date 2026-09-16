/**
 * Core polygon utilities: area, centroid, winding, bounds, point queries,
 * dedupe, and rigid/affine transforms.
 *
 * Conventions follow src/kernel/types.ts: a Polygon2 is a CCW array of
 * [x, y] points in mm with no repeated closing point.
 */
import type { Bounds2, Polygon2, Vec2 } from '../types';

/** Signed area (shoelace formula); positive for CCW winding. */
export function polygonArea(p: Polygon2): number {
  const n = p.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % n];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/** Area-weighted centroid; falls back to the vertex mean for degenerate (area ~ 0) polygons. */
export function polygonCentroid(p: Polygon2): Vec2 {
  const n = p.length;
  if (n === 0) return [0, 0];
  const area = polygonArea(p);
  if (Math.abs(area) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of p) {
      sx += x;
      sy += y;
    }
    return [sx / n, sy / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  const factor = 1 / (6 * area);
  return [cx * factor, cy * factor];
}

/** True if the polygon winds counter-clockwise (signed area > 0). */
export function isCCW(p: Polygon2): boolean {
  return polygonArea(p) > 0;
}

/** Returns a reversed copy if the polygon winds clockwise; otherwise a shallow copy. */
export function ensureCCW(p: Polygon2): Polygon2 {
  if (isCCW(p)) return p.slice();
  return p.slice().reverse();
}

/** Axis-aligned bounding box of the polygon's vertices. */
export function polygonBounds(p: Polygon2): Bounds2 {
  if (p.length === 0) {
    return { min: [0, 0], max: [0, 0] };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { min: [minX, minY], max: [maxX, maxY] };
}

/**
 * True if (x, y) is inside or on the boundary (within eps) of a convex polygon.
 * Assumes `p` is convex; winding may be either CW or CCW.
 */
export function pointInConvexPolygon(p: Polygon2, x: number, y: number, eps = 1e-9): boolean {
  const n = p.length;
  if (n < 3) return false;
  const ccw = isCCW(p);
  let sawPositive = false;
  let sawNegative = false;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % n];
    const ex = x1 - x0;
    const ey = y1 - y0;
    let cross = ex * (y - y0) - ey * (x - x0);
    if (!ccw) cross = -cross;
    if (cross < -eps) sawNegative = true;
    else if (cross > eps) sawPositive = true;
    if (sawPositive && sawNegative) return false;
  }
  return true;
}

/** General even-odd ray-casting point-in-polygon test; works for non-convex loops. */
export function pointInPolygon(p: Polygon2, x: number, y: number): boolean {
  const n = p.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Removes consecutive (and closing) points closer than eps, and collinear
 * middle points (cross product magnitude below eps).
 */
export function dedupePolygon(p: Polygon2, eps = 1e-7): Polygon2 {
  if (p.length === 0) return [];
  // Pass 1: drop near-duplicate consecutive points (including wrap-around).
  const distinct: Vec2[] = [];
  for (const pt of p) {
    const last = distinct[distinct.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > eps) {
      distinct.push(pt);
    }
  }
  while (
    distinct.length > 1 &&
    Math.hypot(
      distinct[distinct.length - 1][0] - distinct[0][0],
      distinct[distinct.length - 1][1] - distinct[0][1],
    ) <= eps
  ) {
    distinct.pop();
  }
  if (distinct.length < 3) return distinct;

  // Pass 2: drop collinear middle points.
  let result = distinct;
  let changed = true;
  while (changed && result.length > 2) {
    changed = false;
    const next: Vec2[] = [];
    const n = result.length;
    for (let i = 0; i < n; i++) {
      const a = result[(i - 1 + n) % n];
      const b = result[i];
      const c = result[(i + 1) % n];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const acx = c[0] - a[0];
      const acy = c[1] - a[1];
      const cross = abx * acy - aby * acx;
      if (Math.abs(cross) < eps) {
        changed = true;
        continue; // drop b
      }
      next.push(b);
    }
    if (next.length < 3) {
      result = next;
      break;
    }
    result = next;
  }
  return result;
}

/** Translates every vertex by (tx, ty). */
export function translatePolygon(p: Polygon2, tx: number, ty: number): Polygon2 {
  return p.map(([x, y]) => [x + tx, y + ty] as Vec2);
}

/** Rotates CCW by `deg` degrees about (cx, cy). Exact for multiples of 90°. */
export function rotatePolygon(p: Polygon2, deg: number, cx = 0, cy = 0): Polygon2 {
  const norm = ((deg % 360) + 360) % 360;
  let sin: number;
  let cos: number;
  if (norm === 0) {
    sin = 0;
    cos = 1;
  } else if (norm === 90) {
    sin = 1;
    cos = 0;
  } else if (norm === 180) {
    sin = 0;
    cos = -1;
  } else if (norm === 270) {
    sin = -1;
    cos = 0;
  } else {
    const rad = (deg * Math.PI) / 180;
    sin = Math.sin(rad);
    cos = Math.cos(rad);
  }
  return p.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as Vec2;
  });
}

/** Scales about (cx, cy) by (sx, sy). */
export function scalePolygonAbout(p: Polygon2, sx: number, sy: number, cx: number, cy: number): Polygon2 {
  return p.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy] as Vec2);
}

/**
 * Signed distance from (x, y) to each edge's infinite LINE (edge i = p[i] -> p[(i+1)%n]).
 * Positive when the point is on the left of the directed edge (inside for CCW polygons).
 */
export function polygonEdgeDistances(p: Polygon2, x: number, y: number): number[] {
  const n = p.length;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % n];
    const ex = x1 - x0;
    const ey = y1 - y0;
    const len = Math.hypot(ex, ey);
    if (len < 1e-15) {
      out[i] = 0;
      continue;
    }
    const cross = ex * (y - y0) - ey * (x - x0);
    out[i] = cross / len;
  }
  return out;
}

/** Minimum of polygonEdgeDistances; how far inside (or outside, if negative) the point is. */
export function minEdgeDistance(p: Polygon2, x: number, y: number): number {
  const dists = polygonEdgeDistances(p, x, y);
  let min = Infinity;
  for (const d of dists) if (d < min) min = d;
  return min;
}

/** Sum of edge lengths. */
export function polygonPerimeter(p: Polygon2): number {
  const n = p.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % n];
    sum += Math.hypot(x1 - x0, y1 - y0);
  }
  return sum;
}
