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
import { insetConvex } from '../geom2d/offset';
import { polygonArea, polygonBounds } from '../geom2d/polygon';
import { slotCircle } from '../body/buildBody';
import { placeWatermark, textPixels } from '../body/hollow';
import type { KeepOutCircle, WatermarkPlacement } from '../body/hollow';
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
    // first choice is the outer wall, which is neither a seating face nor under a base;
    // a round tray (no straight wall) or a short one falls back to hiding it in a slot
    if (isAxisAlignedRect(tray)) watermark = addRimMark(out, text, tray, markTop);
    if (!watermark) watermark = addFloorMark(out, text, spec, t, slots, warnings);
    if (!watermark && warnings.every((w) => !/mark/.test(w))) warnings.push('There is no room for the maker mark on this tray, so it is left off.');
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

function isAxisAlignedRect(poly: Polygon2): boolean {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 1e-9 && Math.abs(a[1] - b[1]) > 1e-9) return false;
  }
  return true;
}

/**
 * The maker mark embossed on the tray's outer wall — the one place on a tray that
 * is neither a seating face nor under a base. Text runs along the wall's own
 * direction, which reads correctly from outside for every edge of a CCW outline,
 * and sinks into the wall by the whisker so the shells overlap.
 */
function addRimMark(out: SoupBuilder, text: string, tray: Polygon2, wallTop: number): boolean {
  const px = textPixels(text);
  if (px.cols === 0) return false;
  // longest wall
  let best = -1, bestLen = 0;
  for (let i = 0; i < tray.length; i++) {
    const a = tray[i], b = tray[(i + 1) % tray.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  if (best < 0) return false;
  const a = tray[best], b = tray[(best + 1) % tray.length];
  const len = bestLen;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const nx = uy, ny = -ux; // outward normal of a CCW edge
  const availLen = len - 1.0;
  const availH = wallTop - 0.4;
  const size = Math.min(0.5, availLen / px.cols, availH / px.rows);
  if (size < TRAY_MARK_MIN_PX) return false;
  const s = Math.round(size * 100) / 100;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const zc = wallTop / 2;
  const wallLo = -TRAY_MARK_PROUD, wallHi = TRAY_EMBED; // along the outward normal
  for (let row = 0; row < px.rows; row++) {
    let col = 0;
    while (col < px.cols) {
      if (!px.on(row, col)) { col++; continue; }
      let end = col;
      while (end + 1 < px.cols && px.on(row, end + 1)) end++;
      // grow each run by a whisker so runs on neighbouring rows overlap instead of touching
      const g = s * 0.08;
      const u0 = -((px.cols * s) / 2) + col * s - g, u1 = -((px.cols * s) / 2) + (end + 1) * s + g;
      const z0 = zc + (px.rows * s) / 2 - (row + 1) * s - g, z1 = zc + (px.rows * s) / 2 - row * s + g;
      const p0x = mx + ux * u0 + nx * wallLo, p0y = my + uy * u0 + ny * wallLo;
      const p1x = mx + ux * u1 + nx * wallHi, p1y = my + uy * u1 + ny * wallHi;
      addBoxSorted(out, p0x, p0y, z0, p1x, p1y, z1);
      col = end + 1;
    }
  }
  return true;
}

/** A closed axis-aligned box given any two opposite corners. */
function addBoxSorted(out: SoupBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  const z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  if (x1 - x0 < 1e-9 || y1 - y0 < 1e-9 || z1 - z0 < 1e-9) return;
  out.tri(x0, y0, z0, x1, y1, z0, x1, y0, z0);
  out.tri(x0, y0, z0, x0, y1, z0, x1, y1, z0);
  out.tri(x0, y0, z1, x1, y0, z1, x1, y1, z1);
  out.tri(x0, y0, z1, x1, y1, z1, x0, y1, z1);
  out.tri(x0, y0, z0, x1, y0, z0, x1, y0, z1);
  out.tri(x0, y0, z0, x1, y0, z1, x0, y0, z1);
  out.tri(x1, y0, z0, x1, y1, z0, x1, y1, z1);
  out.tri(x1, y0, z0, x1, y1, z1, x1, y0, z1);
  out.tri(x1, y1, z0, x0, y1, z0, x0, y1, z1);
  out.tri(x1, y1, z0, x0, y1, z1, x1, y1, z1);
  out.tri(x0, y1, z0, x0, y0, z0, x0, y0, z1);
  out.tri(x0, y1, z0, x0, y0, z1, x0, y1, z1);
}

/**
 * A round or oval tray has no wall an axis-aligned box can follow, so the mark
 * goes on the floor inside the largest opening, shallower than the void under
 * the base that sits there: completely hidden, and it cannot lift the base.
 */
function addFloorMark(out: SoupBuilder, text: string, spec: TraySpec, t: number, slots: MagnetSlotSpec[], warnings: string[]): boolean {
  const u = spec.underside;
  const pockets = spec.pockets ?? [];
  if (!u || pockets.length === 0) {
    warnings.push('The maker mark needs either a straight rim or a hollow base above it, so it is left off this tray.');
    return false;
  }
  let biggest: Polygon2 | null = null, bestArea = 0;
  for (const p of pockets) {
    const area = polygonArea(p);
    if (area > bestArea) { bestArea = area; biggest = p; }
  }
  if (!biggest) return false;
  // the floor under the base's void, kept clear of its brim
  const safe = insetConvex(biggest, (spec.gap ?? 0) + u.rim + 0.3);
  if (safe.length < 3 || polygonArea(safe) < 20) {
    warnings.push('The slots are too small to hide the maker mark under a base, so it is left off this tray.');
    return false;
  }
  const b = polygonBounds(safe);
  const keepOut: KeepOutCircle[] = slots
    .filter((s) => s.x >= b.min[0] - 5 && s.x <= b.max[0] + 5 && s.y >= b.min[1] - 5 && s.y <= b.max[1] + 5)
    .map((s) => ({ x: s.x, y: s.y, r: s.radius + u.ringWidth }));
  const place = placeWatermark(safe, text, keepOut);
  if (!place) {
    warnings.push('There is no room to hide the maker mark under a base on this tray, so it is left off.');
    return false;
  }
  const height = Math.min(spec.watermarkHeight ?? 0.2, 0.2, Math.max(0.1, u.depth - 0.3));
  // raised out of the floor's top face, sunk into it by the whisker so the shells overlap
  addFlatMark(out, text, place, t - TRAY_EMBED, t + height);
  return true;
}

/**
 * Raised text lying in the XY plane, one box per run of pixels, reading the right
 * way round when you look down at it (the base above it lifts out).
 */
function addFlatMark(out: SoupBuilder, text: string, place: WatermarkPlacement, z0: number, z1: number): void {
  const px = textPixels(text);
  const { px: s, centre, vertical } = place;
  for (let row = 0; row < px.rows; row++) {
    let col = 0;
    while (col < px.cols) {
      if (!px.on(row, col)) { col++; continue; }
      let end = col;
      while (end + 1 < px.cols && px.on(row, end + 1)) end++;
      const g = s * 0.08;
      const u0 = -((px.cols * s) / 2) + col * s - g, u1 = -((px.cols * s) / 2) + (end + 1) * s + g;
      const v0 = (px.rows * s) / 2 - (row + 1) * s - g, v1 = (px.rows * s) / 2 - row * s + g;
      if (!vertical) addBoxSorted(out, centre[0] + u0, centre[1] + v0, z0, centre[0] + u1, centre[1] + v1, z1);
      else addBoxSorted(out, centre[0] + v0, centre[1] + u0, z0, centre[0] + v1, centre[1] + u1, z1);
      col = end + 1;
    }
  }
}
