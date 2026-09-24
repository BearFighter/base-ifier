import { describe, it, expect } from 'vitest';
import { buildBody } from '@/kernel/body/buildBody';
import { magnetSlotSpecs, checkMagnetSlots } from '@/kernel/body/magnetSlots';
import { rectPolygon, ellipsePolygon } from '@/kernel/geom2d/shapes';
import { polygonArea, scalePolygonAbout } from '@/kernel/geom2d/polygon';
import { isWatertight, manifoldReport } from '@/kernel/mesh/validate';
import { weld } from '@/kernel/mesh/weld';
import { signedVolume } from '@/kernel/mesh/volume';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { prepareSource } from '@/kernel/source/prepareSource';
import { nominalFromFilename } from '@/kernel/source/nominalFromFilename';
import { computePiece, sourceFrame, rootPieceParams, type ParentFrame } from '@/kernel/pipeline/computePiece';
import { autoMagnetPositions } from '@/kernel/pipeline/autoMagnets';
import { pieceToStl, packPlate } from '@/kernel/pipeline/exportPiece';
import { readStl } from '@/kernel/stl/read';
import { syntheticTwoShellBase, loadOprSoup } from '../fixtures/synthetic';
import type { EdgeTreatment } from '@/kernel/types';

const bevel: EdgeTreatment[] = [{ kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];

describe('buildBody', () => {
  it('builds a watertight frustum with the prismoid volume', () => {
    const bottom = rectPolygon(25, 25);
    const top = scalePolygonAbout(bottom, 0.9237, 0.9237, 0, 0);
    const { soup, warnings } = buildBody({ bottom, top, plateTop: 2.984 });
    expect(warnings).toEqual([]);
    expect(isWatertight(soup)).toBe(true);
    const A1 = polygonArea(bottom), A2 = polygonArea(top);
    const V = (2.984 / 3) * (A1 + A2 + Math.sqrt(A1 * A2));
    expect(signedVolume(soup)).toBeCloseTo(V, 3);
  });

  it('zips outlines with different vertex counts (ellipse bottom, clipped top)', () => {
    const bottom = ellipsePolygon(32, 32, 64);
    const top = scalePolygonAbout(ellipsePolygon(32, 32, 48), 0.92, 0.92, 0, 0);
    const { soup } = buildBody({ bottom, top, plateTop: 3 });
    expect(isWatertight(soup)).toBe(true);
    expect(signedVolume(soup)).toBeGreaterThan(0);
  });

  it('bores magnet slots and removes the right volume', () => {
    const bottom = rectPolygon(25, 25);
    const top = scalePolygonAbout(bottom, 0.9237, 0.9237, 0, 0);
    const plain = buildBody({ bottom, top, plateTop: 2.984 }).soup;
    const specs = magnetSlotSpecs({ dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 48 }, [{ x: 0, y: 0 }]);
    const slotted = buildBody({ bottom, top, plateTop: 2.984 }, specs).soup;
    expect(isWatertight(slotted)).toBe(true);
    const r = 1.6, n = 48;
    const holeVol = 0.5 * n * r * r * Math.sin((2 * Math.PI) / n) * 2.1;
    expect(signedVolume(plain) - signedVolume(slotted)).toBeCloseTo(holeVol, 5);
    expect(checkMagnetSlots({ bottom, top, plateTop: 2.984 }, specs, { floorMin: 0.6, minWall: 1 })).toEqual([]);
  });

  it('flags slots that break through or sit too close to the edge', () => {
    const bottom = rectPolygon(25, 25);
    const top = scalePolygonAbout(bottom, 0.9237, 0.9237, 0, 0);
    const deep = magnetSlotSpecs({ dia: 3, thick: 3, radialTol: 0.1, depthTol: 0.1, sides: 24 }, [{ x: 0, y: 0 }]);
    expect(checkMagnetSlots({ bottom, top, plateTop: 2.984 }, deep, { floorMin: 0.6, minWall: 1 }).length).toBe(1);
    const edge = magnetSlotSpecs({ dia: 3, thick: 1, radialTol: 0.1, depthTol: 0.1, sides: 24 }, [{ x: 11, y: 0 }]);
    expect(checkMagnetSlots({ bottom, top, plateTop: 2.984 }, edge, { floorMin: 0.6, minWall: 1 }).length).toBe(1);
  });
});

describe('nominalFromFilename', () => {
  it('parses OPR names', () => {
    expect(nominalFromFilename('S_Base_Square_150mm_100mm_1.stl')).toEqual({ shape: { kind: 'rect', w: 150, d: 100 }, matched: 'Square_150mm_100mm' });
    expect(nominalFromFilename('S_Base_Round_32mm_1.stl')?.shape).toEqual({ kind: 'ellipse', w: 32, d: 32 });
    expect(nominalFromFilename('S_Base_Round_60mm_35mm_1.stl')?.shape).toEqual({ kind: 'ellipse', w: 60, d: 35 });
    expect(nominalFromFilename('oval_105x70.stl')?.shape).toEqual({ kind: 'ellipse', w: 105, d: 70 });
    expect(nominalFromFilename('base 25x50.stl')?.shape).toEqual({ kind: 'rect', w: 50, d: 25 });
    // two sizes and no shape word: a rectangle of both sizes, not a round of the first one
    expect(nominalFromFilename('My_Scene_150mm_100mm.stl')?.shape).toEqual({ kind: 'rect', w: 150, d: 100 });
    expect(nominalFromFilename('crater_oval_90mm_52mm.stl')?.shape).toEqual({ kind: 'ellipse', w: 90, d: 52 });
    expect(nominalFromFilename('base_32mm.stl')?.shape).toEqual({ kind: 'ellipse', w: 32, d: 32 });
    expect(nominalFromFilename('whatever.stl')).toBeNull();
  });
});

describe('pipeline on a synthetic two-shell base', () => {
  const raw = syntheticTwoShellBase({ shape: 'rect', w: 100, d: 60 });
  const src = prepareSource(raw, 'S_Base_Square_100mm_60mm_1.stl');

  it('detects the two-shell structure and normalises', () => {
    expect(src.mode).toBe('twoShell');
    expect(src.nominal).toEqual({ kind: 'rect', w: 100, d: 60 });
    expect(src.measuredScale).toBeCloseTo(1, 6);
    expect(src.outline.plateTop).toBeCloseTo(2.984, 3);
    expect(src.outline.topScale[0]).toBeCloseTo(0.9237, 3);
    expect(src.outline.bottom.length).toBe(4);
  });

  it('cuts a 50x30 piece from the corner with matching bevel and a watertight body', () => {
    const frame = sourceFrame(src);
    const piece = computePiece(frame, { shape: { kind: 'rect', w: 50, d: 30 }, xy: [-25, -15], rotDeg: 0, edges: bevel }, { source: src });
    expect(piece.warnings.filter((w) => !w.startsWith('sculpt:'))).toEqual([]);
    expect(piece.size.w).toBeCloseTo(50, 6);
    expect(piece.size.d).toBeCloseTo(30, 6);
    expect(isWatertight(piece.body)).toBe(true);
    const b = boundsOfSoup(piece.body);
    expect(b.max[0] - b.min[0]).toBeCloseTo(50, 6);
    expect(b.max[1] - b.min[1]).toBeCloseTo(30, 6);
    expect(b.max[2]).toBeCloseTo(2.984, 6);
    // top outline: inherited edges keep the source inset (0.0763*30=2.29 on x, 0.0763*50... per axis)
    // new edges get the inset an original 50x30 would have: (1-0.9237)*25 = 1.9075 (x), (1-0.9237)*15 = 1.1445 (y)
    const top = piece.outline.top;
    const xs = top.map((p) => p[0]), ys = top.map((p) => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(25 - 1.9075, 3);
    expect(Math.min(...xs)).toBeCloseTo(-25 + (1 - 0.9237) * 50, 3);
    expect(Math.max(...ys)).toBeCloseTo(15 - 1.1445, 3);
    expect(Math.min(...ys)).toBeCloseTo(-15 + (1 - 0.9237) * 30, 3);
    expect(piece.sculpt.triCount).toBeGreaterThan(0);
  });

  it('root piece reproduces the source outline and full sculpt', () => {
    const frame = sourceFrame(src);
    const root = computePiece(frame, rootPieceParams(src), { source: src });
    expect(isWatertight(root.body)).toBe(true);
    expect(root.size.w).toBeCloseTo(100, 6);
    expect(root.sculptMesh?.triCount).toBe(src.sculpt.triCount);
    expect(root.sculpt.triCount).toBe(0);
  });

  it('splits a child into grandchildren whose footprints tile it', () => {
    const frame = sourceFrame(src);
    const child = computePiece(frame, { shape: { kind: 'rect', w: 50, d: 30 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src });
    const kids: number[] = [];
    let totalArea = 0;
    for (let i = 0; i < 5; i++) {
      const k = computePiece(child.frame, { shape: { kind: 'rect', w: 10, d: 10 }, xy: [-20 + i * 10, -10], rotDeg: 0, edges: bevel }, { source: src });
      expect(isWatertight(k.body)).toBe(true);
      kids.push(k.bodyVolume);
      totalArea += polygonArea(k.outline.bottom);
    }
    const strip = computePiece(child.frame, { shape: { kind: 'rect', w: 50, d: 20 }, xy: [0, 5], rotDeg: 0, edges: bevel }, { source: src });
    totalArea += polygonArea(strip.outline.bottom);
    expect(totalArea).toBeCloseTo(50 * 30, 6);
    expect(strip.size).toEqual({ w: 50, d: 20 });
  });

  it('applies output scale and clearance without touching magnet size', () => {
    const frame = sourceFrame(src);
    const specs = magnetSlotSpecs({ dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 32 }, [{ x: 0, y: 0 }]);
    const p = computePiece(frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src, scale: 0.9947, magnetSlots: specs, magnetCheck: { floorMin: 0.6, minWall: 1 } });
    const b = boundsOfSoup(p.body);
    expect(b.max[0] - b.min[0]).toBeCloseTo(25 * 0.9947, 6);
    expect(b.max[2]).toBeCloseTo(2.984 * 0.9947, 6);
    expect(isWatertight(p.body)).toBe(true);
    const plain = computePiece(frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src, scale: 0.9947 });
    const holeVol = 0.5 * 32 * 1.6 * 1.6 * Math.sin((2 * Math.PI) / 32) * 2.1;
    expect(plain.bodyVolume - p.bodyVolume).toBeCloseTo(holeVol, 4);
    const c = computePiece(frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src, clearance: 0.25 });
    const cb = boundsOfSoup(c.body);
    expect(cb.max[0] - cb.min[0]).toBeCloseTo(24.5, 6);
  });

  it('auto-places magnets sensibly', () => {
    const frame = sourceFrame(src);
    const small = computePiece(frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src, skipSculpt: true });
    expect(autoMagnetPositions(small.outline, { radius: 1.6, minWall: 1 })).toEqual([[0, 0]]);
    const strip = computePiece(frame, { shape: { kind: 'rect', w: 100, d: 25 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src, skipSculpt: true });
    expect(autoMagnetPositions(strip.outline, { radius: 1.6, minWall: 1 }).length).toBe(3);
    const plate = computePiece(frame, { shape: { kind: 'rect', w: 100, d: 60 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src, skipSculpt: true });
    expect(autoMagnetPositions(plate.outline, { radius: 1.6, minWall: 1 }).length).toBe(4);
  });

  it('exports STL and packs a plate', () => {
    const frame = sourceFrame(src);
    const p = computePiece(frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src });
    const buf = pieceToStl({ name: 'test', body: p.body, sculpt: p.sculpt });
    const back = readStl(buf);
    expect(back.triCount).toBe(p.body.triCount + p.sculpt.triCount);
    const plate = packPlate([{ name: 'a', body: p.body, sculpt: p.sculpt }, { name: 'b', body: p.body, sculpt: p.sculpt }], { gap: 3 });
    expect(plate.placements[1].x).toBeCloseTo(25 + 3, 6);
  });
});

