import { describe, it, expect } from 'vitest';
import { buildBody } from '@/kernel/body/buildBody';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { DEFAULT_HOLLOW, textPixels, placeWatermark } from '@/kernel/body/hollow';
import { rectPolygon, ellipsePolygon } from '@/kernel/geom2d/shapes';
import { scalePolygonAbout, polygonArea, pointInConvexPolygon, minEdgeDistance } from '@/kernel/geom2d/polygon';
import { insetConvex } from '@/kernel/geom2d/offset';
import { isWatertight } from '@/kernel/mesh/validate';
import { signedVolume } from '@/kernel/mesh/volume';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { presupport, DEFAULT_PRESUPPORT } from '@/kernel/pipeline/presupport';
import { prepareSource } from '@/kernel/source/prepareSource';
import { computePiece, sourceFrame, rootPieceParams } from '@/kernel/pipeline/computePiece';
import { syntheticSculpt, loadOprSoup } from '../fixtures/synthetic';
import type { EdgeTreatment, Soup, Vec3 } from '@/kernel/types';

const PLATE = 2.984;
const sizing = { dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 24 };

function outline(w: number, d: number) {
  const bottom = rectPolygon(w, d);
  return { bottom, top: scalePolygonAbout(bottom, 0.9237, 0.9237, 0, 0), plateTop: PLATE };
}

function countZ(soup: Soup, z: number, eps = 1e-4): number {
  let n = 0;
  for (let i = 2; i < soup.triCount * 9; i += 3) if (Math.abs(soup.positions[i] - z) < eps) n++;
  return n;
}

