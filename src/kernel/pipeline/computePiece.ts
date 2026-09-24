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
import { cutColumnAbove, carveSockets, plugFloor, materialThickness } from './plug';
import type { SocketSpec } from './plug';
import { addRing, addWatermark, placeWatermark, ringFor, MIN_CEILING } from '../body/hollow';
import type { KeepOutCircle } from '../body/hollow';
import { offsetEdges, slotWallWarnings, traySurroundCells } from '../tray/cells';
import type { TrayCell } from '../tray/cells';
import { effectiveTrayFloor, buildTray } from '../tray/buildTray';
import { SoupBuilder } from '../types';
import { transformSoup } from '../mesh/transform';
import { signedVolume } from '../mesh/volume';
import { boundsOfPositions, boundsOfSoup } from '../mesh/bbox';
import type { PreparedSource } from '../source/prepareSource';

/**
 * A movement tray: a thin floor with a raised surround, and an opening for every
 * base in the frame it belongs to. Everything is in the SOURCE frame, like the
 * outlines; `computePiece` moves it into the piece's own frame.
 */
export interface TrayParams {
  /** thickness of the flat floor under the whole tray, mm */
  floor: number;
  /** how far the surround stands above the floor: the plate height of the bases in it, mm */
  plateHeight: number;
  /** the slot openings, already grown by the gap (source frame) */
  pockets: Polygon2[];
  /** magnet slots in the floor, one per base, at true size (source frame) */
  magnets?: MagnetSlotSpec[];
  /** material the floor keeps under a recessed magnet, mm */
  magnetFloorMin?: number;
  /** gap per side already built into the pockets, mm */
  gap?: number;
  /** how close a slot may come to the tray's outer edge before it is reported, mm */
  minWall?: number;
  watermark?: string;
  watermarkHeight?: number;
  /** the bases' hollow underside, so a mark can hide under one of them */
  underside?: { depth: number; rim: number; ringWidth: number };
  /** the bases in this frame do not all have the same edge shape, so they cannot all sit level */
  mixedHeights?: boolean;
}

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
  role?: 'base' | 'frame' | 'leftover' | 'tray';
  /** 'full' (default) takes the whole column; 'plug' takes only the top `plugDepth` and the terrain keeps a socket */
  cut?: 'full' | 'plug';
  plugDepth?: number;
  plugClearance?: number;
  /** pockets left by plug bases inside this piece's footprint (source frame) */
  sockets?: SocketSpec[];
  /** set on a movement tray (role 'tray') */
  tray?: TrayParams;
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
  /** set when the base was carved out of the object itself (no plate): its floor in the source frame and its thinnest material */
  carved?: { floorZ: number; thickness: number; plug: boolean };
  /** set on a movement tray: everything the export and the UI need, in the piece's own frame */
  tray?: {
    /** the floor as built (deepened for the magnets when needed), mm */
    floor: number;
    /** the floor the settings asked for, mm */
    floorAsked: number;
    plateHeight: number;
    /** slot openings, local frame */
    pockets: Polygon2[];
    /** magnet holes in the floor, local frame */
    magnets: MagnetSlotSpec[];
    magnetMode: 'none' | 'recess' | 'through';
    /** the floor thickness that would take the magnets fully, mm */
    magnetFloorWanted: number;
    /** the biggest rectangle of floor with no surround across it, mm */
    thinSpan: { w: number; d: number };
    /** how many convex shapes the surround was built from */
    cells: number;
    watermark: boolean;
  };
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
  /** the footprint the cutter asked for, before the parent clipped it (trays report a clipped rim) */
  let askedBounds: { min: Vec2; max: Vec2 } | null = null;
  const sculptMargin = opts.sculptMargin ?? 0.1;
  const scale = opts.scale ?? 1;
  const clearance = opts.clearance ?? 0;
  const topScale = source.outline.topScale;
  const isRoot = params.edges.length === 0 && params.xy[0] === 0 && params.xy[1] === 0 && parent.origin[0] === 0 && parent.origin[1] === 0 && shapesEqual(params.shape, source.nominal);

  // --- cutter outlines (source frame)
  const cx = parent.origin[0] + params.xy[0];
  const cy = parent.origin[1] + params.xy[1];
  // A tray is always a straight-sided plate whose height is its floor plus the surround,
  // which is what makes a slotted base sit flush with it at any floor thickness.
  const trayParams = params.role === 'tray' ? params.tray : undefined;
  // with magnets the floor is made deep enough for them (never a hole through, never a
  // magnet standing proud into a slot), and the surround rises with it, so bases stay flush
  const trayFloor = trayParams ? effectiveTrayFloor(trayParams.floor, trayParams.magnets ?? [], trayParams.magnetFloorMin ?? 0.6) : 0;
  const profile: EdgeProfile = trayParams
    ? { kind: 'inset', inset: 0, height: trayFloor + trayParams.plateHeight }
    : (params.profile ?? { kind: 'original' });
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
    askedBounds = polygonBounds(cutterBottom);
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
  const usableS = params.role === 'frame' || trayParams ? bottomS : insetConvex(topS, USABLE_INSET);
  const frame: ParentFrame = {
    outline: { bottom: bottomS, top: topS, plateTop: plateTopSource },
    origin,
    // a frame does not cut the sculpt at all when it only holds other bases; its children do
    sculptPoly: isRoot || params.role === 'frame' || !sculptCutter || sculptCutter.length < 3 ? parent.sculptPoly : clipConvexPolygons(parent.sculptPoly, sculptCutter),
    usable: usableS.length >= 3 ? usableS : topS,
  };
  if (!isRoot && frame.sculptPoly.length < 3) frame.sculptPoly = insetConvex(topS, sculptMargin);
  // --- how this base is built: on the file's plate (two-shell), carved out of the object, or on a new plate
  const objectMode = source.mode === 'generic';

  // --- a movement tray: chop the surround into convex cells once. The SAME list builds
  // the analytic tray and cuts the scene's sculpt, so the openings can never disagree.
  let trayCells: TrayCell[] = [];
  let trayThinSpan = { w: 0, d: 0 };
  let trayCarveFloor: number | null = null;
  /** object scenes: the least material the scene stands on the floor anywhere over the tray, mm */
  let trayMaterialAbove = 0;
  if (trayParams) {
    if (clearance > 0) warnings.push('A tray is always made at its true size, so “slightly smaller for trays” is ignored for it.');
    if (trayParams.pockets.length === 0) warnings.push('There are no bases in this frame yet, so the tray has nothing to hold.');
    if (trayParams.mixedHeights) warnings.push('The bases in this frame do not all have the same edge shape, so some will not sit level in the tray.');
    // the scene clipped the tray: the frame sits so close to the edge that there is no room for a rim.
    // Measured per side with a real tolerance, because the layout is rounded to 0.01 mm and a
    // hair off the corner is not something to bother anyone about.
    if (askedBounds) {
      const got = polygonBounds(bottomS);
      const lost = Math.max(got.min[0] - askedBounds.min[0], askedBounds.max[0] - got.max[0], got.min[1] - askedBounds.min[1], askedBounds.max[1] - got.max[1]);
      if (lost > 0.2) warnings.push(`There is no room for a rim on every side: the frame reaches the edge of the scene, so the tray is ${lost.toFixed(1)} mm short there. Move the frame in, or use a narrower rim.`);
    }
    const cellRes = traySurroundCells(bottomS, trayParams.pockets);
    trayCells = cellRes.cells;
    trayThinSpan = cellRes.thinSpan;
    warnings.push(...cellRes.warnings);
    warnings.push(...slotWallWarnings(bottomS, trayParams.pockets, trayParams.minWall));
    if (objectMode) {
      // the surround is the scene's own material, carved cell by cell and lifted onto the floor
      trayCarveFloor = 0.05;
      const mt = materialThickness(source.sculpt, source.bins, bottomS, 0);
      if (mt.stats && !mt.flatBottom) warnings.push('The scene is not flat underneath here, so expect small gaps where the tray meets it.');
      if (mt.stats && mt.stats.misses === 0) trayMaterialAbove = Math.max(0, mt.thickness - trayCarveFloor);
      if (mt.stats && mt.thickness < trayParams.plateHeight) warnings.push(`The scene is only ${mt.thickness.toFixed(1)} mm thick over this tray, so its surround is lower than the bases in places.`);
    }
  }
  // the remainder of an object scene: the object itself with the bases' pockets and holes cut into it
  const objectRemainder = objectMode && !isRoot && params.role === 'leftover';
  const isPlug = !isRoot && params.role !== 'frame' && params.cut === 'plug';
  let carvedInfo: PieceResult['carved'];
  let hollowCap: { void: Polygon2; depth: number } | null = null;
  // a slice of the object standing on a plate: `floorZ` is where the slice starts in the source, `lift` how far
  // it is raised onto the plate (0 when the plate instead reaches up to material that floats above the floor)
  let slice: { floorZ: number; lift: number; plateTop: number } | null = null;
  if (!isRoot && params.role !== 'frame' && !objectRemainder && !trayParams) {
    const needed = opts.hollow ? opts.hollow.depth + MIN_CEILING : 1;
    if (isPlug) {
      const depth = Math.max(needed, params.plugDepth ?? 4);
      // two-shell files have no sculpt below the plate top: a plug can only go down to the trim plane
      const bottomZ = objectMode ? 0 : source.sculptTrimZ;
      const pf = plugFloor(source.sculpt, source.bins, bottomS, depth, bottomZ);
      if (pf.stats === null || pf.stats.misses > 0) {
        warnings.push('This base overhangs the object: a plug needs solid material under its whole footprint. It is cut as a full base on a plate instead, and the object keeps a hole where it was.');
      } else if (pf.stats.maxBottom > pf.floorZ + 0.05) {
        // hollow underneath (a shell): back the plug with a plate that reaches up to the skin
        warnings.push('The object is hollow under this base: a backing plate fills the plug, and the socket gets a floor and walls of its own.');
        slice = { floorZ: pf.floorZ, lift: 0, plateTop: Math.max(needed, pf.stats.maxBottom - pf.floorZ + 0.2) };
        carvedInfo = { floorZ: pf.floorZ, thickness: slice.plateTop, plug: true };
      } else {
        if (pf.thickness < depth - 1e-6) warnings.push(`The terrain here is only ${pf.thickness.toFixed(1)} mm thick; the plug is shallower than asked.`);
        carvedInfo = { floorZ: pf.floorZ, thickness: pf.thickness, plug: true };
      }
    } else if (objectMode) {
      const mt = materialThickness(source.sculpt, source.bins, bottomS, 0);
      if (mt.stats && mt.thickness >= needed && mt.flatBottom) carvedInfo = { floorZ: 0.05, thickness: mt.thickness - 0.05, plug: false };
      else if (mt.stats && mt.stats.misses === 0 && mt.stats.maxBottom > 0.3) {
        // material floating above the bottom (a hollow shell): the plate reaches up to it instead of lifting it
        warnings.push('The object is hollow under this base: the plate is made tall enough to back the material above it.');
        slice = { floorZ: 0, lift: 0, plateTop: Math.max(3, mt.stats.maxBottom + 0.2) };
      } else if (mt.stats && !mt.flatBottom) warnings.push('The object is not flat underneath here; a plate is added below it, expect small gaps.');
    }
    if (carvedInfo && opts.hollow) {
      const rimPoly = insetConvex(bottomS, opts.hollow.rim);
      if (carvedInfo.thickness >= opts.hollow.depth + MIN_CEILING && rimPoly.length >= 3 && polygonArea(rimPoly) >= 20) hollowCap = { void: rimPoly, depth: opts.hollow.depth };
      else warnings.push('Too thin to hollow: this base is left solid.');
    }
    if (carvedInfo && params.role !== 'leftover' && profile.kind === 'inset' && profile.inset > 0) warnings.push('Edge slope is not applied to bases carved out of an object; their sides are straight.');
  }
  if (slice) {
    // a plate under (or up to) a slice of the object
    topS = bottomS;
    plateTopSource = slice.plateTop;
    frame.outline = { bottom: bottomS, top: topS, plateTop: plateTopSource };
    frame.sculptPoly = bottomS;
  } else if (carvedInfo) {
    // a carved base is the material itself: its outline is the footprint, its "plate top" its thinnest material
    topS = bottomS;
    plateTopSource = carvedInfo.thickness;
    frame.outline = { bottom: bottomS, top: topS, plateTop: plateTopSource };
    frame.sculptPoly = bottomS;
  } else if (objectRemainder) {
    // the remainder is the object: its own footprint, no plate, nothing lifted
    topS = bottomS;
    plateTopSource = 0;
    frame.outline = { bottom: bottomS, top: topS, plateTop: 0 };
    frame.sculptPoly = source.outline.bottom;
  } else if (trayParams && trayCarveFloor !== null) {
    // an object scene: only the floor is invented, the surround is the scene's own material
    plateTopSource = trayFloor;
    frame.outline = { bottom: bottomS, top: topS, plateTop: plateTopSource };
  } else if (objectMode && !isRoot && plateTopSource < 1) {
    // a plate under a thin object: give it a real height
    plateTopSource = 3;
    frame.outline = { bottom: bottomS, top: topS, plateTop: plateTopSource };
  }
  // sculpt sits on the plate: shift it if this base's plate is a different height from the file's;
  // a carved base is shifted so its floor becomes z = 0
  const zShift = trayParams && trayCarveFloor !== null
    ? trayFloor - trayCarveFloor
    : slice ? slice.lift - slice.floorZ : carvedInfo ? -carvedInfo.floorZ : plateTopSource - source.outline.plateTop;
  timings.outline = now() - t0; t0 = now();

  // --- local frame + output sizing
  let bottomL = translatePolygon(bottomS, -origin[0], -origin[1]);
  let topL = translatePolygon(topS, -origin[0], -origin[1]);
  if (clearance > 0 && !trayParams) {
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

  // --- body: the plate (with its hollow underside), or for carved bases only the rings + watermark
  let body: Soup;
  let underside: PieceResult['underside'];
  let trayInfo: PieceResult['tray'];
  const toLocal = (p: Polygon2): Polygon2 => {
    const l = translatePolygon(p, -origin[0], -origin[1]);
    return scale !== 1 ? scalePolygonAbout(l, scale, scale, 0, 0) : l;
  };
  if (trayParams) {
    // the tray: a floor prism with the magnet holes in it, plus one prism per surround cell.
    // In an object scene the surround is the scene's own material, so only the floor is built here.
    const cellsL = trayCells.map((c) => ({ ...c, poly: toLocal(c.poly) }));
    const pocketsL = trayParams.pockets.map(toLocal);
    const magnetsL = (trayParams.magnets ?? []).map((m) => ({ ...m, x: (m.x - origin[0]) * scale, y: (m.y - origin[1]) * scale }));
    const res = buildTray(bottomL, trayCarveFloor !== null ? [] : cellsL, {
      floor: trayFloor * scale,
      plateHeight: trayParams.plateHeight * scale,
      magnets: magnetsL.length ? { slots: magnetsL, floorMin: trayParams.magnetFloorMin ?? 0.6 } : undefined,
      watermark: trayParams.watermark,
      watermarkHeight: trayParams.watermarkHeight,
      underside: trayParams.underside,
      pockets: pocketsL,
      gap: trayParams.gap,
      // in an object scene the outer wall is the floor band plus the scene's own material standing on it
      markMaxZ: trayCarveFloor !== null ? (trayFloor + trayMaterialAbove) * scale : undefined,
    });
    warnings.push(...res.warnings);
    body = res.soup;
    trayInfo = {
      floor: trayFloor * scale,
      floorAsked: trayParams.floor * scale,
      plateHeight: trayParams.plateHeight * scale,
      pockets: pocketsL,
      magnets: magnetsL,
      magnetMode: res.magnets,
      magnetFloorWanted: res.magnetFloorWanted,
      thinSpan: trayThinSpan,
      cells: trayCells.length,
      watermark: res.watermark,
    };
  } else if ((isRoot || objectRemainder) && objectMode) {
    body = { positions: new Float32Array(0), triCount: 0 };
  } else if (carvedInfo && !slice) {
    const out = new SoupBuilder(256);
    if (hollowCap && opts.hollow) {
      const local = translatePolygon(hollowCap.void, -origin[0], -origin[1]);
      const voidL = scale !== 1 ? scalePolygonAbout(local, scale, scale, 0, 0) : local;
      const d = hollowCap.depth;
      const keepOut: KeepOutCircle[] = [];
      for (const slot of slots) {
        const r = ringFor(slot, voidL, opts.hollow);
        if ('reason' in r) { warnings.push(r.reason); continue; }
        addRing(out, slot.x, slot.y, r.ri, r.ro, d - opts.hollow.ringHeight, d + 0.1, slot.sides);
        keepOut.push({ x: slot.x, y: slot.y, r: r.ro });
      }
      let watermark = false;
      const text = opts.hollow.watermark.trim();
      if (text && opts.hollow.watermarkHeight > 0) {
        const place = placeWatermark(voidL, text, keepOut);
        if (place) { addWatermark(out, text, place, d, Math.min(opts.hollow.watermarkHeight, d - 0.2)); watermark = true; }
      }
      underside = { rim: voidL, depth: d, watermark };
    }
    body = out.build();
  } else {
    const bodyRes = buildBody(outline, slots, opts.hollow);
    warnings.push(...bodyRes.warnings);
    body = bodyRes.soup;
    underside = bodyRes.underside;
  }
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
  } else if (isRoot || objectRemainder) {
    sculpt = meshToSoup(source.sculpt);
  } else if (slice && slice.floorZ > 0) {
    const col = cutColumnAbove(source.sculpt, source.bins, bottomS, slice.floorZ, { stamp: opts.stamp });
    warnings.push(...col.warnings.map((w) => 'sculpt: ' + w));
    sculpt = col.soup;
  } else if (carvedInfo) {
    const col = cutColumnAbove(source.sculpt, source.bins, bottomS, carvedInfo.floorZ, { stamp: opts.stamp, hollow: hollowCap ?? undefined });
    warnings.push(...col.warnings.map((w) => 'sculpt: ' + w));
    sculpt = col.soup;
  } else if (trayParams) {
    // One cut per surround cell. `stamp.id` MUST be bumped before every one of them:
    // `clipTriangles` skips triangles already stamped in this pass, so sharing one id
    // would silently rob every cell after the first of the triangles the first touched.
    const parts: Soup[] = [];
    for (const cell of trayCells) {
      if (opts.stamp) opts.stamp.id++;
      if (trayCarveFloor !== null) {
        // an object scene: the surround is a closed column of the scene's own material
        const col = cutColumnAbove(source.sculpt, source.bins, cell.poly, trayCarveFloor, { stamp: opts.stamp });
        warnings.push(...col.warnings.map((w) => 'surround: ' + w));
        if (col.soup.triCount > 0) parts.push(col.soup);
        continue;
      }
      // the scenery stops just inside each slot wall; seams keep the cell's own edge so
      // neighbouring cells overlap instead of leaving a hairline crack across the tray
      const inset = offsetEdges(cell.poly, cell.onPocket.map((p) => (p ? sculptMargin : 0)));
      const poly = clipConvexPolygons(frame.sculptPoly, inset.length >= 3 ? inset : cell.poly);
      if (poly.length < 3 || polygonArea(poly) < 1e-6) continue;
      const cut = cutPrism(source.sculpt, source.bins, poly, { stamp: opts.stamp });
      warnings.push(...cut.warnings.map((w) => 'sculpt: ' + w));
      if (cut.soup.triCount > 0) parts.push(cut.soup);
    }
    sculpt = parts.length ? concatSoups(parts) : { positions: new Float32Array(0), triCount: 0 };
  } else {
    const cut = cutPrism(source.sculpt, source.bins, frame.sculptPoly, { stamp: opts.stamp });
    warnings.push(...cut.warnings.map((w) => 'sculpt: ' + w));
    sculpt = cut.soup;
  }
  // pockets left by plug bases inside this piece (leftover terrain): carve them before moving to the local frame
  if (params.sockets && params.sockets.length && sculpt.triCount > 0) {
    const r = carveSockets(sculpt, objectRemainder ? source.outline.bottom : carvedInfo ? bottomS : frame.sculptPoly, params.sockets);
    warnings.push(...r.warnings.map((w) => 'socket: ' + w));
    sculpt = r.soup;
  }
  if (sculpt.triCount > 0) {
    sculpt = transformSoup(sculpt, { translate: [-origin[0], -origin[1], zShift] }, true);
    if (clearance > 0 && !trayParams) {
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
    underside,
    carved: carvedInfo,
    tray: trayInfo,
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
