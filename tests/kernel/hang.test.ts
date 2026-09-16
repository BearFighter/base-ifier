import { describe, it, expect } from 'vitest';
import { prepareSource } from '@/kernel/source/prepareSource';
import { computePiece, sourceFrame } from '@/kernel/pipeline/computePiece';
import { syntheticTwoShellBase, loadOprSoup } from '../fixtures/synthetic';
import type { EdgeTreatment } from '@/kernel/types';

const bevel: EdgeTreatment[] = [{ kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];
const frontStraight: EdgeTreatment[] = [{ kind: 'vertical' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];

describe('rotated / straight-edged pieces never hang', () => {
  const raw = syntheticTwoShellBase({ shape: 'rect', w: 100, d: 150 });
  const src = prepareSource(raw, 'S_Base_Square_150mm_100mm_1.stl');

  it('handles rotDeg 90 and a vertical front edge on nested pieces', () => {
    const frame = sourceFrame(src);
    const troop = computePiece(frame, { shape: { kind: 'rect', w: 50, d: 125 }, xy: [-25, 0], rotDeg: 0, edges: bevel }, { source: src });
    const t0 = Date.now();
    const cell = computePiece(troop.frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [-12.5, -50], rotDeg: 90, edges: frontStraight }, { source: src });
    expect(cell.size.w).toBeCloseTo(25, 6);
    const strip = computePiece(troop.frame, { shape: { kind: 'rect', w: 25, d: 125 }, xy: [12.5, 0], rotDeg: 90, edges: frontStraight }, { source: src });
    // rotated strip is 125 wide, clipped to the 50-wide parent
    expect(strip.size.w).toBeCloseTo(50, 6);
    expect(strip.size.d).toBeCloseTo(25, 6);
    for (const rot of [0, 90, 180, 270, 45]) {
      const p = computePiece(troop.frame, { shape: { kind: 'ellipse', w: 32, d: 32 }, xy: [0, 20], rotDeg: rot, edges: [{ kind: 'vertical' }] }, { source: src });
      expect(p.bodyVolume).toBeGreaterThan(0);
    }
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  const real = loadOprSoup('S_Base_Square_150mm_100mm_1.stl');
  it.skipIf(!real)('real 150x100: rotate + straight edge on children finishes', () => {
    const t0 = Date.now();
    const rsrc = prepareSource(real!, 'S_Base_Square_150mm_100mm_1.stl');
    const frame = sourceFrame(rsrc);
    const troop = computePiece(frame, { shape: { kind: 'rect', w: 50, d: 125 }, xy: [-25, 0], rotDeg: 0, edges: bevel }, { source: rsrc });
    const cell = computePiece(troop.frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [-12.5, -50], rotDeg: 90, edges: frontStraight }, { source: rsrc });
    expect(cell.sculpt.triCount).toBeGreaterThan(0);
    const strip = computePiece(troop.frame, { shape: { kind: 'rect', w: 25, d: 125 }, xy: [12.5, 0], rotDeg: 90, edges: frontStraight }, { source: rsrc });
    expect(strip.sculpt.triCount).toBeGreaterThan(0);
    const rest = computePiece(frame, { shape: { kind: 'rect', w: 50, d: 150 }, xy: [25, 0], rotDeg: 0, edges: bevel }, { source: rsrc });
    expect(rest.sculpt.triCount).toBeGreaterThan(0);
    console.log('real timings ms', Date.now() - t0, { troop: troop.timings, cell: cell.timings, strip: strip.timings, rest: rest.timings });
    expect(Date.now() - t0).toBeLessThan(60_000);
  }, 120_000);
});