describe('pipeline on real OPR files', () => {
  const files = ['S_Base_Square_25mm_1.stl', 'S_Base_Square_50mm_25mm_1.stl', 'S_Base_Round_32mm_1.stl', 'S_Base_Round_60mm_35mm_1.stl'];
  for (const f of files) {
    const raw = loadOprSoup(f);
    it.skipIf(!raw)(`prepares and cuts ${f}`, () => {
      const src = prepareSource(raw!, f);
      expect(src.mode).toBe('twoShell');
      expect(src.measuredScale).toBeCloseTo(0.9947, 3);
      expect(src.outline.plateTop).toBeCloseTo(2.984 / 0.9947, 2);
      expect(src.warnings.filter((w) => w.includes('force-closed'))).toEqual([]);
      const frame = sourceFrame(src);
      const { w, d } = src.nominal;
      // cut the left half with vertical planes only on the new edge
      const half = computePiece(frame, { shape: { kind: 'rect', w: w / 2, d }, xy: [-w / 4, 0], rotDeg: 0, edges: bevel }, { source: src });
      expect(isWatertight(half.body)).toBe(true);
      expect(half.warnings.filter((x) => x.includes('force-closed'))).toEqual([]);
      const rep = manifoldReport(weld(half.sculpt));
      // the sculpt may keep the source's defects but must not gain open boundaries from the cut
      expect(rep.boundaryEdges).toBeLessThanOrEqual(src.stats.boundaryEdges);
      // a small square in the middle
      const sq = computePiece(frame, { shape: { kind: 'rect', w: 10, d: 10 }, xy: [0, 0], rotDeg: 0, edges: bevel }, { source: src });
      expect(isWatertight(sq.body)).toBe(true);
      expect(sq.sculpt.triCount).toBeGreaterThan(0);
      expect(sq.warnings.filter((x) => x.includes('force-closed'))).toEqual([]);
    });
  }
});
