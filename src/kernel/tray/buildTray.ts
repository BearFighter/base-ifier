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
import { placeMakerMark, engravedMarkPatch, MAKER_MARK_DEPTH } from '../body/hollow';
import type { KeepOutCircle } from '../body/hollow';
import { insetConvex } from '../geom2d/offset';
import { pointInConvexPolygon, polygonArea } from '../geom2d/polygon';
import { addPrism } from '../pipeline/plug';
import type { TrayCell } from './cells';
import { TRAY_SEAM_EPS } from './cells';

/** How far attached shells sink into the shell they stand on, mm. */
export const TRAY_EMBED = 0.1;

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
  // the maker mark is engraved into the underside of the floor: out of sight on a display,
  // and sunk in, so it can never stop the tray sitting flat
  const text = (spec.watermark ?? '').trim();
  let engraved: ReturnType<typeof engravedMarkPatch> | null = null;
  let watermark = false;
  if (text && (spec.watermarkHeight ?? 0) > 0) {
    const area = insetConvex(floorPoly, 2.0);
    const keepOut: KeepOutCircle[] = slots.map((sl) => ({ x: sl.x, y: sl.y, r: sl.radius + 0.6 }));
    const pm = area.length >= 3 ? placeMakerMark(area, keepOut, text) : null;
    if (pm) { engraved = engravedMarkPatch(pm.text, pm.place); watermark = true; }
    else warnings.push('This tray is too small to carry the maker mark underneath, so it is left off.');
  }
  addCap(out, floorPoly, engraved ? [...through, engraved.ring] : through, 0, false, warnings);
  if (engraved) engraved.build(out, 0, Math.min(MAKER_MARK_DEPTH, Math.max(0.1, t - 0.4)));
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

