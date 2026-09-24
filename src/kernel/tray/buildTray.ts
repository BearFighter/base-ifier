/**
 * Movement tray geometry, part 2: the analytic tray.
 *
 * A tray is a thin floor with a raised surround standing on it. The floor is one
 * closed prism over the whole tray outline (with the magnet holes in it); the
 * surround is one closed convex prism per cell from `traySurroundCells`. There is
 * no polygon union anywhere and nothing non-convex is ever triangulated: the
 * openings the bases drop into are simply where no cell was built, which is the
 * same multi-shell idiom `carveSockets` already ships for Diorama remainders.
 *
 * The one invariant that must never break: the floor of every opening is the
 * floor's TOP face at z = floor, and the surround always spans floor … floor +
 * plateHeight. Both move together, so a base sits flush with the surround at any
 * floor thickness.
 *
 * Every shell overlaps its neighbours by a whisker instead of touching them,
 * because `weld` fuses bit-identical vertices and a fused corner makes the whole
 * tray non-manifold (see `cells.ts`).
 */
import type { MagnetSlotSpec, Polygon2, Soup } from '../types';
import { SoupBuilder } from '../types';
import { earcutFull } from '../clip/earcutFull';
import { slotCircle } from '../body/buildBody';
import { textPixels } from '../body/hollow';
import { insetConvex } from '../geom2d/offset';
import { pointInConvexPolygon, polygonArea } from '../geom2d/polygon';
import { addPrism } from '../pipeline/plug';
import type { TrayCell } from './cells';
import { TRAY_SEAM_EPS } from './cells';

/** How far attached shells sink into the shell they stand on, mm. */
export const TRAY_EMBED = 0.1;
/** How far the mark on the rim stands out of the wall, mm. */
export const TRAY_MARK_PROUD = 0.3;
/** Smallest legible pixel of the raised mark, mm (same floor as the underside watermark). */
export const TRAY_MARK_MIN_PX = 0.22;

export interface TrayMagnets {
  /** slot centres and sizes in the tray's own frame */
  slots: MagnetSlotSpec[];
  /** material the floor must keep under a magnet that is recessed rather than drilled through, mm */
  floorMin: number;
}

/**
 * The floor a tray is actually built with: what was asked for, or, when there are
 * magnets, at least deep enough for the deepest one plus the material that must stay
 * under it. Magnets never poke through and never stand proud into a slot, so a base
 * still sits flush on the floor; the whole tray simply gets that much deeper.
 */
export function effectiveTrayFloor(floor: number, slots: { depth: number }[], floorMin: number): number {
  if (slots.length === 0) return floor;
  const deepest = slots.reduce((m, s) => Math.max(m, s.depth), 0);
  const need = Math.ceil((deepest + floorMin) * 10 - 1e-6) / 10;
  return Math.max(floor, need);
}

export interface TraySpec {
  /** thickness of the flat sheet under the whole tray, mm */
  floor: number;
  /** how far the surround stands above the floor: the plate height of the bases in it, mm */
  plateHeight: number;
  magnets?: TrayMagnets;
  /** raised text on the tray; empty = none */
  watermark?: string;
  watermarkHeight?: number;
  /** the bases' hollow underside, so a round tray can hide the mark under one of them */
  underside?: { depth: number; rim: number; ringWidth: number };
  /** the slot pockets, needed only to place the mark on a round tray */
  pockets?: Polygon2[];
  /** gap per side already built into the pockets, mm */
  gap?: number;
  seamEps?: number;
  /**
   * Highest point the mark on the rim may reach, mm. Defaults to floor +
   * plateHeight; an object scene passes the floor thickness, because above it the
   * wall is the scene's own terrain and a mark there could hang in the air.
   */
  markMaxZ?: number;
}

export interface TrayResult {
  soup: Soup;
  warnings: string[];
  /** 'recess' = pockets in the top face; 'through' = holes right through the floor */
  magnets: 'none' | 'recess' | 'through';
  /** recess depth (or the floor thickness for a hole through), mm */
  magnetDepth: number;
  /** the floor thickness that would let every magnet sit fully inside, mm */
  magnetFloorWanted: number;
  watermark: boolean;
}

