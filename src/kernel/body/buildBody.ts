/**
 * Build a watertight solid body from a bottom outline (z=0), a top outline
 * (z=plateTop) and optional magnet slots bored into the bottom face.
 */
import { earcutFull } from '../clip/earcutFull';
import type { BodyOutline, MagnetSlotSpec, Polygon2, Soup } from '../types';
import { SoupBuilder } from '../types';
import { polygonCentroid, polygonArea } from '../geom2d/polygon';
import { insetConvex } from '../geom2d/offset';
import { addRing, addWatermark, placeWatermark, ringFor, MIN_CEILING } from './hollow';
import type { HollowSpec, KeepOutCircle } from './hollow';

export interface BuildBodyResult {
  soup: Soup;
  warnings: string[];
  /** set when the underside was hollowed: the void outline (local frame) and its depth */
  underside?: { rim: Polygon2; depth: number; watermark: boolean };
}

/** Decide whether a base can be hollowed as asked; null = keep it solid (with a warning). */
function hollowPlan(spec: HollowSpec, bottom: Polygon2, plateTop: number, warnings: string[]): { voidPoly: Polygon2; depth: number } | null {
  const depth = Math.min(spec.depth, plateTop - MIN_CEILING);
  if (depth < 0.5) { warnings.push('too thin to hollow: the underside is left solid'); return null; }
  const voidPoly = insetConvex(bottom, spec.rim);
  if (voidPoly.length < 3 || polygonArea(voidPoly) < 20) { warnings.push('too small to hollow: the brim would fill the underside, left solid'); return null; }
  return { voidPoly, depth };
}

export function slotCircle(slot: MagnetSlotSpec): Polygon2 {
  const pts: Polygon2 = [];
  for (let i = 0; i < slot.sides; i++) {
    const a = (i / slot.sides) * Math.PI * 2;
    pts.push([slot.x + slot.radius * Math.cos(a), slot.y + slot.radius * Math.sin(a)]);
  }
  return pts;
}

/**
 * `hollow`: recess the underside inside a solid brim (the seating plane is then
 * only the brim); magnet slots become locating rings hanging from the void
 * ceiling and an optional watermark is raised on it. Without it the body is a
 * solid plate with the magnet slots bored into the bottom face.
 */
