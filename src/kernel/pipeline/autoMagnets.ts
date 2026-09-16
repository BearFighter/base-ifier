/**
 * Automatic magnet placement in a piece's local frame (underside view).
 */
import type { BodyOutline, Vec2 } from '../types';
import { minEdgeDistance, polygonBounds } from '../geom2d/polygon';

export interface AutoMagnetOptions {
  /** slot radius including tolerance */
  radius: number;
  minWall: number;
  /** max size on both axes for a single centred magnet */
  singleMax?: number;
  /** pieces narrower than this on one axis are strips */
  stripMax?: number;
  /** strips longer than this get 3 magnets */
  tripleMin?: number;
}

export function autoMagnetPositions(outline: BodyOutline, opts: AutoMagnetOptions): Vec2[] {
  const singleMax = opts.singleMax ?? 35;
  const stripMax = opts.stripMax ?? 35;
  const tripleMin = opts.tripleMin ?? 100;
  const bb = polygonBounds(outline.bottom);
  const w = bb.max[0] - bb.min[0], d = bb.max[1] - bb.min[1];
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const need = opts.radius + opts.minWall;
  const fits = (x: number, y: number) => minEdgeDistance(outline.top, x, y) >= need - 1e-9;

  if (w <= singleMax && d <= singleMax) return fits(cx, cy) ? [[cx, cy]] : [];

  const long = Math.max(w, d), short = Math.min(w, d);
  if (short <= stripMax) {
    const count = long >= tripleMin ? 3 : 2;
    const along = w >= d ? 'x' : 'y';
    const res: Vec2[] = [];
    const offsets = count === 3 ? [-long / 3, 0, long / 3] : [-long / 4, long / 4];
    for (const o of offsets) {
      const p: Vec2 = along === 'x' ? [cx + o, cy] : [cx, cy + o];
      if (fits(p[0], p[1])) res.push(p);
    }
    if (res.length === 0 && fits(cx, cy)) res.push([cx, cy]);
    return res;
  }

  // plate: four inset corners, shrinking the inset until they fit
  const insets = [Math.min(10, short / 4), short / 4, short / 3];
  for (const inset of insets) {
    const pts: Vec2[] = [
      [cx - w / 2 + inset, cy - d / 2 + inset],
      [cx + w / 2 - inset, cy - d / 2 + inset],
      [cx + w / 2 - inset, cy + d / 2 - inset],
      [cx - w / 2 + inset, cy + d / 2 - inset],
    ];
    if (pts.every((p) => fits(p[0], p[1]))) return pts;
  }
  // ellipse-ish or awkward: fall back to two along the long axis, then centre
  const res: Vec2[] = [];
  const o = long / 4;
  const a: Vec2 = w >= d ? [cx - o, cy] : [cx, cy - o];
  const b: Vec2 = w >= d ? [cx + o, cy] : [cx, cy + o];
  if (fits(a[0], a[1])) res.push(a);
  if (fits(b[0], b[1])) res.push(b);
  if (res.length === 0 && fits(cx, cy)) res.push([cx, cy]);
  return res;
}
