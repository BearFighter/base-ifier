/**
 * Cutting bases out of solid terrain instead of a thin plate.
 *
 * - A "carved" base is the material column inside the footprint from a floor
 *   height up: the object's own bottom (a thick, flat object needs no plate
 *   under it) or, for a PLUG, a floor `plugDepth` below the lowest terrain
 *   point over the footprint. Its underside is trimmed flat and hollowed like
 *   any other base (brim annulus, void walls, ceiling).
 * - The terrain a plug came from keeps a SOCKET: a pocket from the plug's floor
 *   up, its outline the footprint plus a clearance, so the plug drops back in.
 *   Carving a pocket out of a mesh without a CSG library: split the column at
 *   the floor, keep the lower part whole (its cap is the pocket floor), and cut
 *   the upper part into the convex wedges that surround the socket.
 */
import type { IndexedMesh, Plane, Polygon2, Soup, Vec2, Vec3 } from '../types';
import { SoupBuilder, concatSoups } from '../types';
import { clipTriangles } from '../clip/clipper';
import { chainLoops, planeBasis, toUV } from '../clip/loops';
import type { LoopResult } from '../clip/loops';
import { capLoops } from '../clip/cap';
import { earcutFull } from '../clip/earcutFull';
import { cutPrism } from '../sculpt/cutPrism';
import { weld } from '../mesh/weld';
import { clipPolygonByHalfPlane } from '../geom2d/clipConvex';
import { polygonArea } from '../geom2d/polygon';
import type { Bins } from '../sculpt/bins';
import { columnStats, type ColumnStats } from '../sculpt/height';
import { boundsOfSoup } from '../mesh/bbox';

/** A hollow underside to build into a carved column's floor. */
export interface HollowCap {
  /** void outline (same frame as the cut), CCW, strictly inside the footprint */
  void: Polygon2;
  /** void depth above the floor, mm */
  depth: number;
}

/**
 * A hole bored up into a carved floor: `poly` (CCW) is cut out of the floor cap; its walls and
 * ceiling are built from `depth`, unless `fill` builds the inside itself (an engraved mark).
 */
export interface FloorPocket {
  poly: Polygon2;
  depth: number;
  fill?: (out: SoupBuilder, z0: number) => void;
}

export interface ColumnResult {
  soup: Soup;
  warnings: string[];
}

/** Keep the part of the mesh at or below z; the opening is capped facing +z. */
export function trimBelow(mesh: IndexedMesh, z: number): ColumnResult {
  const plane: Plane = { nx: 0, ny: 0, nz: 1, d: z };
  const out = new SoupBuilder(Math.max(1024, mesh.triCount));
  const res = clipTriangles(mesh, [plane], { out });
  const warnings: string[] = [];
  const { loops, warnings: w } = chainLoops(res.segments[0], planeBasis(plane));
  warnings.push(...w.map((s) => 'floor: ' + s));
  capLoops(loops, plane, out, warnings);
  return { soup: out.build(), warnings };
}

/** Outset a convex CCW polygon by `d` (edges moved outward, corners at the offset-line intersections). */
export function outsetConvex(p: Polygon2, d: number): Polygon2 {
  const n = p.length;
  if (n < 3 || d === 0) return p.slice();
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // outward normal of a CCW polygon: rotate the edge direction 90° clockwise
    const nx = dy / len, ny = -dx / len;
    lines.push({ px: a[0] + nx * d, py: a[1] + ny * d, dx, dy });
  }
  const out: Polygon2 = [];
  for (let i = 0; i < n; i++) {
    const l0 = lines[(i + n - 1) % n], l1 = lines[i];
    const det = l0.dx * l1.dy - l0.dy * l1.dx;
    if (Math.abs(det) < 1e-12) continue;
    const t = ((l1.px - l0.px) * l1.dy - (l1.py - l0.py) * l1.dx) / det;
    out.push([l0.px + l0.dx * t, l0.py + l0.dy * t]);
  }
  return out;
}

