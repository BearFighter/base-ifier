/**
 * Compute the geometry of one piece of the cut tree: analytic body from clipped
 * outlines, sculpt cut by a vertical convex prism, magnet slots in the bottom.
 * All outlines are kept in the SOURCE frame; the returned soups are translated
 * into the piece's local frame (origin = centre of its footprint bbox).
 */
import type { BodyOutline, EdgeProfile, EdgeTreatment, IndexedMesh, MagnetSlotSpec, Polygon2, Shape, Soup, Vec2 } from '../types';
import { concatSoups } from '../types';
import { clipConvexPolygons } from '../geom2d/clipConvex';
import { insetConvex, insetConvexEdges } from '../geom2d/offset';
import { polygonArea, polygonBounds, polygonCentroid, scalePolygonAbout, translatePolygon } from '../geom2d/polygon';
import { shapePolygon } from '../geom2d/shapes';
import { buildBody } from '../body/buildBody';
import type { HollowSpec } from '../body/hollow';
import { checkMagnetSlots } from '../body/magnetSlots';
import { cutPrism } from '../sculpt/cutPrism';
import { transformSoup } from '../mesh/transform';
import { signedVolume } from '../mesh/volume';
import { boundsOfPositions, boundsOfSoup } from '../mesh/bbox';
import type { PreparedSource } from '../source/prepareSource';

export interface PieceParams {
  shape: Shape;
  /** centre of the cutter in the parent's local frame */
  xy: Vec2;
  rotDeg: number;
  /** per-edge treatments, only used by the 'original' profile */
  edges: EdgeTreatment[];
  /** edge profile of this base; default 'original' */
  profile?: EdgeProfile;
  /** a 'frame' is a reference outline: bases inside it are clipped to its footprint, not to a plate top */
  role?: 'base' | 'frame' | 'leftover';
}

/** Children are placed at least this far inside their parent's plate top, so their cuts never graze the parent's cut faces. */
export const USABLE_INSET = 0.3;

/** Source-frame description of the parent (or of the source itself for a root piece). */
export interface ParentFrame {
  outline: BodyOutline;
  /** parent origin in the source frame */
  origin: Vec2;
  /** convex polygon (source frame) bounding the parent's sculpt */
  sculptPoly: Polygon2;
  /** area (source frame) children with an 'inset' profile are clipped to: the plate top minus USABLE_INSET */
  usable: Polygon2;
}

export interface ComputeOptions {
  source: PreparedSource;
  /** magnet slots in the piece's local frame */
  magnetSlots?: MagnetSlotSpec[];
  magnetCheck?: { floorMin: number; minWall: number };
  /** how far inside the top outline the sculpt is cut, mm */
  sculptMargin?: number;
  /** uniform output scale (e.g. 0.9947 to match the OPR set); magnets stay true size */
  scale?: number;
  /** per-side XY clearance subtracted from the footprint, mm */
  clearance?: number;
  /** skip the (expensive) sculpt cut, e.g. for outline-only previews */
  skipSculpt?: boolean;
  /** reusable stamp buffer for cutPrism */
  stamp?: { arr: Uint32Array; id: number };
  /** hollow the underside (brim + void + magnet rings + watermark); omitted = solid plate */
  hollow?: HollowSpec;
}

export interface PieceResult {
  /** outlines in the source frame (unscaled), used as the frame for children */
  frame: ParentFrame;
  /** outline in the piece's local frame, after scale/clearance */
  outline: BodyOutline;
  origin: Vec2;
  body: Soup;
  /** cut sculpt (non-indexed); empty when `sculptMesh` is set */
  sculpt: Soup;
  /** root pieces reference the source's indexed sculpt instead of copying it */
  sculptMesh?: IndexedMesh;
  warnings: string[];
  bodyVolume: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** footprint size (unscaled, nominal mm) */
  size: { w: number; d: number };
  timings: Record<string, number>;
  /** the hollow underside actually built (local frame): void outline, depth, whether the watermark fit */
  underside?: { rim: Polygon2; depth: number; watermark: boolean };
}