/**
 * The whole tray as one soup of closed shells: floor, one prism per surround
 * cell, and the raised mark.
 */
export function buildTray(tray: Polygon2, cells: TrayCell[], spec: TraySpec): TrayResult {
  const warnings: string[] = [];
  const t = spec.floor;
  const H = spec.plateHeight;
  const eps = spec.seamEps ?? TRAY_SEAM_EPS;
  if (tray.length < 3) throw new Error('buildTray: the tray has no outline');
  if (t <= 0 || H <= 0) throw new Error('buildTray: the floor and the surround must both have a height');

  const slots = spec.magnets?.slots ?? [];
  const floorMin = spec.magnets?.floorMin ?? 0.6;
  const deepest = slots.reduce((m, s) => Math.max(m, s.depth), 0);
  let mode: TrayResult['magnets'] = slots.length ? 'recess' : 'none';
  let magnetDepth = 0;
  const magnetFloorWanted = slots.length ? Math.round((deepest + floorMin) * 10) / 10 : 0;
  if (slots.length) {
    if (deepest >= t - 1e-9) {
      mode = 'through';
      magnetDepth = t;
      warnings.push(`The magnets are ${fmt(deepest)} mm deep but the tray floor is only ${fmt(t)} mm, so the holes go right through and a magnet would stand proud underneath and make the tray rock. Make the floor ${fmt(magnetFloorWanted)} mm, or use thinner magnets.`);
    } else {
      magnetDepth = deepest;
      const left = t - deepest;
      if (left < floorMin - 1e-9) warnings.push(`Only ${fmt(left)} mm of material is left under each magnet. Make the floor ${fmt(magnetFloorWanted)} mm so they sit fully inside it.`);
    }
  }

  const out = new SoupBuilder(512 + cells.length * 24 + slots.length * 6 * 64 + 600);

  // --- the floor. Its outline is pulled in by the whisker so its outer wall is never
  // exactly coplanar with the surround's, which is the one thing slicers dislike.
  const floorPoly = shrink(tray, eps);
  const through = mode === 'through' ? slots.map((s) => slotCircle(s)) : [];
  const recesses = mode === 'recess' ? slots.map((s) => slotCircle(s)) : [];
  addCap(out, floorPoly, through, 0, false, warnings);
  addCap(out, floorPoly, [...through, ...recesses], t, true, warnings);
  addWall(out, floorPoly, 0, t);
  for (const c of through) addHoleWall(out, c, 0, t);
  for (let i = 0; i < recesses.length; i++) {
    const c = recesses[i];
    const z0 = t - magnetDepth;
    addHoleWall(out, c, z0, t);
    // the bottom of the recess, facing up into it
    for (let k = 0; k < c.length; k++) {
      const p = c[k], q = c[(k + 1) % c.length];
      out.tri(slots[i].x, slots[i].y, z0, p[0], p[1], z0, q[0], q[1], z0);
    }
  }

  // --- the surround: one closed prism per cell, sunk into the floor
  for (const cell of cells) addPrism(out, cell.poly, t - TRAY_EMBED, t + H);

  // --- the raised mark, last, as its own shell
  const text = (spec.watermark ?? '').trim();
  let watermark = false;
  if (text && (spec.watermarkHeight ?? 0) > 0) {
    const markTop = Math.min(spec.markMaxZ ?? t + H, t + H);
    // only ever on the outer wall: nothing may stand on the floor inside a slot, or the base
    // dropped into it would not sit flush
    watermark = addWallMark(out, text, tray, markTop, spec.pockets ?? []);
    if (!watermark) warnings.push('There is no stretch of outer wall on this tray tall and long enough for the maker mark, so it is left off.');
  }

  return { soup: out.build(), warnings, magnets: mode, magnetDepth, magnetFloorWanted, watermark };
}

// ---------------------------------------------------------------------------

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function shrink(poly: Polygon2, by: number): Polygon2 {
  if (by <= 0) return poly;
  const p = insetConvex(poly, by);
  return p.length >= 3 && polygonArea(p) > 1e-6 ? p : poly;
}

