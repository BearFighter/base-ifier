/**
 * Synthetic mesh fixtures shared by the kernel tests: simple primitives
 * (box, cylinder) and an approximation of the real One Page Rules base
 * geometry (a convex plate with a hollow underside recess), used so tests
 * don't have to depend solely on the real STL fixture files.
 */
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SoupBuilder, concatSoups, type Soup } from '@/kernel/types';
import { readStl } from '@/kernel/stl/read';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Closed axis-aligned box, outward CCW, 12 triangles. */
export function boxSoup(w: number, d: number, h: number, cx = 0, cy = 0, z0 = 0): Soup {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - d / 2, y1 = cy + d / 2;
  const z1 = z0 + h;

  const b = new SoupBuilder(12);

  // top (+z)
  b.fan([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], 4);
  // bottom (-z)
  b.fan([x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0], 4);
  // x = x0 face (-x)
  b.fan([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], 4);
  // x = x1 face (+x)
  b.fan([x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1], 4);
  // y = y0 face (-y)
  b.fan([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], 4);
  // y = y1 face (+y)
  b.fan([x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0], 4);

  return b.build();
}

/** Closed cylinder, outward CCW. */
export function cylinderSoup(r: number, h: number, segments = 64, cx = 0, cy = 0, z0 = 0): Soup {
  const z1 = z0 + h;
  const b = new SoupBuilder(segments * 4);

  const pts: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }

  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];

    // top disk fan: (center, p_i, p_j) -> +z outward
    b.tri(cx, cy, z1, xi, yi, z1, xj, yj, z1);
    // bottom disk fan: (center, p_j, p_i) -> -z outward
    b.tri(cx, cy, z0, xj, yj, z0, xi, yi, z0);
    // lateral quad (p_i_bottom, p_j_bottom, p_j_top, p_i_top) -> radially outward
    b.fan([xi, yi, z0, xj, yj, z0, xj, yj, z1, xi, yi, z1], 4);
  }

  return b.build();
}

// ---------------------------------------------------------------------------
// OPR-like base body
// ---------------------------------------------------------------------------

export interface OprBodyOpts {
  shape: 'rect' | 'ellipse';
  w: number;
  d: number;
  /** Height of the flat plate top above z = 0. */
  plateTop?: number; // 2.984
  /** Top outline = bottom outline scaled about the centre by this factor. */
  topScale?: number; // 0.9237
  /** Height of the flat recess ceiling above z = 0. */
  recessCeiling?: number; // 0.836
  /** Width of the flat rim ring at z = 0. */
  rimWidth?: number; // 2.0
  /** Polygon segment count, ellipse only (rect is always a 4-gon). */
  segments?: number; // 64 for ellipse
}

type Pt2 = [number, number];

function shapePoly(shape: 'rect' | 'ellipse', halfW: number, halfD: number, segments: number): Pt2[] {
  if (shape === 'rect') {
    return [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ];
  }
  const pts: Pt2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push([halfW * Math.cos(a), halfD * Math.sin(a)]);
  }
  return pts;
}

/** Filled convex polygon cap at height z. `up` chooses +z (true) or -z (false) outward. */
function addCap(b: SoupBuilder, pts: Pt2[], z: number, up: boolean): void {
  const n = pts.length;
  const flat: number[] = [];
  if (up) {
    for (let i = 0; i < n; i++) flat.push(pts[i][0], pts[i][1], z);
  } else {
    for (let i = n - 1; i >= 0; i--) flat.push(pts[i][0], pts[i][1], z);
  }
  b.fan(flat, n);
}

/**
 * Lateral wall connecting two same-size point rings at different heights
 * (a "frustum" wall). `outward` chooses whether the wall's normal points
 * away from the central axis (true, like a normal bevel with solid filling
 * the interior) or toward it (false, like the wall of a recess cavity where
 * the solid is on the outside).
 */
function addWall(b: SoupBuilder, ptsA: Pt2[], zA: number, ptsB: Pt2[], zB: number, outward: boolean): void {
  const n = ptsA.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = ptsA[i], aj = ptsA[j];
    const bi = ptsB[i], bj = ptsB[j];
    if (outward) {
      b.fan([ai[0], ai[1], zA, aj[0], aj[1], zA, bj[0], bj[1], zB, bi[0], bi[1], zB], 4);
    } else {
      b.fan([aj[0], aj[1], zA, ai[0], ai[1], zA, bi[0], bi[1], zB, bj[0], bj[1], zB], 4);
    }
  }
}