/** Frame of the source itself (used as the parent of root pieces). */
export function sourceFrame(source: PreparedSource, sculptMargin = 0.1): ParentFrame {
  const o = source.outline;
  const usable = insetConvex(o.top, USABLE_INSET);
  return {
    outline: { bottom: o.bottom, top: o.top, plateTop: o.plateTop },
    origin: [0, 0],
    // a polygon comfortably containing the whole sculpt so inherited edges never cut it
    sculptPoly: expandConvex(o.top, 1 + sculptMargin),
    usable: usable.length >= 3 ? usable : o.top,
  };
}

/** Root piece params: the whole source. */
export function rootPieceParams(source: PreparedSource): PieceParams {
  return { shape: source.nominal, xy: [0, 0], rotDeg: 0, edges: [] };
}

export function computePiece(parent: ParentFrame, params: PieceParams, opts: ComputeOptions): PieceResult {
  const timings: Record<string, number> = {};
  let t0 = now();
  const warnings: string[] = [];
  const source = opts.source;
  const sculptMargin = opts.sculptMargin ?? 0.1;
  const scale = opts.scale ?? 1;
  const clearance = opts.clearance ?? 0;
  const topScale = source.outline.topScale;
  const isRoot = params.edges.length === 0 && params.xy[0] === 0 && params.xy[1] === 0 && parent.origin[0] === 0 && parent.origin[1] === 0 && shapesEqual(params.shape, source.nominal);

  // --- cutter outlines (source frame)
  const cx = parent.origin[0] + params.xy[0];
  const cy = parent.origin[1] + params.xy[1];
  const profile: EdgeProfile = params.profile ?? { kind: 'original' };
  let bottomS: Polygon2, topS: Polygon2;
  let sculptCutter: Polygon2 | null = null;
  let plateTopSource = parent.outline.plateTop;
  if (isRoot) {
    bottomS = parent.outline.bottom;
    topS = parent.outline.top;
  } else if (profile.kind === 'inset') {
    // Own profile on every edge: the base lives inside the parent's usable plate top, its walls
    // lean in by `inset` all round, and the sculpt is cut just inside its own top outline.
    const cutterBottom = shapePolygon(params.shape, cx, cy, params.rotDeg);
    bottomS = clipConvexPolygons(parent.usable, cutterBottom);
    if (bottomS.length < 3 || polygonArea(bottomS) < 1e-6) {
      throw new Error('The cutter does not overlap the parent piece.');
    }
    topS = profile.inset > 0 ? insetConvex(bottomS, profile.inset) : bottomS;
    if (topS.length < 3 || polygonArea(topS) < 1e-6) {
      warnings.push('Too small for its edge slope; using straight sides.');
      topS = bottomS;
    }
    sculptCutter = insetConvex(bottomS, profile.inset + sculptMargin);
    plateTopSource = profile.height;
  } else {
    const cutterBottom = shapePolygon(params.shape, cx, cy, params.rotDeg);
    const cutterTop = cutterTopOutline(cutterBottom, params, topScale, [cx, cy]);
    bottomS = clipConvexPolygons(parent.outline.bottom, cutterBottom);
    topS = clipConvexPolygons(parent.outline.top, cutterTop);
    if (bottomS.length < 3 || polygonArea(bottomS) < 1e-6) {
      throw new Error('The cutter does not overlap the parent piece.');
    }
    if (topS.length < 3 || polygonArea(topS) < 1e-6) {
      warnings.push('Top outline collapsed (piece too small for its bevel); using vertical walls.');
      topS = bottomS;
    }
    // The sculpt is cut only along the cutter's OWN edges (inset by the margin). Edges inherited
    // from the parent keep the parent's sculpt boundary, which sits safely outside the sculpt;
    // cutting there again would graze the sculpt's vertical wall and produce thousands of slivers.
    sculptCutter = insetConvex(cutterTop, sculptMargin);
  }
  const bb = polygonBounds(bottomS);
  const origin: Vec2 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2];
  const size = { w: bb.max[0] - bb.min[0], d: bb.max[1] - bb.min[1] };
  const usableS = params.role === 'frame' ? bottomS : insetConvex(topS, USABLE_INSET);
  const frame: ParentFrame = {
    outline: { bottom: bottomS, top: topS, plateTop: plateTopSource },
    origin,
    // a frame does not cut the sculpt at all when it only holds other bases; its children do
    sculptPoly: isRoot || params.role === 'frame' || !sculptCutter || sculptCutter.length < 3 ? parent.sculptPoly : clipConvexPolygons(parent.sculptPoly, sculptCutter),
    usable: usableS.length >= 3 ? usableS : topS,
  };
  if (!isRoot && frame.sculptPoly.length < 3) frame.sculptPoly = insetConvex(topS, sculptMargin);
  // sculpt sits on the plate: shift it if this base's plate is a different height from the file's
  const zShift = plateTopSource - source.outline.plateTop;
  timings.outline = now() - t0; t0 = now();

  // --- local frame + output sizing
  let bottomL = translatePolygon(bottomS, -origin[0], -origin[1]);
  let topL = translatePolygon(topS, -origin[0], -origin[1]);
  if (clearance > 0) {
    const b2 = insetConvex(bottomL, clearance), t2 = insetConvex(topL, clearance);
    if (b2.length >= 3 && t2.length >= 3) { bottomL = b2; topL = t2; }
    else warnings.push('Clearance is larger than the piece; ignored.');
  }
  if (scale !== 1) {
    bottomL = scalePolygonAbout(bottomL, scale, scale, 0, 0);
    topL = scalePolygonAbout(topL, scale, scale, 0, 0);
  }
  const plateTop = plateTopSource * scale;
  const outline: BodyOutline = { bottom: bottomL, top: topL, plateTop };

  // --- magnets
  const slots = (opts.magnetSlots ?? []).map((s) => ({ ...s, x: s.x * scale, y: s.y * scale }));
  if (opts.magnetCheck && slots.length && !opts.hollow) warnings.push(...checkMagnetSlots(outline, slots, opts.magnetCheck));

  // --- body
  const bodyRes = buildBody(outline, slots, opts.hollow);
  warnings.push(...bodyRes.warnings);
  const body = bodyRes.soup;
  timings.body = now() - t0; t0 = now();

  // --- sculpt
  let sculpt: Soup;
  let sculptMesh: IndexedMesh | undefined;
  const rootUntouched = isRoot && scale === 1 && clearance === 0;
  if (opts.skipSculpt) {
    sculpt = { positions: new Float32Array(0), triCount: 0 };
  } else if (rootUntouched) {
    sculpt = { positions: new Float32Array(0), triCount: 0 };
    sculptMesh = source.sculpt;
  } else if (isRoot) {
    sculpt = meshToSoup(source.sculpt);
  } else {
    const cut = cutPrism(source.sculpt, source.bins, frame.sculptPoly, { stamp: opts.stamp });
    warnings.push(...cut.warnings.map((w) => 'sculpt: ' + w));
    sculpt = cut.soup;
  }
  if (sculpt.triCount > 0) {
    sculpt = transformSoup(sculpt, { translate: [-origin[0], -origin[1], zShift] }, true);
    if (clearance > 0) {
      // keep the sculpt inside the reduced footprint
      const poly = insetConvex(translatePolygon(frame.sculptPoly, -origin[0], -origin[1]), clearance);
      if (poly.length >= 3) {
        const m = meshFromSoup(sculpt);
        const cut = cutPrism(m, null, poly);
        sculpt = cut.soup;
      }
    }
    if (scale !== 1) sculpt = transformSoup(sculpt, { scale: [scale, scale, scale] }, true);
  }
  timings.sculpt = now() - t0; t0 = now();

  let bounds = sculpt.triCount ? boundsOfSoup(concatSoups([body, sculpt])) : boundsOfSoup(body);
  if (sculptMesh) {
    const sb = boundsOfPositions(sculptMesh.vertices, sculptMesh.vertexCount * 3);
    bounds = {
      min: [Math.min(bounds.min[0], sb.min[0]), Math.min(bounds.min[1], sb.min[1]), Math.min(bounds.min[2], sb.min[2])],
      max: [Math.max(bounds.max[0], sb.max[0]), Math.max(bounds.max[1], sb.max[1]), Math.max(bounds.max[2], sb.max[2])],
    };
  }
  return {
    frame,
    outline,
    origin,
    body,
    sculpt,
    sculptMesh,
    warnings,
    bodyVolume: signedVolume(body),
    bounds,
    size,
    timings,
    underside: bodyRes.underside,
  };
}