/** A flat cap at height z with circular holes, facing +z (`up`) or -z. */
function addCap(out: SoupBuilder, outer: Polygon2, holes: Polygon2[], z: number, up: boolean, warnings: string[]): void {
  const flat: number[] = [];
  for (const p of outer) flat.push(p[0], p[1]);
  const holeIdx: number[] = [];
  for (const h of holes) {
    holeIdx.push(flat.length / 2);
    for (const p of h) flat.push(p[0], p[1]);
  }
  const tris = earcutFull(flat, holeIdx.length ? holeIdx : undefined, warnings);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    const ax = flat[a * 2], ay = flat[a * 2 + 1], bx = flat[b * 2], by = flat[b * 2 + 1], cx = flat[c * 2], cy = flat[c * 2 + 1];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cross > 0 === up) out.tri(ax, ay, z, bx, by, z, cx, cy, z);
    else out.tri(ax, ay, z, cx, cy, z, bx, by, z);
  }
}

/** The outer wall of the floor, facing away from the tray. */
function addWall(out: SoupBuilder, poly: Polygon2, z0: number, z1: number): void {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    out.tri(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1);
    out.tri(a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1);
  }
}

/** The wall of a hole in solid material, facing into the hole. */
function addHoleWall(out: SoupBuilder, circle: Polygon2, z0: number, z1: number): void {
  const n = circle.length;
  for (let i = 0; i < n; i++) {
    const p = circle[i], q = circle[(i + 1) % n];
    out.tri(p[0], p[1], z0, q[0], q[1], z1, q[0], q[1], z0);
    out.tri(p[0], p[1], z0, p[0], p[1], z1, q[0], q[1], z1);
  }
}

/**
 * The maker mark embossed on the tray's outer wall: the one place on a tray that is
 * neither a seating face nor inside a slot, so it can never lift a base. The text is
 * centred on the longest straight wall when it fits there; otherwise (a round or oval
 * tray) it follows the wall round the front, one run of pixels per wall segment. Every
 * box stands TRAY_MARK_PROUD out of the wall and sinks TRAY_EMBED into it, and runs are
 * grown by a whisker so neighbouring runs overlap instead of sharing corners.
 */