/** Flat annulus between two same-size rings at the same height z. */
function addFlatRing(b: SoupBuilder, outerPts: Pt2[], innerPts: Pt2[], z: number, up: boolean): void {
  const n = outerPts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const oi = outerPts[i], oj = outerPts[j], ii = innerPts[i], ij = innerPts[j];
    if (up) {
      b.fan([oi[0], oi[1], z, oj[0], oj[1], z, ij[0], ij[1], z, ii[0], ii[1], z], 4);
    } else {
      b.fan([oj[0], oj[1], z, oi[0], oi[1], z, ii[0], ii[1], z, ij[0], ij[1], z], 4);
    }
  }
}

/**
 * A watertight, convex-in-plan plate approximating the real One Page Rules
 * base body: a bevelled plate from a full footprint (z=0) up to a smaller
 * top outline (z=plateTop), with a hollow recess underneath bounded by a
 * flat rim ring, a chamfer, and a flat recess ceiling.
 */
export function oprLikeBody(opts: OprBodyOpts): Soup {
  const {
    shape,
    w,
    d,
    plateTop = 2.984,
    topScale = 0.9237,
    recessCeiling = 0.836,
    rimWidth = 2.0,
    segments = 64,
  } = opts;

  const n = shape === 'rect' ? 4 : segments;
  const halfW = w / 2;
  const halfD = d / 2;

  const outerBottom = shapePoly(shape, halfW, halfD, n);
  const outerTop = shapePoly(shape, halfW * topScale, halfD * topScale, n);

  const rimInnerHalfW = halfW - rimWidth;
  const rimInnerHalfD = halfD - rimWidth;
  const rimInner = shapePoly(shape, rimInnerHalfW, rimInnerHalfD, n);

  const ceilHalfW = rimInnerHalfW - 0.8;
  const ceilHalfD = rimInnerHalfD - 0.8;
  const recessCeilingPts = shapePoly(shape, ceilHalfW, ceilHalfD, n);

  const b = new SoupBuilder(8 * n);

  addCap(b, outerTop, plateTop, true); // plate top, +z
  addWall(b, outerBottom, 0, outerTop, plateTop, true); // bevel, outward
  addFlatRing(b, outerBottom, rimInner, 0, false); // bottom rim, -z
  addWall(b, rimInner, 0, recessCeilingPts, recessCeiling, false); // chamfer, down/inward
  addCap(b, recessCeilingPts, recessCeiling, false); // recess ceiling, -z

  return b.build();
}

// ---------------------------------------------------------------------------
// Synthetic sculpt shells
// ---------------------------------------------------------------------------

/**
 * A closed slab sitting on the plate top, with a few small closed "bump"
 * boxes on top of it, appended as separate (possibly overlapping) shells --
 * this mirrors how the real sculpt STL files are structured.
 */
export function syntheticSculpt(w: number, d: number, plateTop = 2.984, margin = 0.1): Soup {
  const topScale = 0.9237;
  const slabW = w * topScale - 2 * margin;
  const slabD = d * topScale - 2 * margin;
  const slabZ0 = plateTop - 1.4;
  const slabH = 1.6; // slabZ0 + slabH === plateTop + 0.2

  const shells: Soup[] = [boxSoup(slabW, slabD, slabH, 0, 0, slabZ0)];

  const bumpZ0 = plateTop + 0.2;
  const bumpH = 1.3; // bumpZ0 + bumpH === plateTop + 1.5
  const bumpSize = Math.min(slabW, slabD) * 0.15;
  const offsets: Pt2[] = [
    [-slabW * 0.2, -slabD * 0.2],
    [slabW * 0.2, slabD * 0.15],
    [0, slabD * 0.25],
  ];
  for (const [ox, oy] of offsets) {
    shells.push(boxSoup(bumpSize, bumpSize, bumpH, ox, oy, bumpZ0));
  }

  return concatSoups(shells);
}

/** concat(oprLikeBody, syntheticSculpt) -- mimics a real two-shell base file. */
export function syntheticTwoShellBase(opts: OprBodyOpts): Soup {
  const body = oprLikeBody(opts);
  const plateTop = opts.plateTop ?? 2.984;
  const sculpt = syntheticSculpt(opts.w, opts.d, plateTop);
  return concatSoups([body, sculpt]);
}

// ---------------------------------------------------------------------------
// Real fixture file access
// ---------------------------------------------------------------------------

/** Absolute path to "<project>/S - Bases/STL/<fileName>". */
export function oprPath(fileName: string): string {
  return fileURLToPath(new URL(`../../S - Bases/STL/${fileName}`, import.meta.url));
}

/** Reads a real OPR base STL fixture, or null if the file doesn't exist. */
export function loadOprSoup(fileName: string): Soup | null {
  const p = oprPath(fileName);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return readStl(arrayBuffer);
}