/** Top outline of a cutter given its edge treatments and the source's top/bottom scale. */
export function cutterTopOutline(cutterBottom: Polygon2, params: PieceParams, topScale: [number, number], centre: Vec2): Polygon2 {
  const edges = params.edges;
  const bb = polygonBounds(cutterBottom);
  const hw = (bb.max[0] - bb.min[0]) / 2, hd = (bb.max[1] - bb.min[1]) / 2;
  if (params.shape.kind === 'ellipse') {
    const e = edges[0] ?? { kind: 'bevel' };
    if (e.kind === 'bevel') {
      const c = polygonCentroid(cutterBottom);
      return scalePolygonAbout(cutterBottom, topScale[0], topScale[1], c[0], c[1]);
    }
    if (e.kind === 'vertical') return cutterBottom;
    return insetConvex(cutterBottom, e.insetMm);
  }
  const insets: number[] = [];
  const n = cutterBottom.length;
  for (let i = 0; i < n; i++) {
    const a = cutterBottom[i], b = cutterBottom[(i + 1) % n];
    const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    const e = edges[i] ?? { kind: 'bevel' };
    if (e.kind === 'bevel') insets.push(horizontal ? (1 - topScale[1]) * hd : (1 - topScale[0]) * hw);
    else if (e.kind === 'vertical') insets.push(0);
    else insets.push(e.insetMm);
  }
  void centre;
  const top = insetConvexEdges(cutterBottom, insets);
  return top.length >= 3 ? top : cutterBottom;
}