/**
 * The material column inside `poly` from `floorZ` up. The floor is capped
 * flat, or, with `hollow`, as a brim annulus plus void walls and ceiling so
 * the result is one closed shell with a hollow underside.
 */
export function cutColumnAbove(
  mesh: IndexedMesh,
  bins: Bins | null,
  poly: Polygon2,
  floorZ: number,
  opts: { stamp?: { arr: Uint32Array; id: number }; hollow?: HollowCap; pockets?: FloorPocket[] } = {},
): ColumnResult {
  const warnings: string[] = [];
  const col = cutPrism(mesh, bins, poly, { stamp: opts.stamp });
  warnings.push(...col.warnings.map((w) => 'column: ' + w));
  if (col.soup.triCount === 0) return { soup: col.soup, warnings };
  const m = weld(col.soup);
  const plane: Plane = { nx: 0, ny: 0, nz: -1, d: -floorZ }; // keep z >= floorZ
  const out = new SoupBuilder(Math.max(1024, m.triCount));
  const res = clipTriangles(m, [plane], { out });
  const basis = planeBasis(plane);
  const { loops, warnings: w } = chainLoops(res.segments[0], basis);
  warnings.push(...w.map((s) => 'floor: ' + s));
  // the void of a hollow underside and any other pockets (magnet holes, an engraved mark) are all holes in the floor cap
  const pockets = [...(opts.hollow ? [{ poly: opts.hollow.void, depth: opts.hollow.depth }] : []), ...(opts.pockets ?? [])];
  if (pockets.length === 0) {
    capLoops(loops, plane, out, warnings);
    return { soup: out.build(), warnings };
  }
  capWithPockets(loops, plane, basis, pockets, floorZ, out, warnings);
  return { soup: out.build(), warnings };
}

/**
 * Cap the floor loops with every pocket (CCW polygons: the void of a hollow underside, magnet
 * holes, the pockets of an engraved mark) as a hole in the outer loop that holds them, then add
 * each pocket's walls and ceiling. Pockets that do not lie inside that loop are left out.
 */
