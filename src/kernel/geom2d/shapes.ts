/**
 * Footprint polygon generators for rect / ellipse `Shape`s.
 */
import type { Polygon2, Shape } from '../types';
import { rotatePolygon } from './polygon';

/** 4 points CCW starting at (cx - w/2, cy - d/2). */
export function rectPolygon(w: number, d: number, cx = 0, cy = 0): Polygon2 {
  const hw = w / 2;
  const hd = d / 2;
  return [
    [cx - hw, cy - hd],
    [cx + hw, cy - hd],
    [cx + hw, cy + hd],
    [cx - hw, cy + hd],
  ];
}

/**
 * CCW polygon inscribed in the ellipse of size w x d, starting at angle 0
 * (the point (cx + w/2, cy)). The area of this polygon is the exact area of
 * the regular inscribed `segments`-gon (it approaches pi * (w/2) * (d/2) as
 * segments grows).
 */
export function ellipsePolygon(w: number, d: number, segments = 64, cx = 0, cy = 0): Polygon2 {
  const a = w / 2;
  const b = d / 2;
  const n = Math.max(3, Math.round(segments));
  const pts: Polygon2 = new Array(n);
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / n;
    pts[i] = [cx + a * Math.cos(theta), cy + b * Math.sin(theta)];
  }
  return pts;
}

/** rect -> 4; ellipse -> clamp(round(perimeter / 1mm), 48, 256) via Ramanujan's approximation. */
export function shapeSegments(shape: Shape): number {
  if (shape.kind === 'rect') return 4;
  const a = shape.w / 2;
  const b = shape.d / 2;
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const n = Math.round(perimeter / 1.0);
  return Math.min(256, Math.max(48, n));
}

/** Angle snapping so rotation by an exact multiple of 90 degrees is exact. */
function snapTrig(deg: number): { sin: number; cos: number } {
  const norm = ((deg % 360) + 360) % 360;
  if (norm === 0) return { sin: 0, cos: 1 };
  if (norm === 90) return { sin: 1, cos: 0 };
  if (norm === 180) return { sin: 0, cos: -1 };
  if (norm === 270) return { sin: -1, cos: 0 };
  const rad = (deg * Math.PI) / 180;
  return { sin: Math.sin(rad), cos: Math.cos(rad) };
}

/** Rect or ellipse polygon centred at (cx, cy), rotated about that centre by rotDeg. */
export function shapePolygon(shape: Shape, cx = 0, cy = 0, rotDeg = 0): Polygon2 {
  const base =
    shape.kind === 'rect'
      ? rectPolygon(shape.w, shape.d, cx, cy)
      : ellipsePolygon(shape.w, shape.d, shapeSegments(shape), cx, cy);
  if (((rotDeg % 360) + 360) % 360 === 0) return base;
  return rotatePolygon(base, rotDeg, cx, cy);
}

/** Axis-aligned footprint size after rotating the shape by rotDeg (90 deg swaps w/d exactly). */
export function shapeBounds(shape: Shape, rotDeg = 0): { w: number; d: number } {
  const { sin, cos } = snapTrig(rotDeg);
  const a = shape.w / 2;
  const b = shape.d / 2;
  if (shape.kind === 'rect') {
    const hx = a * Math.abs(cos) + b * Math.abs(sin);
    const hy = a * Math.abs(sin) + b * Math.abs(cos);
    return { w: 2 * hx, d: 2 * hy };
  }
  const hx = Math.hypot(a * cos, b * sin);
  const hy = Math.hypot(a * sin, b * cos);
  return { w: 2 * hx, d: 2 * hy };
}
