import { describe, it, expect } from 'vitest';
import { addNoise, applyStamp, brush, createHeightfield, flattenDisc, heightRange, rimTaper, sampleHeight, sampleNormal, settleFloor, rng } from '@/kernel/terrain/heightfield';
import { cobbles, plating, grating, cracks, craters, pebbles, proceduralStamp } from '@/kernel/terrain/stamps';
import { heightfieldToSlab, suggestedCell } from '@/kernel/terrain/mesh';
import { scatter, settle, poissonInPolygon, areaDensityFactor, defaultHeightCap, DENSITY_PRESETS } from '@/kernel/props/scatter';
import { buildPreparedSourceFromMesh } from '@/kernel/source/fromMesh';
import { computePiece, sourceFrame, rootPieceParams } from '@/kernel/pipeline/computePiece';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { DEFAULT_HOLLOW, addBox } from '@/kernel/body/hollow';
import { presupport } from '@/kernel/pipeline/presupport';
import { rectPolygon, ellipsePolygon } from '@/kernel/geom2d/shapes';
import { minEdgeDistance, pointInConvexPolygon } from '@/kernel/geom2d/polygon';
import { isWatertight } from '@/kernel/mesh/validate';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { signedVolume } from '@/kernel/mesh/volume';
import { SoupBuilder } from '@/kernel/types';
import type { EdgeTreatment, Soup } from '@/kernel/types';

const PLATE = 2.984;

describe('heightfield', () => {
  it('is deterministic for a seed and different for another', () => {
    const a = createHeightfield(50, 25, 0.5, PLATE);
    const b = createHeightfield(50, 25, 0.5, PLATE);
    const c = createHeightfield(50, 25, 0.5, PLATE);
    addNoise(a, { seed: 7, amplitude: 2, scale: 8 });
    addNoise(b, { seed: 7, amplitude: 2, scale: 8 });
    addNoise(c, { seed: 8, amplitude: 2, scale: 8 });
    expect(Array.from(a.z)).toEqual(Array.from(b.z));
    expect(Array.from(a.z)).not.toEqual(Array.from(c.z));
    const r = heightRange(a);
    expect(r.max - r.min).toBeGreaterThan(0.5);
    expect(r.max - r.min).toBeLessThanOrEqual(2.05);
  });

  it('samples bilinearly and gives unit normals', () => {
    const hf = createHeightfield(10, 10, 1, 0);
    // a plane z = x
    for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) hf.z[j * hf.nx + i] = -5 + i;
    expect(sampleHeight(hf, 0.25, 0)).toBeCloseTo(0.25, 6);
    expect(sampleHeight(hf, -5, 3)).toBeCloseTo(-5, 6);
    const n = sampleNormal(hf, 0, 0);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
    expect(n[0]).toBeLessThan(0); // slope rises with x, so the normal leans back
  });

  it('stamps, brushes, foot zones and rim taper behave', () => {
    const hf = createHeightfield(40, 40, 0.5, PLATE);
    const st = proceduralStamp('cobbles', 1);
    applyStamp(hf, st, { x: 0, y: 0, size: 30, strength: 1.2 });
    const r = heightRange(hf);
    expect(r.max).toBeGreaterThan(PLATE + 0.5);
    expect(r.max).toBeLessThanOrEqual(PLATE + 1.2 + 1e-6);
    brush(hf, { x: 10, y: 10, radius: 4, strength: 2, kind: 'raise' });
    expect(sampleHeight(hf, 10, 10)).toBeGreaterThan(PLATE + 1.5);
    flattenDisc(hf, -10, -10, 7, PLATE + 0.2);
    for (const [x, y] of [[-10, -10], [-13, -10], [-10, -6]]) expect(Math.abs(sampleHeight(hf, x, y) - (PLATE + 0.2))).toBeLessThan(0.02);
    rimTaper(hf, rectPolygon(40, 40), 1.5, PLATE);
    expect(sampleHeight(hf, 19.9, 0)).toBeLessThan(PLATE + 0.05);
    settleFloor(hf, PLATE);
    expect(heightRange(hf).min).toBeCloseTo(PLATE, 6);
  });

  it('procedural stamps are normalised and shaped as intended', () => {
    for (const st of [cobbles(), plating(), grating(), cracks(), craters(), pebbles()]) {
      let min = Infinity, max = -Infinity;
      for (let k = 0; k < st.h.length; k++) { min = Math.min(min, st.h[k]); max = Math.max(max, st.h[k]); }
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1 + 1e-6);
      expect(max).toBeGreaterThan(0.5);
    }
    // grating: bars 0.6 wide on a 2.2 pitch -> roughly half the cells are holes
    const g = grating(40, 1.6, 0.6, 0.1);
    let holes = 0;
    for (let k = 0; k < g.h.length; k++) if (g.h[k] === 0) holes++;
    const frac = holes / g.h.length;
    expect(frac).toBeGreaterThan(0.4);
    expect(frac).toBeLessThan(0.65);
  });
});