function capWithPockets(loops: LoopResult[], plane: Plane, basis: ReturnType<typeof planeBasis>, pockets: FloorPocket[], floorZ: number, out: SoupBuilder, warnings: string[]): void {
  const prepared = pockets.map((pk) => {
    const uv: number[] = [];
    for (const p of pk.poly) {
      const [u, w] = toUV(basis, p[0], p[1], floorZ);
      uv.push(u, w);
    }
    // a hole must wind opposite to the outers (negative area in the basis)
    const area = signedAreaUV(uv);
    return { pk, holeUV: area > 0 ? reverseUV(uv) : uv, holePts: (area > 0 ? pk.poly.slice().reverse() : pk.poly).map((p) => [p[0], p[1], floorZ] as Vec3) };
  });
  const outers = loops.filter((l) => l.area > 0);
  const others = loops.filter((l) => l.area <= 0);
  let host: LoopResult | null = null;
  const first = prepared[0].holeUV;
  for (const o of outers) {
    if (pointInLoopUV(o.uv, first[0], first[1])) {
      if (!host || o.area < host.area) host = o;
    }
  }
  if (!host) {
    warnings.push(pockets.length === 1 ? 'underside: the void does not fit inside the floor; left solid' : 'underside: the pockets do not fit inside the floor; left solid');
    capLoops(loops, plane, out, warnings);
    return;
  }
  const h = host;
  const inside = prepared.filter((q) => {
    for (let i = 0; i < q.holeUV.length; i += 2) if (!pointInLoopUV(h.uv, q.holeUV[i], q.holeUV[i + 1])) return false;
    return true;
  });
  if (inside.length < prepared.length) warnings.push('underside: a pocket reaches past the edge of the floor and is left out');
  // every other loop is capped as usual
  capLoops([...outers.filter((o) => o !== h), ...others], plane, out, warnings);
  const flat = h.uv.slice();
  const pts = h.points.slice();
  const holeIdx: number[] = [];
  for (const q of inside) {
    holeIdx.push(flat.length / 2);
    for (let i = 0; i < q.holeUV.length; i++) flat.push(q.holeUV[i]);
    for (const p of q.holePts) pts.push(p);
  }
  let tris: number[] = [];
  try {
    tris = earcutFull(flat, holeIdx.length ? holeIdx : undefined, warnings);
  } catch (e) {
    warnings.push('underside: earcut failed: ' + String(e));
  }
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = pts[tris[i]], b = pts[tris[i + 1]], c = pts[tris[i + 2]];
    const ex1 = b[0] - a[0], ey1 = b[1] - a[1], ez1 = b[2] - a[2];
    const ex2 = c[0] - a[0], ey2 = c[1] - a[1], ez2 = c[2] - a[2];
    const nx = ey1 * ez2 - ez1 * ey2, ny = ez1 * ex2 - ex1 * ez2, nz = ex1 * ey2 - ey1 * ex2;
    if (nx * plane.nx + ny * plane.ny + nz * plane.nz >= 0) out.triV(a, b, c);
    else out.triV(a, c, b);
  }
  // walls (facing into the pocket) and ceiling (facing down), sharing the hole's vertices
  for (const q of inside) {
    if (q.pk.fill) { q.pk.fill(out, floorZ); continue; }
    const ring = q.pk.poly; // CCW in XY
    const n = ring.length;
    const z0 = floorZ, z1 = floorZ + q.pk.depth;
    for (let i = 0; i < n; i++) {
      const p = ring[i], r = ring[(i + 1) % n];
      out.tri(p[0], p[1], z0, r[0], r[1], z1, r[0], r[1], z0);
      out.tri(p[0], p[1], z0, p[0], p[1], z1, r[0], r[1], z1);
    }
    for (let i = 1; i + 1 < n; i++) out.tri(ring[0][0], ring[0][1], z1, ring[i + 1][0], ring[i + 1][1], z1, ring[i][0], ring[i][1], z1);
  }
}

function signedAreaUV(uv: number[]): number {
  let a = 0;
  const n = uv.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += uv[i * 2] * uv[j * 2 + 1] - uv[j * 2] * uv[i * 2 + 1];
  }
  return a / 2;
}

function reverseUV(uv: number[]): number[] {
  const n = uv.length / 2;
  const r: number[] = new Array(uv.length);
  for (let i = 0; i < n; i++) {
    r[i * 2] = uv[(n - 1 - i) * 2];
    r[i * 2 + 1] = uv[(n - 1 - i) * 2 + 1];
  }
  return r;
}

function pointInLoopUV(uv: number[], x: number, y: number): boolean {
  let inside = false;
  const n = uv.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = uv[i * 2], yi = uv[i * 2 + 1], xj = uv[j * 2], yj = uv[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Convex pieces of `outer` minus the convex `hole` (both CCW): one wedge per hole edge. */
export function complementWedges(outer: Polygon2, hole: Polygon2): Polygon2[] {
  const wedges: Polygon2[] = [];
  let rest = outer;
  const n = hole.length;
  for (let i = 0; i < n && rest.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % n];
    // the hole's interior is on the left of a->b; the wedge is what lies on its right
    const w = clipPolygonByHalfPlane(rest, b, a);
    if (w.length >= 3 && polygonArea(w) > 1e-6) wedges.push(w);
    rest = clipPolygonByHalfPlane(rest, a, b);
  }
  return wedges;
}

export interface SocketSpec {
  /** pocket outline (footprint + clearance), same frame as the column, CCW */
  poly: Polygon2;
  /** pocket floor height */
  floorZ: number;
  /**
   * The object is hollow under the pocket (its material does not reach the floor):
   * add a cup of this wall thickness, floor at `floorZ`, walls up to `topZ`, so the plug has something to sit in.
   */
  backing?: { thickness: number; topZ: number };
}

/** Wall thickness of the backing cup added under a socket in a hollow object, mm. */
export const BACKING_THICKNESS = 1.2;

/** A closed prism: convex CCW polygon extruded from z0 to z1. */
export function addPrism(out: SoupBuilder, poly: Polygon2, z0: number, z1: number): void {
  const n = poly.length;
  if (n < 3 || z1 <= z0) return;
  for (let i = 1; i + 1 < n; i++) out.tri(poly[0][0], poly[0][1], z0, poly[i + 1][0], poly[i + 1][1], z0, poly[i][0], poly[i][1], z0);
  for (let i = 1; i + 1 < n; i++) out.tri(poly[0][0], poly[0][1], z1, poly[i][0], poly[i][1], z1, poly[i + 1][0], poly[i + 1][1], z1);
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    out.tri(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1);
    out.tri(a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1);
  }
}

