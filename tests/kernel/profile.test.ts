import { describe, it, expect } from 'vitest';
import { prepareSource } from '@/kernel/source/prepareSource';
import { computePiece, sourceFrame, USABLE_INSET } from '@/kernel/pipeline/computePiece';
import { isWatertight } from '@/kernel/mesh/validate';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { polygonBounds } from '@/kernel/geom2d/polygon';
import { syntheticTwoShellBase, loadOprSoup } from '../fixtures/synthetic';
import { PROFILE_FLAT, PROFILE_GW } from '@/kernel/types';

const bevel = [{ kind: 'bevel' as const }, { kind: 'bevel' as const }, { kind: 'bevel' as const }, { kind: 'bevel' as const }];

describe('edge profiles', () => {
  const raw = syntheticTwoShellBase({ shape: 'rect', w: 100, d: 150 });
  const src = prepareSource(raw, 'S_Base_Square_150mm_100mm_1.stl');
  const frame = sourceFrame(src);

  it('GW profile: own 0.7 mm slope on every edge, including edges at the big base rim', () => {
    // top-left corner of the usable area
    const ub = polygonBounds(frame.usable);
    const p = computePiece(frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [ub.min[0] + 12.5, ub.min[1] + 12.5], rotDeg: 0, edges: bevel, profile: PROFILE_GW }, { source: src });
    expect(p.size.w).toBeCloseTo(25, 6);
    expect(p.size.d).toBeCloseTo(25, 6);
    const tb = polygonBounds(p.outline.top);
    expect(tb.max[0] - tb.min[0]).toBeCloseTo(25 - 1.4, 6);
    expect(tb.max[1] - tb.min[1]).toBeCloseTo(25 - 1.4, 6);
    expect(p.outline.plateTop).toBeCloseTo(3.0, 6);
    expect(isWatertight(p.body)).toBe(true);
    // the usable area sits inside the file's sloped rim
    expect(ub.max[0] - ub.min[0]).toBeCloseTo(100 * src.outline.topScale[0] - 2 * USABLE_INSET, 3);
  });

  it('flat profile: straight sides and a chosen plate height shifts the sculpt', () => {
    const p = computePiece(frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [0, 0], rotDeg: 0, edges: bevel, profile: { kind: 'inset', inset: 0, height: 2.0 } }, { source: src });
    const tb = polygonBounds(p.outline.top), bb = polygonBounds(p.outline.bottom);
    expect(tb.max[0] - tb.min[0]).toBeCloseTo(bb.max[0] - bb.min[0], 6);
    expect(p.outline.plateTop).toBeCloseTo(2.0, 6);
    const sb = boundsOfSoup(p.sculpt);
    // sculpt bottom overlaps the plate top by the 0.1 mm margin
    expect(sb.min[2]).toBeCloseTo(2.0 - 0.1, 2);
    expect(isWatertight(p.body)).toBe(true);
  });

  it('nested bases keep their own profile and stay inside the parent plate top', () => {
    const troop = computePiece(frame, { shape: { kind: 'rect', w: 50, d: 125 }, xy: [-20, 0], rotDeg: 0, edges: bevel, profile: PROFILE_FLAT }, { source: src });
    const child = computePiece(troop.frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [-12.5, -50], rotDeg: 0, edges: bevel, profile: PROFILE_GW }, { source: src });
    expect(child.size.w).toBeCloseTo(25 - USABLE_INSET, 3); // clipped to the troop's usable area on the outer edge
    expect(isWatertight(child.body)).toBe(true);
    expect(child.warnings.filter((w) => w.includes('force-closed'))).toEqual([]);
  });

  const real = loadOprSoup('S_Base_Square_100mm_50mm_1.stl');
  it.skipIf(!real)('real file: flat profile against the rim does not graze the sculpt wall', () => {
    const rsrc = prepareSource(real!, 'S_Base_Square_100mm_50mm_1.stl');
    const f = sourceFrame(rsrc);
    const ub = polygonBounds(f.usable);
    const t0 = Date.now();
    const p = computePiece(f, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [ub.min[0] + 12.5, ub.min[1] + 12.5], rotDeg: 0, edges: bevel, profile: PROFILE_FLAT }, { source: rsrc });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(p.sculpt.triCount).toBeGreaterThan(0);
    expect(p.warnings.filter((w) => /force-closed|fragments/.test(w))).toEqual([]);
  });
});
