/**
 * Core geometry types for the Base-ifier kernel.
 *
 * Conventions (all kernel modules follow these):
 *  - Units are millimetres. Z is up. Bases sit on z = 0 with the plate top at ~3mm.
 *  - A triangle "soup" is a flat Float32Array of vertex positions, 9 floats per
 *    triangle (x0 y0 z0 x1 y1 z1 x2 y2 z2), counter-clockwise when viewed from
 *    outside (right-hand rule normal points out of the solid).
 *  - 2D polygons are arrays of [x, y] points in counter-clockwise order, no
 *    repeated closing point. Convex unless stated otherwise.
 *  - Kernel modules must not import from ui/state/worker and must not touch the DOM.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Flat triangle soup: positions.length === 9 * triCount. */
export interface Soup {
  positions: Float32Array;
  triCount: number;
}

/** Indexed mesh produced by welding a soup. */
export interface IndexedMesh {
  /** 3 floats per vertex */
  vertices: Float32Array;
  vertexCount: number;
  /** 3 vertex indices per triangle */
  indices: Uint32Array;
  triCount: number;
}

/** Plane n·p = d, with |n| = 1. "Inside" (kept side) is n·p <= d unless stated otherwise. */
export interface Plane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

/** Counter-clockwise polygon in the XY plane. */
export type Polygon2 = Vec2[];

/** Axis-aligned bounding box. */
export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export interface Bounds2 {
  min: Vec2;
  max: Vec2;
}

/** A closed or open polyline of 3D points produced by a plane cut. */
export interface Loop {
  points: Vec3[];
  closed: boolean;
}

/** Shape of a base footprint or cutter. w = size along X, d = size along Y. */
export type Shape =
  | { kind: 'rect'; w: number; d: number }
  | { kind: 'ellipse'; w: number; d: number };

/**
 * Edge profile of a cut base: how far the side walls lean in from the bottom
 * footprint to the plate top (`inset`, mm per side) and how tall the plate is.
 * 'original' keeps the loaded file's own proportional slope (OPR style).
 */
export type EdgeProfile =
  | { kind: 'inset'; inset: number; height: number }
  | { kind: 'original' };

/** Games Workshop style: 3 mm tall, walls lean in ~0.7 mm per side. */
export const PROFILE_GW: EdgeProfile = { kind: 'inset', inset: 0.7, height: 3.0 };
/** Flat / MDF / Kings of War style: 3 mm tall, straight sides. */
export const PROFILE_FLAT: EdgeProfile = { kind: 'inset', inset: 0, height: 3.0 };
export const PROFILE_ORIGINAL: EdgeProfile = { kind: 'original' };

/** How a freshly cut edge is finished. */
export type EdgeTreatment =
  | { kind: 'bevel' }
  | { kind: 'vertical' }
  | { kind: 'custom'; insetMm: number };

/** Description of the analytic "body" plate of a base or piece. */
export interface BodyOutline {
  /** Footprint at z = 0 (CCW) */
  bottom: Polygon2;
  /** Outline of the flat plate top at z = plateTop (CCW), inside `bottom` */
  top: Polygon2;
  /** Height of the flat plate top above z = 0 */
  plateTop: number;
}

/** Magnet slot definition in the piece's own frame (underside view, mm). */
export interface MagnetSlotSpec {
  x: number;
  y: number;
  /** slot radius including tolerance */
  radius: number;
  /** slot depth including tolerance, measured up from z = 0 */
  depth: number;
  /** polygon segment count for the cylinder wall */
  sides: number;
}

/** Everything the pipeline computes for one piece. */
export interface PieceGeometry {
  outline: BodyOutline;
  /** Analytic solid body (watertight) */
  body: Soup;
  /** Sculpt shell(s) clipped to the piece (may be non-manifold, like the source) */
  sculpt: Soup;
  warnings: string[];
  /** Signed volume of the body in mm^3 */
  bodyVolume: number;
  bounds: Bounds3;
}

/** Growable soup builder to avoid per-triangle allocations. */
export class SoupBuilder {
  private buf: Float32Array;
  private len = 0; // floats used

  constructor(initialTriangles = 1024) {
    this.buf = new Float32Array(Math.max(9, initialTriangles * 9));
  }

  get triCount(): number {
    return this.len / 9;
  }

  private ensure(extraFloats: number): void {
    if (this.len + extraFloats <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + extraFloats) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  /** Push one triangle given three points. */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ): void {
    this.ensure(9);
    const b = this.buf;
    let i = this.len;
    b[i++] = ax; b[i++] = ay; b[i++] = az;
    b[i++] = bx; b[i++] = by; b[i++] = bz;
    b[i++] = cx; b[i++] = cy; b[i++] = cz;
    this.len = i;
  }

  triV(a: Vec3, b: Vec3, c: Vec3): void {
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  /** Copy triangle `t` from a soup's positions array. */
  copyTri(src: Float32Array, t: number): void {
    this.ensure(9);
    this.buf.set(src.subarray(t * 9, t * 9 + 9), this.len);
    this.len += 9;
  }

  /** Append a whole soup. */
  append(soup: Soup): void {
    const n = soup.triCount * 9;
    this.ensure(n);
    this.buf.set(soup.positions.subarray(0, n), this.len);
    this.len += n;
  }

  /** Fan-triangulate a convex polygon of 3D points (CCW as seen from the outward normal). */
  fan(points: ArrayLike<number>, count: number): void {
    // points is a flat array of xyz, count = number of points
    for (let k = 1; k + 1 < count; k++) {
      this.tri(
        points[0], points[1], points[2],
        points[k * 3], points[k * 3 + 1], points[k * 3 + 2],
        points[(k + 1) * 3], points[(k + 1) * 3 + 1], points[(k + 1) * 3 + 2],
      );
    }
  }

  /**
   * Finish: returns a soup viewing the builder's buffer (no copy). The builder
   * must not be used afterwards. The view's underlying buffer may be larger than
   * the view; use `tightSoup` before transferring it between threads.
   */
  build(): Soup {
    return { positions: this.buf.subarray(0, this.len), triCount: this.len / 9 };
  }

  /** Finish with a right-sized copy. */
  buildCopy(): Soup {
    return { positions: this.buf.slice(0, this.len), triCount: this.len / 9 };
  }
}

/** A soup whose positions array owns exactly its own buffer (copy only when needed). */
export function tightSoup(s: Soup): Soup {
  const p = s.positions;
  if (p.byteOffset === 0 && p.byteLength === p.buffer.byteLength) return s;
  return { positions: p.slice(0, s.triCount * 9), triCount: s.triCount };
}

export function emptySoup(): Soup {
  return { positions: new Float32Array(0), triCount: 0 };
}

export function concatSoups(soups: Soup[]): Soup {
  let total = 0;
  for (const s of soups) total += s.triCount;
  const positions = new Float32Array(total * 9);
  let off = 0;
  for (const s of soups) {
    positions.set(s.positions.subarray(0, s.triCount * 9), off);
    off += s.triCount * 9;
  }
  return { positions, triCount: total };
}
