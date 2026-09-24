import { describe, it, expect } from 'vitest';
import { prepareSource } from '@/kernel/source/prepareSource';
import { computePiece, sourceFrame, rootPieceParams } from '@/kernel/pipeline/computePiece';
import { complementWedges, outsetConvex, carveSocket, cutColumnAbove, plugFloor, materialThickness, socketFor, BACKING_THICKNESS, addPrism, addPolyRing } from '@/kernel/pipeline/plug';
import { columnStats, heightsAt } from '@/kernel/sculpt/height';
import { autoTiltDeg, DEFAULT_PRESUPPORT, presupport } from '@/kernel/pipeline/presupport';
import { DEFAULT_HOLLOW } from '@/kernel/body/hollow';
import { rectPolygon } from '@/kernel/geom2d/shapes';
import { polygonArea, pointInConvexPolygon } from '@/kernel/geom2d/polygon';
import { isWatertight } from '@/kernel/mesh/validate';
import { signedVolume } from '@/kernel/mesh/volume';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { weld } from '@/kernel/mesh/weld';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { boxSoup } from '../fixtures/synthetic';
import { concatSoups, SoupBuilder } from '@/kernel/types';
import type { EdgeTreatment, Soup } from '@/kernel/types';

const FLAT: EdgeTreatment[] = [{ kind: 'vertical' }, { kind: 'vertical' }, { kind: 'vertical' }, { kind: 'vertical' }];
const KOW = { kind: 'inset' as const, inset: 0, height: 3 };
const GW = { kind: 'inset' as const, inset: 0.7, height: 3 };
const sizing = { dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 24 };

function slab(w: number, d: number, h: number) {
  return prepareSource(boxSoup(w, d, h), `slab_${w}x${d}.stl`);
}

function minZ(s: Soup): number {
  return boundsOfSoup(s).min[2];
}
function maxZ(s: Soup): number {
  return boundsOfSoup(s).max[2];
}

