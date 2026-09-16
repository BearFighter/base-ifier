/**
 * Sutherland-Hodgman polygon clipping against convex clip regions.
 */
import type { Polygon2, Vec2 } from '../types';
import { dedupePolygon } from './polygon';

/**
 * Clips `subject` to the half-plane on the LEFT of the directed line a->b
 * (one Sutherland-Hodgman step).
 */
export function clipPolygonByHalfPlane(subject: Polygon2, a: Vec2, b: Vec2, eps = 1e-9): Polygon2 {
  const n = subject.length;
  if (n === 0) return [];

  const ex = b[0] - a[0];
  const ey = b[1] - a[1];

  const side = (p: Vec2): number => ex * (p[1] - a[1]) - ey * (p[0] - a[0]);

  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const cur = subject[i];
    const prev = subject[(i - 1 + n) % n];
    const curSide = side(cur);
    const prevSide = side(prev);
    const curIn = curSide >= -eps;
    const prevIn = prevSide >= -eps;

    if (curIn) {
      if (!prevIn) {
        out.push(intersect(prev, cur, prevSide, curSide));
      }
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur, prevSide, curSide));
    }
  }
  return out;
}

function intersect(prev: Vec2, cur: Vec2, prevSide: number, curSide: number): Vec2 {
  const denom = prevSide - curSide;
  const t = Math.abs(denom) < 1e-15 ? 0 : prevSide / denom;
  return [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
}

/**
 * Intersects two convex CCW polygons by sequentially clipping `subject` by
 * every edge of `clip`. Returns [] if the intersection is empty.
 */
export function clipConvexPolygons(subject: Polygon2, clip: Polygon2, eps = 1e-9): Polygon2 {
  let result: Polygon2 = subject.slice();
  const n = clip.length;
  for (let i = 0; i < n && result.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % n];
    result = clipPolygonByHalfPlane(result, a, b, eps);
  }
  if (result.length < 3) return [];
  return dedupePolygon(result);
}
