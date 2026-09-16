/**
 * Hollow-underside helpers for `buildBody`: the void (a recess inside a solid
 * brim so the seating plane is only the brim), magnet locating rings that hang
 * from the void ceiling, and a raised watermark on the ceiling. Every piece is
 * a closed shell of its own that overlaps the body; slicers union them.
 *
 * Coordinates: the piece's local frame, seating plane z = 0, void ceiling at
 * z = depth, +z into the base.
 */
import type { MagnetSlotSpec, Polygon2, Vec2 } from '../types';
import { SoupBuilder } from '../types';
import { insetConvex } from '../geom2d/offset';
import { minEdgeDistance, polygonBounds, polygonCentroid } from '../geom2d/polygon';

export interface HollowSpec {
  /** void depth below the ceiling, measured from the seating plane, mm */
  depth: number;
  /** solid brim kept around the footprint, mm */
  rim: number;
  /** magnet locating rings on the ceiling: how far they hang down and how thick their wall is, mm */
  ringHeight: number;
  ringWidth: number;
  /** raised text on the ceiling (upper case, digits, space, - . _), mm tall; empty text = none */
  watermark: string;
  watermarkHeight: number;
}

export const DEFAULT_HOLLOW: HollowSpec = { depth: 2, rim: 2, ringHeight: 0.5, ringWidth: 0.4, watermark: 'BITDEATHLABS', watermarkHeight: 0.3 };

/** How much material the ceiling always keeps above the void, mm. */
export const MIN_CEILING = 0.8;

/** Overlap of attached shells into the solid ceiling, mm. */
const EMBED = 0.1;

/** A closed axis-aligned box. */
export function addBox(out: SoupBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  // bottom (-z), top (+z), four sides, CCW seen from outside
  out.tri(x0, y0, z0, x1, y1, z0, x1, y0, z0);
  out.tri(x0, y0, z0, x0, y1, z0, x1, y1, z0);
  out.tri(x0, y0, z1, x1, y0, z1, x1, y1, z1);
  out.tri(x0, y0, z1, x1, y1, z1, x0, y1, z1);
  out.tri(x0, y0, z0, x1, y0, z0, x1, y0, z1); // front (y0), faces -y
  out.tri(x0, y0, z0, x1, y0, z1, x0, y0, z1);
  out.tri(x1, y0, z0, x1, y1, z0, x1, y1, z1); // right (x1), faces +x
  out.tri(x1, y0, z0, x1, y1, z1, x1, y0, z1);
  out.tri(x1, y1, z0, x0, y1, z0, x0, y1, z1); // back (y1), faces +y
  out.tri(x1, y1, z0, x0, y1, z1, x1, y1, z1);
  out.tri(x0, y1, z0, x0, y0, z0, x0, y0, z1); // left (x0), faces -x
  out.tri(x0, y1, z0, x0, y0, z1, x0, y1, z1);
}

/**
 * A closed annular prism (a ring) between z0 and z1, inner radius ri, outer ro.
 * Used for magnet locating rings hanging from the ceiling (z1 sits inside the ceiling).
 */
export function addRing(out: SoupBuilder, cx: number, cy: number, ri: number, ro: number, z0: number, z1: number, sides: number): void {
  const n = Math.max(12, Math.round(sides));
  const pt = (r: number, i: number): Vec2 => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const oi = pt(ro, i), oj = pt(ro, j), ii = pt(ri, i), ij = pt(ri, j);
    // outer wall, faces outward
    out.tri(oi[0], oi[1], z0, oj[0], oj[1], z0, oj[0], oj[1], z1);
    out.tri(oi[0], oi[1], z0, oj[0], oj[1], z1, oi[0], oi[1], z1);
    // inner wall, faces inward (toward the axis)
    out.tri(ii[0], ii[1], z0, ij[0], ij[1], z1, ij[0], ij[1], z0);
    out.tri(ii[0], ii[1], z0, ii[0], ii[1], z1, ij[0], ij[1], z1);
    // bottom annulus, faces -z
    out.tri(oi[0], oi[1], z0, ii[0], ii[1], z0, ij[0], ij[1], z0);
    out.tri(oi[0], oi[1], z0, ij[0], ij[1], z0, oj[0], oj[1], z0);
    // top annulus, faces +z
    out.tri(oi[0], oi[1], z1, oj[0], oj[1], z1, ij[0], ij[1], z1);
    out.tri(oi[0], oi[1], z1, ij[0], ij[1], z1, ii[0], ii[1], z1);
  }
}

/** 5 x 7 pixel font, rows top to bottom, 5 bits each (MSB = left column). */
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  _: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

/** Pixel rows of a text line (5 columns per glyph plus a 1-column gap). Unknown characters print as space. */
export function textPixels(text: string): { rows: number; cols: number; on: (row: number, col: number) => boolean } {
  const chars = text.toUpperCase().split('');
  const cols = Math.max(0, chars.length * 6 - 1);
  return {
    rows: 7,
    cols,
    on: (row, col) => {
      const ci = Math.floor(col / 6), k = col % 6;
      if (k === 5 || ci >= chars.length) return false;
      const glyph = FONT[chars[ci]] ?? FONT[' '];
      return ((glyph[row] >> (4 - k)) & 1) === 1;
    },
  };
}