describe('slab', () => {
  it('is a closed shell standing on plateTop - 0.1 with the terrain on top', () => {
    const hf = createHeightfield(50, 25, 0.5, PLATE + 0.5);
    addNoise(hf, { seed: 3, amplitude: 3, scale: 10 });
    settleFloor(hf, PLATE + 0.2);
    const slab = heightfieldToSlab(hf, { zBase: PLATE - 0.1 });
    expect(isWatertight(slab)).toBe(true);
    const b = boundsOfSoup(slab);
    expect(b.min[2]).toBeCloseTo(PLATE - 0.1, 6);
    expect(b.max[2]).toBeGreaterThan(PLATE + 2);
    expect(b.min[0]).toBeCloseTo(-25, 6);
    expect(b.max[1]).toBeCloseTo(12.5, 6);
    expect(signedVolume(slab)).toBeGreaterThan(50 * 25 * 0.3);
  });

  it('clips to a round footprint through the cutter and stays closed', () => {
    const hf = createHeightfield(32, 32, 0.5, PLATE + 0.3);
    addNoise(hf, { seed: 4, amplitude: 2, scale: 6 });
    settleFloor(hf, PLATE + 0.1);
    const circle = ellipsePolygon(30, 30, 48);
    const slab = heightfieldToSlab(hf, { zBase: PLATE - 0.1, clipTo: circle });
    expect(isWatertight(slab)).toBe(true);
    const b = boundsOfSoup(slab);
    expect(b.max[0]).toBeLessThanOrEqual(15 + 1e-3);
    expect(b.min[1]).toBeGreaterThanOrEqual(-15 - 1e-3);
    expect(suggestedCell(25, 25)).toBe(0.2);
    expect(suggestedCell(600, 600)).toBe(0.5);
  });
});

describe('scatter', () => {
  const assets = [
    { id: 'rock-s', footprintRadius: 1.5, weight: 3, height: 2 },
    { id: 'rock-m', footprintRadius: 3, weight: 1, height: 5 },
  ];
  const rules = { rimInset: 1.5, footZones: [{ x: 0, y: 0, r: 7 }], density: DENSITY_PRESETS.medium, heightCap: 12, sink: 0.5, heroMinSize: 40, seed: 11 };

  it('keeps props off the rim, out of foot zones, apart from each other, and is reproducible', () => {
    const poly = rectPolygon(100, 50);
    const a = scatter(poly, assets, rules);
    const b = scatter(poly, assets, rules);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
    const radiusOf = (p: { assetId: string; scale: number }) => (assets.find((x) => x.id === p.assetId)!.footprintRadius) * p.scale;
    for (const p of a) {
      expect(pointInConvexPolygon(poly, p.x, p.y)).toBe(true);
      expect(minEdgeDistance(poly, p.x, p.y)).toBeGreaterThanOrEqual(rules.rimInset + radiusOf(p) - 1e-6);
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(7 + radiusOf(p) - 1e-6);
    }
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      const d = Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y);
      expect(d).toBeGreaterThanOrEqual(radiusOf(a[i]) + radiusOf(a[j]) - 1e-6);
    }
    // one hero on a 100 x 50, none on a 25 x 25
    expect(a.filter((p) => p.hero).length).toBe(1);
    const small = scatter(rectPolygon(25, 25), assets, { ...rules, footZones: [] });
    expect(small.filter((p) => p.hero).length).toBe(0);
    expect(small.length).toBeLessThan(a.length / 3);
    // a different seed moves things
    expect(scatter(poly, assets, { ...rules, seed: 12 })).not.toEqual(a);
  });

  it('scales density down with area and caps heights', () => {
    expect(areaDensityFactor(25 * 25)).toBeLessThan(0.45);
    expect(areaDensityFactor(150 * 100)).toBe(1);
    expect(defaultHeightCap(25)).toBe(6);
    expect(defaultHeightCap(50)).toBe(12);
    expect(defaultHeightCap(100)).toBe(25);
    const tall = scatter(rectPolygon(60, 60), [{ id: 't', footprintRadius: 2, height: 20 }], { ...rules, footZones: [], heightCap: 6, heroMinSize: 0 });
    for (const p of tall) expect(20 * p.scale).toBeLessThanOrEqual(6 + 1e-6);
    const pts = poissonInPolygon(rectPolygon(30, 30), 5, () => ({ r: 1, tag: undefined }), 1, [], 1000);
    expect(pts.length).toBeGreaterThan(80);
  });

  it('settles onto the terrain with the ground normal', () => {
    const hf = createHeightfield(60, 60, 0.5, PLATE);
    addNoise(hf, { seed: 9, amplitude: 4, scale: 12 });
    const placed = settle(hf, scatter(rectPolygon(60, 60), assets, { ...rules, footZones: [] }), 0.5);
    for (const p of placed) {
      expect(p.z).toBeCloseTo(sampleHeight(hf, p.x, p.y) - 0.5, 6);
      expect(Math.hypot(...p.normal)).toBeCloseTo(1, 6);
    }
  });
});