/** Offset every edge of a CCW convex polygon outward by d (line intersections of consecutive offset edges). */
export function expandConvex(poly: Polygon2, d: number): Polygon2 {
  const n = poly.length;
  if (n < 3) return poly;
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // outward normal of a CCW edge is (dy, -dx)
    const ox = (dy / len) * d, oy = (-dx / len) * d;
    lines.push({ px: a[0] + ox, py: a[1] + oy, dx, dy });
  }
  const out: Polygon2 = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n], l2 = lines[i];
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-12) { out.push([l2.px, l2.py]); continue; }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    out.push([l1.px + l1.dx * t, l1.py + l1.dy * t]);
  }
  return out;
}

function shapesEqual(a: Shape, b: Shape): boolean {
  return a.kind === b.kind && Math.abs(a.w - b.w) < 1e-9 && Math.abs(a.d - b.d) < 1e-9;
}

export function meshToSoup(m: { vertices: Float32Array; indices: Uint32Array; triCount: number }): Soup {
  const positions = new Float32Array(m.triCount * 9);
  const V = m.vertices, I = m.indices;
  for (let t = 0; t < m.triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const i = I[t * 3 + v] * 3;
      positions[t * 9 + v * 3] = V[i]; positions[t * 9 + v * 3 + 1] = V[i + 1]; positions[t * 9 + v * 3 + 2] = V[i + 2];
    }
  }
  return { positions, triCount: m.triCount };
}

function meshFromSoup(s: Soup): { vertices: Float32Array; vertexCount: number; indices: Uint32Array; triCount: number } {
  // no welding needed for a one-off cut; each vertex is unique (keys stay consistent within a triangle)
  const indices = new Uint32Array(s.triCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { vertices: s.positions, vertexCount: s.triCount * 3, indices, triCount: s.triCount };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