export interface WatermarkPlacement {
  /** pixel size, mm */
  px: number;
  /** centre of the text block, local XY */
  centre: Vec2;
  /** text runs along +x (false) or +y (true) */
  vertical: boolean;
}

/** Circles (magnet rings) the watermark must not overlap. */
export interface KeepOutCircle {
  x: number;
  y: number;
  r: number;
}

/**
 * Where the watermark fits on the ceiling: inside the void polygon, clear of
 * the magnet rings, along the longer axis, as large as possible up to 0.5 mm
 * pixels. Returns null when it would be smaller than 0.22 mm pixels (illegible).
 */
export function placeWatermark(voidPoly: Polygon2, text: string, keepOut: KeepOutCircle[]): WatermarkPlacement | null {
  const t = textPixels(text);
  if (t.cols === 0) return null;
  const inner = insetConvex(voidPoly, 0.6);
  if (inner.length < 3) return null;
  const b = polygonBounds(inner);
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  const vertical = h > w * 1.15;
  const along = vertical ? h : w, across = vertical ? w : h;
  const c = polygonCentroid(inner);
  const fits = (px: number, centre: Vec2): boolean => {
    const halfA = (t.cols * px) / 2, halfB = (t.rows * px) / 2;
    const hx = vertical ? halfB : halfA, hy = vertical ? halfA : halfB;
    const corners: Vec2[] = [[centre[0] - hx, centre[1] - hy], [centre[0] + hx, centre[1] - hy], [centre[0] + hx, centre[1] + hy], [centre[0] - hx, centre[1] + hy]];
    for (const q of corners) if (!insideConvex(inner, q)) return false;
    for (const k of keepOut) {
      const dx = Math.max(Math.abs(k.x - centre[0]) - hx, 0), dy = Math.max(Math.abs(k.y - centre[1]) - hy, 0);
      if (Math.hypot(dx, dy) < k.r + 0.3) return false;
    }
    return true;
  };
  // try centred first, then beside the magnets (across the short axis), then along the long axis
  const offsets: [number, number][] = [[0, 0], [0.15, 0], [-0.15, 0], [0.25, 0], [-0.25, 0], [0.35, 0], [-0.35, 0], [0, 0.25], [0, -0.25], [0.25, 0.25], [-0.25, 0.25], [0.25, -0.25], [-0.25, -0.25]];
  for (let px = 0.5; px >= 0.22; px -= 0.04) {
    if (t.cols * px > along || t.rows * px > across) continue;
    for (const [fa, fl] of offsets) {
      const centre: Vec2 = vertical ? [c[0] + fa * across, c[1] + fl * along] : [c[0] + fl * along, c[1] + fa * across];
      if (fits(px, centre)) return { px: Math.round(px * 100) / 100, centre, vertical };
    }
  }
  return null;
}

function insideConvex(poly: Polygon2, p: Vec2): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -1e-9) return false;
  }
  return true;
}

/**
 * Raised text on the ceiling as one box per horizontal pixel run. Mirrored so
 * it reads correctly when you look at the underside. Returns the box count.
 */
export function addWatermark(out: SoupBuilder, text: string, place: WatermarkPlacement, ceilingZ: number, height: number): number {
  const t = textPixels(text);
  const { px, centre, vertical } = place;
  const z0 = ceilingZ - height, z1 = ceilingZ + EMBED;
  let boxes = 0;
  for (let row = 0; row < t.rows; row++) {
    let col = 0;
    while (col < t.cols) {
      if (!t.on(row, col)) { col++; continue; }
      let end = col;
      while (end + 1 < t.cols && t.on(row, end + 1)) end++;
      // text coordinates: u along the reading direction, v down the rows; mirrored in u for reading from below.
      // Boxes grow by a whisker so runs on neighbouring rows overlap instead of touching
      // (exactly touching boxes would share vertices and weld into non-manifold edges).
      const g = px * 0.08;
      const u0 = -((t.cols * px) / 2) + col * px - g, u1 = -((t.cols * px) / 2) + (end + 1) * px + g;
      const v0 = (t.rows * px) / 2 - (row + 1) * px - g, v1 = (t.rows * px) / 2 - row * px + g;
      const mu0 = -u1, mu1 = -u0; // mirror
      if (!vertical) addBox(out, centre[0] + mu0, centre[1] + v0, z0, centre[0] + mu1, centre[1] + v1, z1);
      else addBox(out, centre[0] + v0, centre[1] + mu0, z0, centre[0] + v1, centre[1] + mu1, z1);
      boxes++;
      col = end + 1;
    }
  }
  return boxes;
}

/** Ring geometry for a magnet slot on the ceiling; null (with a reason) when it would cut into the brim. */
export function ringFor(slot: MagnetSlotSpec, voidPoly: Polygon2, spec: HollowSpec): { ri: number; ro: number } | { reason: string } {
  const ri = slot.radius, ro = slot.radius + spec.ringWidth;
  const clearance = minEdgeDistance(voidPoly, slot.x, slot.y);
  if (!insideConvex(voidPoly, [slot.x, slot.y]) || clearance < ro + 0.2) return { reason: `magnet at (${slot.x.toFixed(1)}, ${slot.y.toFixed(1)}) sits too close to the brim for its locating ring; move it inward` };
  return { ri, ro };
}
