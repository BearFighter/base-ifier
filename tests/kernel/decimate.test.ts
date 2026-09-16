import { describe, it, expect } from 'vitest';
import { decimateSoup, decimateForDisplay } from '@/kernel/mesh/decimate';
import { boxSoup, loadOprSoup } from '../fixtures/synthetic';
import { boundsOfSoup } from '@/kernel/mesh/bbox';

describe('decimate', () => {
  it('keeps a coarse box intact and drops nothing', () => {
    const box = boxSoup(10, 10, 10);
    const r = decimateSoup(box, 0.5);
    expect(r.mesh.triCount).toBe(12);
    expect(r.mesh.vertexCount).toBe(8);
  });

  it('collapses triangles smaller than the cell', () => {
    // 100 tiny boxes of 0.1mm inside a 0.5mm cell collapse to nothing
    const positions: number[] = [];
    for (let i = 0; i < 100; i++) {
      const b = boxSoup(0.1, 0.1, 0.1, i * 0.001, 0, 0);
      positions.push(...b.positions);
    }
    const r = decimateSoup({ positions: new Float32Array(positions), triCount: 1200 }, 0.5);
    expect(r.mesh.triCount).toBe(0);
  });

  const real = loadOprSoup('S_Base_Square_100mm_50mm_1.stl');
  it.skipIf(!real)('simplifies a real sculpt to the target size and keeps its bounds', () => {
    const r = decimateForDisplay(real!, 100_000);
    expect(r.mesh.triCount).toBeLessThan(125_000);
    expect(r.mesh.triCount).toBeGreaterThan(20_000);
    const b0 = boundsOfSoup(real!);
    const v = r.mesh.vertices;
    let maxX = -Infinity;
    for (let i = 0; i < r.mesh.vertexCount; i++) maxX = Math.max(maxX, v[i * 3]);
    expect(maxX).toBeCloseTo(b0.max[0], 0);
  });
});