describe('object mode (single-shell files)', () => {
  it('keeps the whole mesh and adds no plate under the scene', () => {
    const src = slab(40, 40, 8);
    expect(src.mode).toBe('generic');
    expect(src.outline.plateTop).toBe(0);
    expect(src.sculpt.triCount).toBe(12); // an untrimmed box
    expect(polygonArea(src.outline.bottom)).toBeCloseTo(1600, 3);
    const root = computePiece(sourceFrame(src), rootPieceParams(src), { source: src });
    expect(root.body.triCount).toBe(0);
    expect(root.bounds.max[2]).toBeCloseTo(8, 6);
    expect(polygonArea(sourceFrame(src).usable)).toBeCloseTo(39.4 * 39.4, 3);
  });

  it('measures the material under a footprint', () => {
    const src = slab(40, 40, 8);
    expect(heightsAt(src.sculpt, src.bins, 0, 0)).toEqual({ top: 8, bottom: 0 });
    expect(heightsAt(src.sculpt, src.bins, 30, 0)).toBeNull();
    const st = columnStats(src.sculpt, src.bins, rectPolygon(20, 20))!;
    expect(st.minTop).toBeCloseTo(8, 6);
    expect(st.maxBottom).toBeCloseTo(0, 6);
    expect(st.misses).toBe(0);
    const mt = materialThickness(src.sculpt, src.bins, rectPolygon(20, 20));
    expect(mt.thickness).toBeCloseTo(8, 6);
    expect(mt.flatBottom).toBe(true);
    const pf = plugFloor(src.sculpt, src.bins, rectPolygon(20, 20), 4);
    expect(pf.floorZ).toBeCloseTo(4, 6);
    expect(pf.thickness).toBeCloseTo(4, 6);
  });

  it('carves a full-cut base out of a thick object instead of adding a plate', () => {
    const src = slab(40, 40, 8);
    const slots = magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]);
    const r = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW }, { source: src, hollow: DEFAULT_HOLLOW, magnetSlots: slots });
    expect(r.carved).toBeDefined();
    expect(r.carved!.plug).toBe(false);
    expect(r.carved!.thickness).toBeCloseTo(7.95, 2);
    expect(r.underside).toBeDefined();
    expect(r.underside!.depth).toBeCloseTo(2.1, 6); // deep enough for the 2 mm magnet + 0.1 mm tolerance
    // the base is the object's own material: floor at z = 0, top at the object's top, one closed shell with a hollow underside
    expect(minZ(r.sculpt)).toBeCloseTo(0, 6);
    expect(maxZ(r.sculpt)).toBeCloseTo(7.95, 2);
    expect(isWatertight(r.sculpt)).toBe(true);
    // the body carries only the magnet cup (and watermark), no plate: nothing above 0.1 mm into the ceiling
    expect(r.body.triCount).toBeGreaterThan(0);
    expect(isWatertight(r.body)).toBe(true);
    expect(maxZ(r.body)).toBeLessThanOrEqual(r.underside!.depth + 0.1 + 1e-5);
    const volSolid = 20 * 20 * 7.95;
    const volVoid = 16 * 16 * r.underside!.depth;
    expect(signedVolume(r.sculpt)).toBeCloseTo(volSolid - volVoid, 1);
    expect(r.outline.plateTop).toBeCloseTo(7.95, 2);
    expect(r.warnings.filter((w) => /plate|slope/i.test(w))).toEqual([]);
  });

  it('adds a plate under a base cut from a thin object', () => {
    const src = slab(40, 40, 2);
    const r = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(r.carved).toBeUndefined();
    expect(r.outline.plateTop).toBeCloseTo(3, 6);
    expect(r.body.triCount).toBeGreaterThan(0);
    expect(isWatertight(r.body)).toBe(true);
    // the 2 mm slice of the object sits on top of the plate
    expect(minZ(r.sculpt)).toBeCloseTo(3, 6);
    expect(maxZ(r.sculpt)).toBeCloseTo(5, 6);
  });

  it('cuts a plug: only the top of the terrain, hollowed, and warns about a sloped edge', () => {
    const src = slab(40, 40, 8);
    const r = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 20, d: 20 }, xy: [5, -3], rotDeg: 0, edges: FLAT, profile: GW, cut: 'plug', plugDepth: 4, plugClearance: 0.2 }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(r.carved!.plug).toBe(true);
    expect(r.carved!.floorZ).toBeCloseTo(4, 6);
    expect(r.carved!.thickness).toBeCloseTo(4, 6);
    expect(minZ(r.sculpt)).toBeCloseTo(0, 6);
    expect(maxZ(r.sculpt)).toBeCloseTo(4, 6);
    expect(isWatertight(r.sculpt)).toBe(true);
    expect(r.underside!.depth).toBeCloseTo(2, 6);
    expect(signedVolume(r.sculpt)).toBeCloseTo(20 * 20 * 4 - 16 * 16 * 2, 1);
    expect(r.warnings.some((w) => /slope/.test(w))).toBe(true);
    expect(r.outline.top).toEqual(r.outline.bottom);
    // a shallower plug when the terrain is thinner than asked
    const thin = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW, cut: 'plug', plugDepth: 12 }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(thin.carved!.floorZ).toBeCloseTo(0.05, 6);
    expect(thin.warnings.some((w) => /shallower/.test(w))).toBe(true);
  });

  it('decomposes the terrain around a socket into convex wedges and outsets the socket', () => {
    const outer = rectPolygon(40, 40);
    const hole = rectPolygon(20, 20);
    const wedges = complementWedges(outer, hole);
    expect(wedges.length).toBe(4);
    expect(wedges.reduce((a, w) => a + polygonArea(w), 0)).toBeCloseTo(1600 - 400, 6);
    const grown = outsetConvex(hole, 0.2);
    expect(polygonArea(grown)).toBeCloseTo(20.4 * 20.4, 6);
    for (const p of grown) expect(pointInConvexPolygon(hole, p[0], p[1])).toBe(false);
  });

  it('carves a socket into the leftover terrain so the plug drops back in', () => {
    const src = slab(40, 40, 8);
    const column = cutColumnAbove(src.sculpt, src.bins, rectPolygon(40, 40), 0.05, {}).soup;
    const socket = { poly: outsetConvex(rectPolygon(20, 20), 0.2), floorZ: 4 };
    const r = carveSocket(column, rectPolygon(40, 40), socket);
    expect(r.warnings.filter((w) => /forced|failed/.test(w))).toEqual([]);
    // volume: the whole column minus the pocket
    expect(signedVolume(r.soup)).toBeCloseTo(40 * 40 * 7.95 - 20.4 * 20.4 * 4, 1);
    // nothing is left inside the pocket above its floor
    const P = r.soup.positions;
    let inside = 0, floorVerts = 0;
    for (let i = 0; i < r.soup.triCount * 9; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (Math.abs(x) < 10.2 - 1e-6 && Math.abs(y) < 10.2 - 1e-6 && z > 4 + 1e-6) inside++;
      if (Math.abs(x) <= 10.2 + 1e-6 && Math.abs(y) <= 10.2 + 1e-6 && Math.abs(z - 4) < 1e-6) floorVerts++;
    }
    expect(inside).toBe(0);
    expect(floorVerts).toBeGreaterThan(0);
    // every part is a closed shell of its own
    const m = weld(r.soup);
    expect(m.triCount).toBe(r.soup.triCount);
  });

  it('a leftover of an object scene is the object itself with the plug socket in it', () => {
    const src = slab(40, 40, 8);
    const frame = sourceFrame(src);
    const plug = computePiece(frame, { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW, cut: 'plug', plugDepth: 4 }, { source: src, hollow: DEFAULT_HOLLOW });
    const leftover = computePiece(frame, { shape: { kind: 'rect', w: 40, d: 40 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW, role: 'leftover', sockets: [{ poly: outsetConvex(rectPolygon(20, 20), 0.2), floorZ: plug.carved!.floorZ }] }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(leftover.carved).toBeUndefined();
    expect(leftover.body.triCount).toBe(0);
    const vol = signedVolume(leftover.sculpt);
    const expected = 40 * 40 * 8 - 20.4 * 20.4 * 4;
    expect(Math.abs(vol - expected)).toBeLessThan(expected * 0.01);
    expect(leftover.warnings.filter((w) => /failed/.test(w))).toEqual([]);
  });

  it('keeps the whole object as the remainder, with a pocket for a plug and a hole for a full base', () => {
    const src = slab(40, 40, 8);
    const frame = sourceFrame(src);
    const pocket = socketFor(src.sculpt, src.bins, rectPolygon(20, 20).map(([x, y]) => [x - 8, y] as [number, number]), { plug: true, depth: 4, clearance: 0.2, bottomZ: 0 });
    expect(pocket.through).toBe(false);
    expect(pocket.floorZ).toBeCloseTo(4, 6);
    const hole = socketFor(src.sculpt, src.bins, rectPolygon(10, 10).map(([x, y]) => [x + 12, y + 12] as [number, number]), { plug: false, depth: 4, clearance: 0, bottomZ: 0 });
    expect(hole.through).toBe(true);
    expect(hole.floorZ).toBe(0);
    const rest = computePiece(frame, { shape: { kind: 'rect', w: 40, d: 40 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: GW, role: 'leftover', sockets: [pocket, hole] }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(rest.body.triCount).toBe(0);
    expect(rest.underside).toBeUndefined();
    expect(rest.carved).toBeUndefined();
    expect(minZ(rest.sculpt)).toBeCloseTo(0, 6);
    expect(maxZ(rest.sculpt)).toBeCloseTo(8, 6);
    const expected = 40 * 40 * 8 - 20.4 * 20.4 * 4 - 10 * 10 * 8;
    expect(Math.abs(signedVolume(rest.sculpt) - expected)).toBeLessThan(expected * 0.01);
    expect(rest.warnings.filter((w) => /failed|slope/.test(w))).toEqual([]);
  });

  it('a base over a gap in the object cannot be a plug: it gets a plate and the object keeps a hole', () => {
    // two slabs with a 10 mm gap between them (an arch seen from above); a base across the gap is only half on material
    const src = prepareSource(concatSoups([boxSoup(40, 15, 8, 0, 12.5), boxSoup(40, 15, 8, 0, -12.5)]), 'two_slabs_40mm_40mm.stl');
    expect(src.mode).toBe('generic');
    const half = socketFor(src.sculpt, src.bins, rectPolygon(20, 20), { plug: true, depth: 4, clearance: 0.2, bottomZ: 0 });
    expect(half.partial).toBe(true);
    expect(half.through).toBe(true);
    const r = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW, cut: 'plug', plugDepth: 4 }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(r.carved).toBeUndefined();
    expect(r.warnings.some((w) => /overhangs/.test(w))).toBe(true);
    expect(r.outline.plateTop).toBeCloseTo(3, 6);
    expect(isWatertight(r.body)).toBe(true);
    // only the two 5 mm strips of slab under the footprint sit on the plate
    expect(minZ(r.sculpt)).toBeCloseTo(3, 6);
    const v = signedVolume(r.sculpt);
    expect(v).toBeGreaterThan(1500);
    expect(v).toBeLessThan(1610);
  });

  it('backs a plug and its socket when the object is hollow underneath', () => {
    // a 2 mm roof on two legs: hollow under the middle
    const src = prepareSource(concatSoups([boxSoup(40, 40, 2, 0, 0, 6), boxSoup(40, 4, 6, 0, 18), boxSoup(40, 4, 6, 0, -18)]), 'roof_40mm_40mm.stl');
    expect(src.mode).toBe('generic');
    const d = socketFor(src.sculpt, src.bins, rectPolygon(20, 20), { plug: true, depth: 4, clearance: 0.2, bottomZ: 0 });
    expect(d.partial).toBe(false);
    expect(d.hollowBelow).toBe(true);
    expect(d.floorZ).toBeCloseTo(4, 6);
    expect(d.backing).toEqual({ thickness: BACKING_THICKNESS, topZ: 8 });
    // the plug: a hollow plate reaching up to the roof, with the roof slice on top
    const r = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW, cut: 'plug', plugDepth: 4 }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(r.warnings.some((w) => /hollow under/.test(w))).toBe(true);
    expect(r.carved!.plug).toBe(true);
    expect(r.outline.plateTop).toBeCloseTo(2.8, 6); // max(void 2 + 0.8, roof bottom 6 - floor 4 + 0.2)
    expect(r.body.triCount).toBeGreaterThan(0);
    expect(isWatertight(r.body)).toBe(true);
    expect(r.underside!.depth).toBeCloseTo(2, 6);
    expect(minZ(r.body)).toBeCloseTo(0, 6);
    expect(minZ(r.sculpt)).toBeCloseTo(2, 6); // the roof slice, 6..8 in the object, sits at 2..4 in the plug
    expect(maxZ(r.sculpt)).toBeCloseTo(4, 6);
    // the remainder gets a cup under the pocket: floor 1.2 mm below the socket floor, walls up to the roof
    const rest = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 40, d: 40 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW, role: 'leftover', sockets: [d] }, { source: src, hollow: DEFAULT_HOLLOW });
    const P = rest.sculpt.positions;
    let cupFloor = 0, cupWall = 0;
    for (let i = 0; i < rest.sculpt.triCount * 9; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (Math.abs(z - (4 - BACKING_THICKNESS)) < 1e-6 && Math.abs(x) <= 10.2 + BACKING_THICKNESS + 1e-6) cupFloor++;
      if (Math.abs(z - 8) < 1e-6 && Math.abs(Math.abs(x) - (10.2 + BACKING_THICKNESS)) < 1e-6) cupWall++;
    }
    expect(cupFloor).toBeGreaterThan(0);
    expect(cupWall).toBeGreaterThan(0);
    // the cup is two closed shells of its own
    const cup = new SoupBuilder(64);
    const outerPoly = outsetConvex(d.poly, BACKING_THICKNESS);
    addPrism(cup, outerPoly, d.floorZ - BACKING_THICKNESS, d.floorZ);
    expect(isWatertight(cup.buildCopy())).toBe(true);
    const ring = new SoupBuilder(64);
    addPolyRing(ring, d.poly, outerPoly, d.floorZ, 8);
    expect(isWatertight(ring.buildCopy())).toBe(true);
    expect(signedVolume(ring.buildCopy())).toBeGreaterThan(0);
    expect(signedVolume(cup.buildCopy())).toBeCloseTo((20.4 + 2 * BACKING_THICKNESS) ** 2 * BACKING_THICKNESS, 3);
    const noCup = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 40, d: 40 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW, role: 'leftover', sockets: [{ poly: d.poly, floorZ: d.floorZ }] }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(signedVolume(rest.sculpt)).toBeGreaterThan(signedVolume(noCup.sculpt) + 100);
    // a full cut over the same hollow spot: the plate is made tall enough to reach the roof, nothing is lifted
    const full = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(full.carved).toBeUndefined();
    expect(full.outline.plateTop).toBeCloseTo(6.2, 6);
    expect(minZ(full.sculpt)).toBeCloseTo(6, 6);
    expect(maxZ(full.sculpt)).toBeCloseTo(8, 6);
    expect(full.warnings.some((w) => /hollow under/.test(w))).toBe(true);
  });

  it('prints flat-sided (Kings of War) bases without a tilt', () => {
    expect(autoTiltDeg({ kind: 'rect', w: 25, d: 25 }, KOW)).toBe(0);
    expect(autoTiltDeg({ kind: 'rect', w: 25, d: 25 }, GW)).toBe(45);
    expect(autoTiltDeg({ kind: 'rect', w: 25, d: 25 })).toBe(45);
    const src = slab(40, 40, 8);
    const r = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges: FLAT, profile: KOW }, { source: src, hollow: DEFAULT_HOLLOW });
    const sup = presupport({ body: r.body, sculpt: r.sculpt, bottom: r.outline.bottom, slots: [], underside: r.underside }, { ...DEFAULT_PRESUPPORT, tiltDeg: 0 });
    expect(sup.tiltDeg).toBe(0);
    expect(minZ(sup.sculpt)).toBeCloseTo(DEFAULT_PRESUPPORT.standoff, 3);
    expect(isWatertight(sup.supports)).toBe(true);
  });
});
