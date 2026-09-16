import { describe, it, expect } from 'vitest';
import { newStudioDocument } from '@/kernel/studio/document';
import type { StudioDocument } from '@/kernel/studio/document';
import { bakeStudio, buildGround, effectiveHeightCap, scatterScene, NO_ASSETS } from '@/kernel/studio/bake';
import { computePiece, sourceFrame, rootPieceParams } from '@/kernel/pipeline/computePiece';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { DEFAULT_HOLLOW } from '@/kernel/body/hollow';
import { presupport } from '@/kernel/pipeline/presupport';
import { isWatertight } from '@/kernel/mesh/validate';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { sampleHeight } from '@/kernel/terrain/heightfield';
import { minEdgeDistance } from '@/kernel/geom2d/polygon';
import { rectPolygon } from '@/kernel/geom2d/shapes';
import type { EdgeTreatment } from '@/kernel/types';

const PLATE = 2.984;

function deckDoc(): StudioDocument {
  const d = newStudioDocument('Deck test', { kind: 'rect', w: 125, d: 50 }, 'scifi-deck');
  d.id = 'st-test-deck';
  d.ground.seed = 5;
  d.scatterSeed = 9;
  d.rules.footZones = [{ x: -50, y: 0, r: 7 }, { x: 0, y: 0, r: 7 }, { x: 50, y: 0, r: 7 }];
  return d;
}

