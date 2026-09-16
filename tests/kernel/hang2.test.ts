import { describe, it, expect } from 'vitest';
import { prepareSource } from '@/kernel/source/prepareSource';
import { computePiece, sourceFrame } from '@/kernel/pipeline/computePiece';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { autoMagnetPositions } from '@/kernel/pipeline/autoMagnets';
import { loadOprSoup, syntheticTwoShellBase } from '../fixtures/synthetic';
import type { EdgeTreatment } from '@/kernel/types';

const bevel: EdgeTreatment[] = [{ kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];
const sizing = { dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 48 };

describe('oversized cutter with existing magnets', () => {
  const real = loadOprSoup('S_Base_Square_100mm_50mm_1.stl');
  const raw = real ?? syntheticTwoShellBase({ shape: 'rect', w: 50, d: 100 });
  const src = prepareSource(raw, 'S_Base_Square_100mm_50mm_1.stl');

  it('finishes when a child is widened to 9999 mm', () => {
    const frame = sourceFrame(src);
    const child = computePiece(frame, { shape: { kind: 'rect', w: 50, d: 25 }, xy: [-25, 0], rotDeg: 0, edges: bevel }, { source: src, skipSculpt: true });
    const pos = autoMagnetPositions(child.outline, { radius: 1.6, minWall: 1 });
    const slots = magnetSlotSpecs(sizing, pos.map(([x, y]) => ({ x, y })));
    const t0 = Date.now();
    const big = computePiece(frame, { shape: { kind: 'rect', w: 9999, d: 25 }, xy: [-25, 0], rotDeg: 0, edges: bevel }, { source: src, magnetSlots: slots, magnetCheck: { floorMin: 0.6, minWall: 1 } });
    const ms = Date.now() - t0;
    console.log('big piece', big.size, 'ms', ms, 'warnings', big.warnings.slice(0, 3), 'timings', big.timings);
    expect(ms).toBeLessThan(15_000);
    expect(big.sculpt.triCount).toBeGreaterThan(0);
  }, 30_000);
});
