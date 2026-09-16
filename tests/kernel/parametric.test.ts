import { describe, it, expect } from 'vitest';
import { PARAMETRIC_CATALOG, buildParametric } from '@/kernel/props/parametric';
import { isWatertight } from '@/kernel/mesh/validate';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { signedVolume } from '@/kernel/mesh/volume';
import { weld } from '@/kernel/mesh/weld';
import { manifoldReport } from '@/kernel/mesh/validate';

describe('parametric props', () => {
  it('every kind builds closed, outward-facing shells that match their reported size', () => {
    for (const entry of PARAMETRIC_CATALOG) {
      for (const seed of [1, 77]) {
        const prop = buildParametric({ kind: entry.kind, params: {}, seed });
        expect(prop.soup.triCount, entry.kind).toBeGreaterThan(10);
        expect(isWatertight(prop.soup), `${entry.kind} watertight`).toBe(true);
        const rep = manifoldReport(weld(prop.soup));
        expect(rep.nonManifoldEdges, `${entry.kind} non-manifold`).toBe(0);
        expect(rep.boundaryEdges, `${entry.kind} boundary`).toBe(0);
        expect(signedVolume(prop.soup), `${entry.kind} volume`).toBeGreaterThan(0.05);
        const b = boundsOfSoup(prop.soup);
        expect(b.min[2]).toBeCloseTo(prop.underground, 5);
        expect(prop.underground).toBeLessThanOrEqual(0);
        expect(b.max[2]).toBeCloseTo(prop.height, 5);
        expect(prop.height).toBeGreaterThan(0.4);
        const rXY = Math.max(Math.hypot(b.min[0], b.min[1]), Math.hypot(b.max[0], b.max[1]), Math.hypot(b.min[0], b.max[1]), Math.hypot(b.max[0], b.min[1]));
        expect(prop.footprintRadius).toBeLessThanOrEqual(rXY + 1e-6);
        expect(prop.footprintRadius).toBeGreaterThan(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 - 1e-6);
      }
    }
  });

  it('is deterministic per seed and varies with it', () => {
    const a = buildParametric({ kind: 'boulder', params: { size: 5 }, seed: 3 });
    const b = buildParametric({ kind: 'boulder', params: { size: 5 }, seed: 3 });
    const c = buildParametric({ kind: 'boulder', params: { size: 5 }, seed: 4 });
    expect(Array.from(a.soup.positions)).toEqual(Array.from(b.soup.positions));
    expect(Array.from(a.soup.positions)).not.toEqual(Array.from(c.soup.positions));
    expect(a.height).toBeGreaterThan(1.5);
    expect(a.height).toBeLessThan(5);
  });

  it('keeps printability minimums: rebar lean, pipe diameter, grating holes', () => {
    const rebar = buildParametric({ kind: 'rebar', params: { length: 10, dia: 0.4, lean: 89 }, seed: 1 });
    // leaning at most 65° from upright: a 10 mm bar still rises at least 10·cos65° above the ground line minus the embed
    expect(rebar.height).toBeGreaterThan(10 * Math.cos((65 * Math.PI) / 180) - 1.6);
    const pipe = buildParametric({ kind: 'pipe', params: { dia: 0.5, length: 6, flanges: 0 }, seed: 1 });
    const pb = boundsOfSoup(pipe.soup);
    expect(pb.max[2] - pb.min[2]).toBeGreaterThanOrEqual(1.5 - 1e-6);
    const grate = buildParametric({ kind: 'grating', params: { size: 10, bar: 0.2, pitch: 0.8 }, seed: 1 });
    expect(isWatertight(grate.soup)).toBe(true);
    expect(grate.height).toBeCloseTo(0.65, 5);
    const g = buildParametric({ kind: 'grating', params: {}, seed: 2 });
    expect(g.soup.triCount).toBeGreaterThan(60);
  });
});