/** A closed polygonal ring: the wall between `inner` and `outer` (same vertex count, CCW) from z0 to z1. */
export function addPolyRing(out: SoupBuilder, inner: Polygon2, outer: Polygon2, z0: number, z1: number): void {
  const n = inner.length;
  if (n < 3 || outer.length !== n || z1 <= z0) return;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ii = inner[i], ij = inner[j], oi = outer[i], oj = outer[j];
    // outer wall faces outward, inner wall faces into the pocket
    out.tri(oi[0], oi[1], z0, oj[0], oj[1], z0, oj[0], oj[1], z1);
    out.tri(oi[0], oi[1], z0, oj[0], oj[1], z1, oi[0], oi[1], z1);
    out.tri(ii[0], ii[1], z0, ij[0], ij[1], z1, ij[0], ij[1], z0);
    out.tri(ii[0], ii[1], z0, ii[0], ii[1], z1, ij[0], ij[1], z1);
    // bottom annulus faces -z, top annulus faces +z
    out.tri(oi[0], oi[1], z0, ii[0], ii[1], z0, ij[0], ij[1], z0);
    out.tri(oi[0], oi[1], z0, ij[0], ij[1], z0, oj[0], oj[1], z0);
    out.tri(oi[0], oi[1], z1, oj[0], oj[1], z1, ij[0], ij[1], z1);
    out.tri(oi[0], oi[1], z1, ij[0], ij[1], z1, ii[0], ii[1], z1);
  }
}

/**
 * Cut sockets (pockets from their floor up, or holes through) out of a closed
 * column that spans `columnPoly`. Every cut works shell by shell: the column
 * is kept as a list of closed parts and each socket splits only the parts it
 * touches (welding parts together first would fuse their coincident faces into
 * a non-manifold mesh and corrupt the next cut).
 */
export function carveSockets(column: Soup, columnPoly: Polygon2, sockets: SocketSpec[]): ColumnResult {
  const warnings: string[] = [];
  let parts: Soup[] = [column];
  const outer = outsetConvex(columnPoly, 1);
  for (const socket of sockets) {
    const sb = boundsOf2D(socket.poly);
    const next: Soup[] = [];
    for (const part of parts) {
      if (part.triCount === 0) continue;
      const pb = boundsOfSoup(part);
      if (pb.max[0] <= sb.minX || pb.min[0] >= sb.maxX || pb.max[1] <= sb.minY || pb.min[1] >= sb.maxY) { next.push(part); continue; }
      const m = weld(part);
      if (socket.floorZ > pb.min[2] + 1e-6) {
        const below = trimBelow(m, socket.floorZ);
        warnings.push(...below.warnings);
        if (below.soup.triCount > 0) next.push(below.soup);
      }
      if (socket.floorZ >= pb.max[2] - 1e-6) continue; // the part lies entirely below the floor
      for (const w of complementWedges(outer, socket.poly)) {
        const r = cutColumnAbove(m, null, w, Math.max(socket.floorZ, pb.min[2]), {});
        warnings.push(...r.warnings);
        if (r.soup.triCount > 0) next.push(r.soup);
      }
    }
    if (socket.backing) {
      // a cup the plug can sit in: a floor slab under the pocket and a wall around it, up to the object's top there
      const cup = new SoupBuilder(512);
      const t = socket.backing.thickness;
      const outerPoly = outsetConvex(socket.poly, t);
      addPrism(cup, outerPoly, socket.floorZ - t, socket.floorZ);
      addPolyRing(cup, socket.poly, outerPoly, socket.floorZ, Math.max(socket.floorZ + t, socket.backing.topZ));
      next.push(cup.buildCopy());
    }
    parts = next;
  }
  return { soup: concatSoups(parts), warnings };
}

