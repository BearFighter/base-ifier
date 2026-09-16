import { describe, expect, it } from 'vitest';
import { mmToPx, pxToMm, type ViewMapping } from '@/viewport/mapping';

function makeMapping(overrides: Partial<ViewMapping> = {}): ViewMapping {
  return {
    width: 800,
    height: 600,
    pxPerMm: 4,
    originPx: [400, 300],
    mirrored: false,
    valid: true,
    ...overrides,
  };
}

describe('mmToPx / pxToMm', () => {
  it('round-trips arbitrary points (top / unmirrored)', () => {
    const m = makeMapping();
    for (const [x, y] of [
      [0, 0],
      [10, -5],
      [-37.5, 22.25],
      [123.4, -98.7],
    ] as const) {
      const [px, py] = mmToPx(m, x, y);
      const [bx, by] = pxToMm(m, px, py);
      expect(bx).toBeCloseTo(x, 9);
      expect(by).toBeCloseTo(y, 9);
    }
  });

  it('maps the local origin to originPx', () => {
    const m = makeMapping({ originPx: [123, 456] });
    expect(mmToPx(m, 0, 0)).toEqual([123, 456]);
  });

  it('scales by pxPerMm, with screen y growing downward as world y grows upward', () => {
    const m = makeMapping({ pxPerMm: 2, originPx: [0, 0] });
    expect(mmToPx(m, 10, 0)).toEqual([20, 0]);
    expect(mmToPx(m, 0, 10)).toEqual([0, -20]);
  });

  it('mirrors x (only) when mirrored is true, matching the underside view', () => {
    const top = makeMapping({ mirrored: false, originPx: [0, 0], pxPerMm: 3 });
    const underside = makeMapping({ mirrored: true, originPx: [0, 0], pxPerMm: 3 });
    expect(mmToPx(top, 5, 7)).toEqual([15, -21]);
    expect(mmToPx(underside, 5, 7)).toEqual([-15, -21]);
  });

  it('round-trips through the mirrored (underside) case too', () => {
    const m = makeMapping({ mirrored: true, originPx: [200, 150], pxPerMm: 5.5 });
    for (const [x, y] of [
      [0, 0],
      [15, -10],
      [-40, 33.3],
    ] as const) {
      const [px, py] = mmToPx(m, x, y);
      const [bx, by] = pxToMm(m, px, py);
      expect(bx).toBeCloseTo(x, 9);
      expect(by).toBeCloseTo(y, 9);
    }
  });

  it('pxToMm is the exact algebraic inverse of mmToPx for random mappings', () => {
    let seed = 42;
    const rand = () => {
      // small deterministic PRNG so the test is reproducible
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 25; i++) {
      const m = makeMapping({
        pxPerMm: 0.5 + rand() * 10,
        originPx: [(rand() - 0.5) * 2000, (rand() - 0.5) * 2000],
        mirrored: rand() > 0.5,
      });
      const x = (rand() - 0.5) * 500;
      const y = (rand() - 0.5) * 500;
      const [px, py] = mmToPx(m, x, y);
      const [bx, by] = pxToMm(m, px, py);
      expect(bx).toBeCloseTo(x, 6);
      expect(by).toBeCloseTo(y, 6);
    }
  });
});