export function buildBody(outline: BodyOutline, slots: MagnetSlotSpec[] = [], hollow?: HollowSpec): BuildBodyResult {
  const warnings: string[] = [];
  const bottom = outline.bottom;
  let top = outline.top;
  const zT = outline.plateTop;
  if (bottom.length < 3) throw new Error('buildBody: bottom outline has fewer than 3 points');
  if (top.length < 3 || polygonArea(top) <= 1e-9) {
    warnings.push('top outline collapsed; using vertical walls');
    top = bottom;
  }
  const out = new SoupBuilder(256 + slots.length * 4 * 64);
  const plan = hollow ? hollowPlan(hollow, bottom, zT, warnings) : null;

  // --- bottom cap (faces -z): with slot holes (solid) or as the brim annulus (hollow)
  const flat: number[] = [];
  for (const p of bottom) flat.push(p[0], p[1]);
  const holeIdx: number[] = [];
  const circles: Polygon2[] = [];
  if (plan) {
    holeIdx.push(flat.length / 2);
    for (const p of plan.voidPoly) flat.push(p[0], p[1]);
  } else {
    for (const s of slots) {
      const c = slotCircle(s);
      circles.push(c);
      holeIdx.push(flat.length / 2);
      for (const p of c) flat.push(p[0], p[1]);
    }
  }
  const tris = earcutFull(flat, holeIdx.length ? holeIdx : undefined, warnings);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    const ax = flat[a * 2], ay = flat[a * 2 + 1], bx = flat[b * 2], by = flat[b * 2 + 1], cx = flat[c * 2], cy = flat[c * 2 + 1];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    // want the face to point -z: CW when viewed from +z
    if (cross > 0) out.tri(ax, ay, 0, cx, cy, 0, bx, by, 0);
    else out.tri(ax, ay, 0, bx, by, 0, cx, cy, 0);
  }

  // --- hollow underside: void wall (facing into the void), ceiling (facing -z), rings, watermark
  let underside: BuildBodyResult['underside'];
  if (plan) {
    const v = plan.voidPoly, d = plan.depth, n = v.length;
    for (let i = 0; i < n; i++) {
      const p = v[i], q = v[(i + 1) % n];
      out.tri(p[0], p[1], 0, q[0], q[1], d, q[0], q[1], 0);
      out.tri(p[0], p[1], 0, p[0], p[1], d, q[0], q[1], d);
    }
    for (let i = 1; i + 1 < n; i++) out.tri(v[0][0], v[0][1], d, v[i + 1][0], v[i + 1][1], d, v[i][0], v[i][1], d);
    underside = { rim: v, depth: d, watermark: false };

  }

  // --- slot walls (normals pointing into the hole) and floors (facing -z); solid bodies only
  for (let s = 0; s < circles.length; s++) {
    const slot = slots[s];
    const c = circles[s];
    const n = c.length;
    const d = slot.depth;
    for (let i = 0; i < n; i++) {
      const p = c[i], q = c[(i + 1) % n];
      out.tri(p[0], p[1], 0, q[0], q[1], d, q[0], q[1], 0);
      out.tri(p[0], p[1], 0, p[0], p[1], d, q[0], q[1], d);
    }
    for (let i = 0; i < n; i++) {
      const p = c[i], q = c[(i + 1) % n];
      out.tri(slot.x, slot.y, d, q[0], q[1], d, p[0], p[1], d);
    }
  }

  // --- top cap (faces +z): fan
  for (let i = 1; i + 1 < top.length; i++) {
    out.tri(top[0][0], top[0][1], zT, top[i][0], top[i][1], zT, top[i + 1][0], top[i + 1][1], zT);
  }

  // --- side band: zip bottom and top outlines by angle about the bottom centroid
  zipBand(bottom, top, zT, out);

  // --- attached shells last: magnet locating rings and the watermark (hollow only)
  if (plan && underside) {
    const v = plan.voidPoly, d = plan.depth;
    const keepOut: KeepOutCircle[] = [];
    for (const slot of slots) {
      const r = ringFor(slot, v, hollow!);
      if ('reason' in r) { warnings.push(r.reason); continue; }
      addRing(out, slot.x, slot.y, r.ri, r.ro, d - hollow!.ringHeight, d + 0.1, slot.sides);
      keepOut.push({ x: slot.x, y: slot.y, r: r.ro });
    }
    let watermark = false;
    const text = hollow!.watermark.trim();
    if (text && hollow!.watermarkHeight > 0) {
      const place = placeWatermark(v, text, keepOut);
      if (place) { addWatermark(out, text, place, d, Math.min(hollow!.watermarkHeight, d - 0.2)); watermark = true; }
    }
    underside.watermark = watermark;
  }

  return { soup: out.build(), warnings, underside };
}

function zipBand(B: Polygon2, T: Polygon2, zT: number, out: SoupBuilder): void {
  const c = polygonCentroid(B);
  const angB = unwrappedAngles(B, c);
  const angT = unwrappedAngles(T, c);
  const nb = B.length, nt = T.length;
  // rotate arrays so each starts at its minimum angle
  const bOff = angB.start, tOff = angT.start;
  const ab = angB.angles, at = angT.angles;
  let i = 0, j = 0;
  while (i < nb || j < nt) {
    const nextB = i < nb ? ab[i + 1] : Infinity;
    const nextT = j < nt ? at[j + 1] : Infinity;
    const bi = B[(bOff + i) % nb], ti = T[(tOff + j) % nt];
    if (i < nb && (j >= nt || nextB <= nextT)) {
      const bn = B[(bOff + i + 1) % nb];
      out.tri(bi[0], bi[1], 0, bn[0], bn[1], 0, ti[0], ti[1], zT);
      i++;
    } else {
      const tn = T[(tOff + j + 1) % nt];
      out.tri(bi[0], bi[1], 0, tn[0], tn[1], zT, ti[0], ti[1], zT);
      j++;
    }
  }
}

/** Angles of a CCW polygon's vertices about c, cycled to start at the minimum and unwrapped (length n+1). */
function unwrappedAngles(P: Polygon2, c: [number, number]): { start: number; angles: number[] } {
  const n = P.length;
  const raw = P.map((p) => Math.atan2(p[1] - c[1], p[0] - c[0]));
  let start = 0;
  for (let i = 1; i < n; i++) if (raw[i] < raw[start]) start = i;
  const angles: number[] = new Array(n + 1);
  let prev = raw[start];
  angles[0] = prev;
  for (let k = 1; k <= n; k++) {
    let a = raw[(start + k) % n];
    while (a < prev) a += Math.PI * 2;
    angles[k] = a;
    prev = a;
  }
  return { start, angles };
}