describe('hollow underside', () => {
  it('is a closed body with a 2 mm void inside a 2 mm brim and a ceiling', () => {
    const o = outline(25, 25);
    const solid = buildBody(o, []);
    const res = buildBody(o, [], { ...DEFAULT_HOLLOW, watermark: '' });
    expect(res.warnings).toEqual([]);
    expect(res.underside).toBeDefined();
    expect(res.underside!.depth).toBeCloseTo(2, 9);
    expect(res.underside!.watermark).toBe(false);
    expect(isWatertight(res.soup)).toBe(true);
    expect(polygonArea(res.underside!.rim)).toBeCloseTo(21 * 21, 6);
    // the void removes exactly its prism from the solid volume
    expect(signedVolume(res.soup)).toBeCloseTo(signedVolume(solid.soup) - 21 * 21 * 2, 3);
    // vertices on the seating plane (brim) and on the ceiling
    expect(countZ(res.soup, 0)).toBeGreaterThan(0);
    expect(countZ(res.soup, 2)).toBeGreaterThan(0);
    expect(boundsOfSoup(res.soup).min[2]).toBeCloseTo(0, 9);
  });

  it('holds each magnet in a cup from the ceiling to the bottom, flush with the brim, and warns when one hits the brim', () => {
    const o = outline(40, 40);
    const slots = magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]);
    const d = slots[0].depth; // 2.1: the void follows the magnet so its face can sit flush
    const plain = buildBody(o, [], { ...DEFAULT_HOLLOW, depth: d, watermark: '' });
    const res = buildBody(o, slots, { ...DEFAULT_HOLLOW, watermark: '' });
    expect(res.warnings).toEqual([]);
    expect(isWatertight(res.soup)).toBe(true);
    expect(res.underside!.depth).toBeCloseTo(d, 9);
    // the cup is a tube from the seating plane to 0.1 mm into the ceiling
    const ri = slots[0].radius, ro = ri + DEFAULT_HOLLOW.ringWidth, n = slots[0].sides;
    const tube = 0.5 * n * Math.sin((2 * Math.PI) / n) * (ro * ro - ri * ri) * (d + 0.1);
    const delta = signedVolume(res.soup) - signedVolume(plain.soup);
    expect(delta).toBeCloseTo(tube, 3);
    // its rim lies in the seating plane
    const P = res.soup.positions;
    let rim = 0;
    for (let i = 0; i < res.soup.triCount * 9; i += 3) {
      const r = Math.hypot(P[i], P[i + 1]);
      if (Math.abs(P[i + 2]) < 1e-9 && r > ri - 1e-6 && r < ro + 1e-6) rim++;
    }
    expect(rim).toBeGreaterThan(n);
    // a thinner magnet gets a plug above it, so its hole is exactly its own depth
    const thin = magnetSlotSpecs({ ...sizing, thick: 1 }, [{ x: 0, y: 0 }]);
    const tres = buildBody(o, thin, { ...DEFAULT_HOLLOW, watermark: '' });
    expect(isWatertight(tres.soup)).toBe(true);
    expect(tres.underside!.depth).toBeCloseTo(2, 9);
    expect(countZ(tres.soup, thin[0].depth)).toBeGreaterThan(0);
    // a magnet on the brim cannot get a cup
    const edge = buildBody(o, magnetSlotSpecs(sizing, [{ x: 18, y: 0 }]), { ...DEFAULT_HOLLOW, watermark: '' });
    expect(edge.warnings.some((w) => /too close to the brim/.test(w))).toBe(true);
    expect(isWatertight(edge.soup)).toBe(true);
  });

  it('raises the watermark on the ceiling, mirrored, clear of the rings, and skips it when there is no room', () => {
    const t = textPixels('AB');
    expect(t.cols).toBe(11);
    expect(t.on(0, 1)).toBe(true); // top of A
    expect(t.on(0, 0)).toBe(false);
    const o = outline(40, 40);
    const res = buildBody(o, magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]), DEFAULT_HOLLOW);
    expect(res.underside!.watermark).toBe(true);
    expect(isWatertight(res.soup)).toBe(true);
    const bare = buildBody(o, magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]), { ...DEFAULT_HOLLOW, watermark: '' });
    expect(res.soup.triCount).toBeGreaterThan(bare.soup.triCount);
    // watermark boxes live between the ceiling and 0.3 mm below it, inside the void
    const inner = insetConvex(res.underside!.rim, 0.5);
    const p = res.soup.positions;
    const d = res.underside!.depth;
    for (let i = bare.soup.triCount * 9; i < res.soup.triCount * 9; i += 3) {
      expect(p[i + 2]).toBeGreaterThanOrEqual(d - DEFAULT_HOLLOW.watermarkHeight - 1e-6);
      expect(p[i + 2]).toBeLessThanOrEqual(d + 0.1 + 1e-6);
      expect(pointInConvexPolygon(inner, p[i], p[i + 1], 1e-6)).toBe(true);
      expect(Math.hypot(p[i], p[i + 1])).toBeGreaterThan(1.6 + DEFAULT_HOLLOW.ringWidth); // never inside the magnet ring
    }
    // too small: a 20 mm base has a 16 mm void; 12 characters do not fit legibly
    expect(placeWatermark(rectPolygon(16, 16), 'BITDEATHLABS', [])).toBeNull();
    expect(placeWatermark(rectPolygon(46, 21), 'BITDEATHLABS', [])).not.toBeNull();
    const small = buildBody(outline(20, 20), [], DEFAULT_HOLLOW);
    expect(small.underside!.watermark).toBe(false);
    expect(isWatertight(small.soup)).toBe(true);
  });

  it('falls back to a solid plate when the base is too small or too thin to hollow', () => {
    const tiny = buildBody(outline(6, 6), [], DEFAULT_HOLLOW);
    expect(tiny.underside).toBeUndefined();
    expect(tiny.warnings.some((w) => /too small to hollow/.test(w))).toBe(true);
    expect(isWatertight(tiny.soup)).toBe(true);
    const thin = buildBody({ ...outline(25, 25), plateTop: 1.0 }, [], DEFAULT_HOLLOW);
    expect(thin.underside).toBeUndefined();
    expect(thin.warnings.some((w) => /too thin to hollow/.test(w))).toBe(true);
    // a plate barely thick enough keeps the minimum ceiling
    const clamp = buildBody({ ...outline(25, 25), plateTop: 2.0 }, [], DEFAULT_HOLLOW);
    expect(clamp.underside!.depth).toBeCloseTo(1.2, 9);
  });

  it('works for round bases', () => {
    const bottom = ellipsePolygon(32, 32, 64);
    const res = buildBody({ bottom, top: scalePolygonAbout(bottom, 0.921, 0.921, 0, 0), plateTop: PLATE }, magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]), DEFAULT_HOLLOW);
    expect(res.warnings).toEqual([]);
    expect(isWatertight(res.soup)).toBe(true);
    for (const q of res.underside!.rim) expect(minEdgeDistance(bottom, q[0], q[1])).toBeCloseTo(DEFAULT_HOLLOW.rim, 1);
  });

  it('puts print-ready supports on the brim and on the void ceiling, never on the void wall', () => {
    const o = outline(50, 25);
    const slots = magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]);
    const built = buildBody(o, slots, DEFAULT_HOLLOW);
    const res = presupport({ body: built.soup, sculpt: syntheticSculpt(50, 25, PLATE), bottom: o.bottom, slots, underside: built.underside });
    expect(res.warnings).toEqual([]);
    expect(isWatertight(res.supports)).toBe(true);
    // undo tilt/lift: contacts must sit at local z = 0 (brim) or on the ceiling (2.1: the void follows the magnet)
    const t = (res.tiltDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const lift = DEFAULT_PRESUPPORT.standoff + 12.5 * s;
    const local = (p: Vec3): Vec3 => {
      const z = p[2] - lift;
      return res.axis === 'x' ? [p[0], p[1] * c + z * s, -p[1] * s + z * c] : [p[0] * c - z * s, p[1], p[0] * s + z * c];
    };
    let brim = 0, ceiling = 0;
    const rim = built.underside!.rim;
    for (const p of res.contacts) {
      const l = local(p);
      if (Math.abs(l[2]) < 1e-3) {
        brim++;
        // on the brim: outside the void, inside the footprint
        expect(pointInConvexPolygon(rim, l[0], l[1], -1e-6)).toBe(false);
        expect(pointInConvexPolygon(o.bottom, l[0], l[1])).toBe(true);
      } else {
        expect(l[2]).toBeCloseTo(built.underside!.depth, 3);
        ceiling++;
        expect(minEdgeDistance(rim, l[0], l[1])).toBeGreaterThan(0.99);
        expect(Math.hypot(l[0], l[1])).toBeGreaterThan(slots[0].radius + 0.6 + DEFAULT_PRESUPPORT.slotClearance - 1e-6);
      }
    }
    expect(brim).toBeGreaterThan(10);
    expect(ceiling).toBeGreaterThan(3);
  });

  it('hollows a base cut from the real 25 mm OPR file (skips when the set is absent)', () => {
    const soup = loadOprSoup('S_Base_Square_25mm_1.stl');
    if (!soup) return;
    const src = prepareSource(soup, 'S_Base_Square_25mm_1.stl');
    const root = computePiece(sourceFrame(src), rootPieceParams(src), { source: src, hollow: DEFAULT_HOLLOW, skipSculpt: true });
    expect(root.underside).toBeDefined();
    expect(isWatertight(root.body)).toBe(true);
    const edges: EdgeTreatment[] = [{ kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];
    const child = computePiece(root.frame, { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges, profile: { kind: 'inset', inset: 0, height: 3 } }, { source: src, hollow: DEFAULT_HOLLOW, magnetSlots: magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]), skipSculpt: true });
    expect(child.underside!.depth).toBeCloseTo(2.1, 6); // deep enough for the 2 mm magnet + 0.1 mm tolerance
    expect(isWatertight(child.body)).toBe(true);
    expect(child.warnings.filter((w) => /brim|hollow/.test(w))).toEqual([]);
  });
});