/** One socket; see `carveSockets`. */
export function carveSocket(column: Soup, columnPoly: Polygon2, socket: SocketSpec): ColumnResult {
  return carveSockets(column, columnPoly, [socket]);
}

function boundsOf2D(poly: Polygon2): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY };
}

export interface PlugFloor {
  floorZ: number;
  stats: ColumnStats | null;
  /** how much material the plug is guaranteed to have from its floor to the lowest terrain point */
  thickness: number;
}

/**
 * Where a plug's floor goes: `depth` below the lowest terrain top over the
 * footprint, never below the object's bottom (`bottomZ`) plus a skin so a
 * fresh flat floor is always cut.
 */
export function plugFloor(mesh: IndexedMesh, bins: Bins | null, footprint: Polygon2, depth: number, bottomZ = 0): PlugFloor {
  const stats = columnStats(mesh, bins, footprint);
  const skin = 0.05;
  if (!stats) return { floorZ: bottomZ + skin, stats, thickness: 0 };
  const floorZ = Math.max(bottomZ + skin, stats.minTop - depth);
  return { floorZ, stats, thickness: stats.minTop - floorZ };
}

export interface SocketDecision extends SocketSpec {
  /** true: the base takes the whole column, so the socket is a hole through the object */
  through: boolean;
  /** the footprint is not fully on solid material */
  partial: boolean;
  /** the object is hollow under the pocket floor (its material stops above it) */
  hollowBelow: boolean;
}

/**
 * The pocket a base leaves in the object it was cut from. A plug leaves a
 * pocket `depth` deep; a full-cut base, or any base whose footprint overhangs
 * the object (a plug needs solid material under all of it), leaves a hole
 * straight through.
 */
export function socketFor(mesh: IndexedMesh, bins: Bins | null, footprint: Polygon2, opts: { plug: boolean; depth: number; clearance: number; bottomZ: number }): SocketDecision {
  const stats = columnStats(mesh, bins, footprint);
  const partial = !stats || stats.misses > 0;
  const poly = outsetConvex(footprint, opts.clearance);
  if (!opts.plug || partial || !stats) return { poly, floorZ: opts.bottomZ, through: true, partial, hollowBelow: false };
  const pf = plugFloor(mesh, bins, footprint, opts.depth, opts.bottomZ);
  // a shell (hollow tank hull, an arch seen from above): the pocket floor would hang in air
  const hollowBelow = stats.maxBottom > pf.floorZ + 0.05;
  return { poly, floorZ: pf.floorZ, through: false, partial: false, hollowBelow, backing: hollowBelow ? { thickness: BACKING_THICKNESS, topZ: stats.maxTop } : undefined };
}

/** Sample points of the footprint for tests and the UI: minimum material over the whole footprint from bottomZ. */
export function materialThickness(mesh: IndexedMesh, bins: Bins | null, footprint: Polygon2, bottomZ = 0): { thickness: number; flatBottom: boolean; stats: ColumnStats | null } {
  const stats = columnStats(mesh, bins, footprint);
  if (!stats) return { thickness: 0, flatBottom: false, stats };
  return { thickness: stats.minTop - bottomZ, flatBottom: stats.maxBottom - bottomZ <= 0.3 && stats.misses === 0, stats };
}

export type { Vec2 };