function addWallMark(out: SoupBuilder, text: string, tray: Polygon2, wallTop: number, pockets: Polygon2[]): boolean {
  const px = textPixels(text);
  if (px.cols === 0 || tray.length < 3) return false;
  // outward normal = right of the edge direction for a CCW outline, left for a CW one
  let area2 = 0;
  for (let i = 0; i < tray.length; i++) {
    const a = tray[i], b = tray[(i + 1) % tray.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  const outSign = area2 >= 0 ? 1 : -1;
  const segs: { ax: number; ay: number; ux: number; uy: number; s0: number; len: number }[] = [];
  let perim = 0;
  for (let i = 0; i < tray.length; i++) {
    const a = tray[i], b = tray[(i + 1) % tray.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    segs.push({ ax: a[0], ay: a[1], ux: (b[0] - a[0]) / len, uy: (b[1] - a[1]) / len, s0: perim, len });
    perim += len;
  }
  if (segs.length < 3) return false;
  const wrap = (v: number) => ((v % perim) + perim) % perim;
  const segAt = (arc: number) => {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].s0 <= arc) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  // the wall must be backed by the surround along the whole text: a slot that opens at the
  // edge of the tray leaves no wall there, and the mark would stand in the slot
  const clear = (from: number, to: number) => {
    for (let arc = from; arc <= to + 1e-9; arc += 0.25) {
      const sg = segs[segAt(wrap(arc))];
      const u = wrap(arc) - sg.s0;
      const x = sg.ax + sg.ux * u - outSign * sg.uy * 0.4, y = sg.ay + sg.uy * u + outSign * sg.ux * 0.4;
      for (const p of pockets) if (pointInConvexPolygon(p, x, y)) return false;
    }
    return true;
  };
  const availH = wallTop - 0.4;
  let size = 0, centre = 0;
  // first choice: a straight wall the whole text fits on, longest first
  const byLength = segs.map((_, i) => i).sort((i, j) => segs[j].len - segs[i].len);
  for (const i of byLength) {
    const sz = Math.min(0.5, (segs[i].len - 1.0) / px.cols, availH / px.rows);
    if (sz < TRAY_MARK_MIN_PX) break;
    const c = segs[i].s0 + segs[i].len / 2;
    const half = (px.cols * Math.floor(sz * 100)) / 200;
    if (clear(c - half, c + half)) { size = sz; centre = c; break; }
  }
  if (size === 0) {
    // no straight wall will do (a round or oval tray): follow the wall, front first, over at most 40% of the way round
    const sz = Math.min(0.5, (perim * 0.4) / px.cols, availH / px.rows);
    if (sz >= TRAY_MARK_MIN_PX) {
      const half = (px.cols * Math.floor(sz * 100)) / 200;
      const order = segs.map((_, i) => i).sort((i, j) => (segs[i].ay + (segs[i].uy * segs[i].len) / 2) - (segs[j].ay + (segs[j].uy * segs[j].len) / 2));
      for (const i of order) {
        const c = segs[i].s0 + segs[i].len / 2;
        if (clear(c - half, c + half)) { size = sz; centre = c; break; }
      }
    }
  }
  if (size < TRAY_MARK_MIN_PX) return false;
  const s = Math.floor(size * 100) / 100;
  if (s < TRAY_MARK_MIN_PX) return false;
  const start = centre - (px.cols * s) / 2;
  const g = s * 0.08;
  const zc = wallTop / 2;
  for (let row = 0; row < px.rows; row++) {
    const z0 = zc + (px.rows * s) / 2 - (row + 1) * s - g, z1 = zc + (px.rows * s) / 2 - row * s + g;
    let col = 0;
    while (col < px.cols) {
      if (!px.on(row, col)) { col++; continue; }
      const arc0 = wrap(start + (col + 0.5) * s);
      const k = segAt(arc0);
      let end = col;
      while (end + 1 < px.cols && px.on(row, end + 1) && segAt(wrap(start + (end + 1.5) * s)) === k) end++;
      const sg = segs[k];
      const u0 = arc0 - sg.s0 - s / 2 - g;
      const u1 = u0 + (end - col + 1) * s + 2 * g;
      // local frame: along the wall, INTO the wall, up; right-handed, so the box keeps its winding
      const ix = -outSign * sg.uy, iy = outSign * sg.ux;
      addOrientedBox(out, sg.ax, sg.ay, sg.ux, sg.uy, ix, iy, u0, u1, -TRAY_MARK_PROUD, TRAY_EMBED, z0, z1);
      col = end + 1;
    }
  }
  return true;
}

/**
 * A closed box in a frame standing on the XY plane: `e1` along x', `e2` along y', z up.
 * (e1, e2, z) must be right-handed for the triangles to face outward.
 */
function addOrientedBox(out: SoupBuilder, ox: number, oy: number, e1x: number, e1y: number, e2x: number, e2y: number, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number): void {
  if (u1 - u0 < 1e-9 || v1 - v0 < 1e-9 || z1 - z0 < 1e-9) return;
  const P = (u: number, v: number): [number, number] => [ox + e1x * u + e2x * v, oy + e1y * u + e2y * v];
  const [ax, ay] = P(u0, v0), [bx, by] = P(u1, v0), [cx, cy] = P(u1, v1), [dx, dy] = P(u0, v1);
  // bottom (down), top (up)
  out.tri(ax, ay, z0, cx, cy, z0, bx, by, z0);
  out.tri(ax, ay, z0, dx, dy, z0, cx, cy, z0);
  out.tri(ax, ay, z1, bx, by, z1, cx, cy, z1);
  out.tri(ax, ay, z1, cx, cy, z1, dx, dy, z1);
  // the four sides: a-b, b-c, c-d, d-a (counter-clockwise seen from above)
  const side = (px: number, py: number, qx: number, qy: number) => {
    out.tri(px, py, z0, qx, qy, z0, qx, qy, z1);
    out.tri(px, py, z0, qx, qy, z1, px, py, z1);
  };
  side(ax, ay, bx, by);
  side(bx, by, cx, cy);
  side(cx, cy, dx, dy);
  side(dx, dy, ax, ay);
}