describe('Base Studio scenes', () => {
  it('scatters the same scene twice for a seed and keeps the rules', () => {
    const d = deckDoc();
    const a = scatterScene(d, NO_ASSETS);
    const b = scatterScene(d, NO_ASSETS);
    expect(a.length).toBeGreaterThan(5);
    expect(a).toEqual(b);
    const poly = rectPolygon(125, 50);
    for (const p of a) {
      expect(p.scattered).toBe(true);
      expect(p.assetId.startsWith('param:')).toBe(true); // no pack assets in this test
      expect(minEdgeDistance(poly, p.x, p.y)).toBeGreaterThanOrEqual(d.rules.rimInset - 1e-6);
      for (const z of d.rules.footZones) expect(Math.hypot(p.x - z.x, p.y - z.y)).toBeGreaterThanOrEqual(z.r - 1e-6);
    }
    const other = { ...d, scatterSeed: 10 };
    expect(scatterScene(other, NO_ASSETS)).not.toEqual(a);
    // hand-placed props survive a scatter and are kept clear of
    const withHand: StudioDocument = { ...d, props: [{ id: 'hand', assetId: a[0].assetId, x: 20, y: 5, rotDeg: 0, scale: 1, sink: 0, seed: 1, licence: 'cc0', scattered: false }] };
    const c = scatterScene(withHand, NO_ASSETS);
    expect(c.find((p) => p.id === 'hand')).toBeTruthy();
    expect(c.filter((p) => !p.scattered).length).toBe(1);
  });

  it('levels the ground in foot zones and caps prop heights by board size', () => {
    const d = deckDoc();
    const hf = buildGround(d);
    for (const z of d.rules.footZones) {
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 12; a++) for (let r = 0; r <= z.r - 0.5; r += 1.5) {
        const h = sampleHeight(hf, z.x + Math.cos(a) * r, z.y + Math.sin(a) * r);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      expect(hi - lo).toBeLessThan(0.31);
      expect(lo).toBeGreaterThanOrEqual(PLATE - 1e-6);
    }
    expect(effectiveHeightCap(d)).toBeGreaterThan(0);
    expect(effectiveHeightCap({ ...d, rules: { ...d.rules, heightCap: 4 } })).toBe(4);
    const small = newStudioDocument('small', { kind: 'ellipse', w: 25, d: 25 }, 'forest-floor');
    expect(effectiveHeightCap(small)).toBeLessThanOrEqual(6);
  });

  it('bakes a sci-fi deck into a two-shell source the cutter turns into a supported 25 mm base', () => {
    const d = deckDoc();
    d.props = scatterScene(d, NO_ASSETS);
    const res = bakeStudio(d, NO_ASSETS);
    expect(res.warnings).toEqual([]);
    expect(res.propCount).toBe(d.props.length);
    const src = res.prepared;
    expect(src.mode).toBe('twoShell');
    expect(src.nominal).toEqual({ kind: 'rect', w: 125, d: 50 });
    expect(src.outline.plateTop).toBeCloseTo(PLATE, 6);
    expect(src.sculpt.triCount).toBeGreaterThan(5000);
    expect(src.warnings).toEqual([]);

    const root = computePiece(sourceFrame(src), rootPieceParams(src), { source: src, skipSculpt: true, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(root.body)).toBe(true);
    const edges: EdgeTreatment[] = [{ kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];
    const slots = magnetSlotSpecs({ dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 24 }, [{ x: 0, y: 0 }]);
    const base = computePiece(root.frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [-50, 0], rotDeg: 0, edges, profile: { kind: 'inset', inset: 0, height: 3 } }, { source: src, magnetSlots: slots, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(base.body)).toBe(true);
    expect(base.underside?.depth).toBeCloseTo(2, 6);
    const sculpt = base.sculptMesh ? { positions: new Float32Array(0), triCount: 0 } : base.sculpt;
    expect(sculpt.triCount).toBeGreaterThan(100);
    const sb = boundsOfSoup(sculpt);
    expect(sb.min[0]).toBeGreaterThanOrEqual(-12.5 - 0.15);
    expect(sb.max[0]).toBeLessThanOrEqual(12.5 + 0.15);
    expect(sb.max[2]).toBeGreaterThan(PLATE + 0.3);
    const sup = presupport({ body: base.body, sculpt, bottom: base.outline.bottom, slots, underside: base.underside });
    expect(sup.warnings).toEqual([]);
    expect(isWatertight(sup.supports)).toBe(true);
  });

  it('bakes a round fantasy board clipped to its footprint', () => {
    const d = newStudioDocument('round', { kind: 'ellipse', w: 40, d: 40 }, 'forest-floor');
    d.id = 'st-test-round';
    d.ground.seed = 3;
    d.scatterSeed = 4;
    d.props = scatterScene(d, NO_ASSETS);
    const res = bakeStudio(d, NO_ASSETS);
    expect(res.warnings).toEqual([]);
    const v = res.prepared.sculpt.vertices;
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < res.prepared.sculpt.vertexCount * 3; i += 3) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], v[i + k]); b.max[k] = Math.max(b.max[k], v[i + k]); }
    expect(b.max[0]).toBeLessThanOrEqual(20 + 0.2);
    expect(b.min[1]).toBeGreaterThanOrEqual(-20 - 0.2);
    expect(b.min[2]).toBeGreaterThanOrEqual(PLATE - 0.1 - 1e-3);
    expect(b.max[2] - PLATE).toBeLessThanOrEqual(effectiveHeightCap(d) + 3);
    const src = res.prepared;
    const root = computePiece(sourceFrame(src), rootPieceParams(src), { source: src, skipSculpt: true, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(root.body)).toBe(true);
    const base = computePiece(root.frame, { shape: { kind: 'ellipse', w: 25, d: 25 }, xy: [0, 0], rotDeg: 0, edges: [{ kind: 'bevel' }], profile: { kind: 'inset', inset: 0, height: 3 } }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(base.body)).toBe(true);
    const sculpt = base.sculptMesh ? { positions: new Float32Array(0), triCount: 0 } : base.sculpt;
    expect(sculpt.triCount).toBeGreaterThan(100);
    const sb = boundsOfSoup(sculpt);
    expect(Math.max(sb.max[0], -sb.min[0], sb.max[1], -sb.min[1])).toBeLessThanOrEqual(12.5 + 0.15);
  });
});