describe('studio scene → cutter', () => {
  function boxProp(x: number, y: number, z: number, s: number): Soup {
    const out = new SoupBuilder(12);
    addBox(out, x - s / 2, y - s / 2, Math.max(z, PLATE - 0.1), x + s / 2, y + s / 2, z + s);
    return out.buildCopy();
  }

  it('builds a two-shell source the pipeline cuts into a hollow, supported 25 mm base', () => {
    const w = 125, d = 50;
    const bottom = rectPolygon(w, d);
    const hf = createHeightfield(w, d, 0.5, PLATE + 0.3);
    addNoise(hf, { seed: 21, amplitude: 2.5, scale: 9 });
    settleFloor(hf, PLATE + 0.1);
    rimTaper(hf, bottom, 1.5, PLATE + 0.05);
    const slab = heightfieldToSlab(hf, { zBase: PLATE - 0.1 });
    const props = scatter(bottom, [{ id: 'box', footprintRadius: 2, height: 3 }], { rimInset: 1.5, footZones: [], density: 0.6, heightCap: 6, sink: 0.5, heroMinSize: 0, seed: 3 });
    const placed = settle(hf, props, 0.5);
    const shells = [slab, ...placed.map((p) => boxProp(p.x, p.y, p.z, 3 * p.scale))];
    const src = buildPreparedSourceFromMesh({ name: 'studio test', nominal: { kind: 'rect', w, d }, bottom, topScale: [0.9237, 0.9237], plateTop: PLATE, sculpt: shells });
    expect(src.mode).toBe('twoShell');
    expect(src.warnings).toEqual([]);
    expect(src.stats.components).toBe(shells.length);
    expect(src.sculpt.triCount).toBeGreaterThan(1000);

    const root = computePiece(sourceFrame(src), rootPieceParams(src), { source: src, skipSculpt: true, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(root.body)).toBe(true);
    const edges: EdgeTreatment[] = [{ kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];
    const slots = magnetSlotSpecs({ dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 24 }, [{ x: 0, y: 0 }]);
    const base = computePiece(root.frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [-50, 0], rotDeg: 0, edges, profile: { kind: 'inset', inset: 0, height: 3 } }, { source: src, magnetSlots: slots, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(base.body)).toBe(true);
    expect(base.underside?.depth).toBeCloseTo(2.1, 6); // deep enough for the 2 mm magnet + 0.1 mm tolerance
    const sculptSoup = base.sculptMesh ? { positions: new Float32Array(0), triCount: 0 } : base.sculpt;
    expect(sculptSoup.triCount).toBeGreaterThan(100);
    const sb = boundsOfSoup(sculptSoup);
    expect(sb.min[0]).toBeGreaterThanOrEqual(-12.5 - 0.15);
    expect(sb.max[0]).toBeLessThanOrEqual(12.5 + 0.15);
    expect(sb.max[2]).toBeGreaterThan(PLATE + 0.5);
    const sup = presupport({ body: base.body, sculpt: sculptSoup, bottom: base.outline.bottom, slots, underside: base.underside });
    expect(sup.warnings).toEqual([]);
    expect(isWatertight(sup.supports)).toBe(true);
    expect(sup.supportCount).toBeGreaterThan(15);
  });
});
