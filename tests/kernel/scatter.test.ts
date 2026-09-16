/**
 * Even-spread tests for the Base Studio prop scatter. The visual bug these
 * guard against: props bunched into one corner/third of the board because the
 * Poisson growth was stopped by the point cap before it reached the far side.
 */
import { describe, it, expect } from 'vitest';
import { scatter, poissonInPolygon, DENSITY_PRESETS, areaDensityFactor } from '@/kernel/props/scatter';
import type { Placement, ScatterAsset, ScatterRules } from '@/kernel/props/scatter';
import { rectPolygon, ellipsePolygon } from '@/kernel/geom2d/shapes';
import { minEdgeDistance, pointInConvexPolygon, polygonArea } from '@/kernel/geom2d/polygon';

const ASSETS: ScatterAsset[] = [
  { id: 'rock-s', footprintRadius: 1.5, weight: 3, height: 2 },
  { id: 'rock-m', footprintRadius: 3, weight: 1, height: 5 },
];

const BASE_RULES: ScatterRules = {
  rimInset: 1.5,
  footZones: [],
  density: DENSITY_PRESETS.medium,
  heightCap: 12,
  sink: 0.5,
  heroMinSize: 40,
  seed: 11,
};

/** Counts per cell of a cols x rows grid over the w x d board centred on the origin. */
function cellCounts(placements: { x: number; y: number }[], w: number, d: number, cols: number, rows: number): number[] {
  const counts = new Array(cols * rows).fill(0);
  for (const p of placements) {
    const i = Math.min(cols - 1, Math.max(0, Math.floor(((p.x + w / 2) / w) * cols)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor(((p.y + d / 2) / d) * rows)));
    counts[j * cols + i]++;
  }
  return counts;
}

function report(name: string, counts: number[], cols: number, rows: number, total: number): string {
  const lines: string[] = [];
  for (let j = rows - 1; j >= 0; j--) lines.push(counts.slice(j * cols, j * cols + cols).join('\t'));
  return `${name}: total ${total}, cells (top row first)\n${lines.join('\n')}`;
}

describe('scatter spreads evenly', () => {
  it('fills every third of a 150 x 100 board at medium density', () => {
    const w = 150, d = 100;
    const poly = rectPolygon(w, d);
    const placed = scatter(poly, ASSETS, BASE_RULES);
    const cols = 3, rows = 2;
    const counts = cellCounts(placed, w, d, cols, rows);
    const mean = placed.length / (cols * rows);
    // eslint-disable-next-line no-console
    console.log(report('150x100 medium', counts, cols, rows, placed.length));

    // a sensible count for the preset: props/cm² x cm² x the area factor
    const target = (polygonArea(poly) / 100) * DENSITY_PRESETS.medium * areaDensityFactor(polygonArea(poly));
    expect(placed.length).toBeGreaterThanOrEqual(target * 0.75);
    expect(placed.length).toBeLessThanOrEqual(target * 1.15);

    for (let c = 0; c < counts.length; c++) {
      expect(counts[c], `cell ${c} of ${JSON.stringify(counts)}`).toBeGreaterThanOrEqual(mean * 0.6);
    }
  });

  it('fills every cell at every density preset and board size', () => {
    // one seed of 8 or 13 props says little about evenness, so the cell counts
    // are summed over 8 seeds: a systematic hole (the old bug) survives that,
    // small-count noise does not
    const SEEDS = 8;
    for (const [name, density] of Object.entries(DENSITY_PRESETS)) {
      for (const [w, d, cols, rows] of [[150, 100, 3, 2], [60, 60, 2, 2], [250, 150, 3, 3], [100, 50, 3, 2], [40, 25, 2, 1]] as const) {
        const poly = rectPolygon(w, d);
        const target = ((w * d) / 100) * density * areaDensityFactor(w * d);
        const totals = new Array(cols * rows).fill(0);
        let n = 0;
        for (let seed = 1; seed <= SEEDS; seed++) {
          const placed = scatter(poly, ASSETS, { ...BASE_RULES, density, seed });
          n += placed.length;
          const counts = cellCounts(placed, w, d, cols, rows);
          for (let c = 0; c < counts.length; c++) totals[c] += counts[c];
          expect(placed.length, `${name} ${w}x${d} seed ${seed}`).toBeGreaterThanOrEqual(Math.floor(target * 0.75));
          expect(placed.length, `${name} ${w}x${d} seed ${seed}`).toBeLessThanOrEqual(Math.ceil(target * 1.05) + 1);
        }
        const mean = n / (cols * rows);
        for (let c = 0; c < totals.length; c++) {
          expect(totals[c], `${name} ${w}x${d} cell ${c} of ${JSON.stringify(totals)}`).toBeGreaterThanOrEqual(mean * 0.6);
          expect(totals[c], `${name} ${w}x${d} cell ${c} of ${JSON.stringify(totals)}`).toBeLessThanOrEqual(mean * 1.6);
        }
      }
    }
  });

  it('fills a round board and one with foot zones and keep-outs', () => {
    const poly = ellipsePolygon(120, 120, 64);
    const placed = scatter(poly, ASSETS, {
      ...BASE_RULES,
      footZones: [{ x: -25, y: 0, r: 12 }, { x: 25, y: 10, r: 12 }],
      keepOut: [{ x: 0, y: -40, r: 8 }],
      seed: 5,
    });
    // count by quadrant; the foot zones remove roughly the same area from two of them
    const counts = cellCounts(placed, 120, 120, 2, 2);
    // eslint-disable-next-line no-console
    console.log(report('d120 round', counts, 2, 2, placed.length));
    const mean = placed.length / 4;
    for (let c = 0; c < counts.length; c++) {
      expect(counts[c], `cell ${c} of ${JSON.stringify(counts)}`).toBeGreaterThanOrEqual(mean * 0.55);
    }
    for (const p of placed) {
      expect(pointInConvexPolygon(poly, p.x, p.y)).toBe(true);
      expect(Math.hypot(p.x + 25, p.y)).toBeGreaterThan(12);
      expect(Math.hypot(p.x - 25, p.y - 10)).toBeGreaterThan(12);
      expect(Math.hypot(p.x, p.y + 40)).toBeGreaterThan(8);
    }
  });

  it('keeps determinism, the rim inset, spacing, the height cap and the hero prop', () => {
    const poly = rectPolygon(150, 100);
    const a = scatter(poly, ASSETS, BASE_RULES);
    const b = scatter(poly, ASSETS, BASE_RULES);
    expect(a).toEqual(b);
    expect(scatter(poly, ASSETS, { ...BASE_RULES, seed: 12 })).not.toEqual(a);

    const radiusOf = (p: Placement) => ASSETS.find((x) => x.id === p.assetId)!.footprintRadius * p.scale;
    for (const p of a) {
      expect(minEdgeDistance(poly, p.x, p.y)).toBeGreaterThanOrEqual(BASE_RULES.rimInset + radiusOf(p) - 1e-6);
      const asset = ASSETS.find((x) => x.id === p.assetId)!;
      expect(asset.height! * p.scale).toBeLessThanOrEqual(BASE_RULES.heightCap + 1e-6);
    }
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const dist = Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y);
        expect(dist).toBeGreaterThanOrEqual(radiusOf(a[i]) + radiusOf(a[j]) - 1e-6);
      }
    }
    expect(a.filter((p) => p.hero).length).toBe(1);
    expect(scatter(rectPolygon(30, 30), ASSETS, BASE_RULES).filter((p) => p.hero).length).toBe(0);
  });

  it('poissonInPolygon covers the whole polygon, not a blob around the first point', () => {
    const w = 150, d = 100;
    const pts = poissonInPolygon(rectPolygon(w, d), 5, () => ({ r: 2, tag: undefined }), 1.5, [], 4000, { minSpacing: 10 });
    const counts = cellCounts(pts.map((p) => ({ x: p.p[0], y: p.p[1] })), w, d, 3, 2);
    const mean = pts.length / 6;
    // eslint-disable-next-line no-console
    console.log(report('poisson minSpacing 10', counts, 3, 2, pts.length));
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(mean * 0.6);
    // 10 mm spacing over a 143 x 93 usable area: Bridson packs ~0.65 * A / d²
    expect(pts.length).toBeGreaterThan(70);
    expect(pts.length).toBeLessThan(110);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].p[0] - pts[j].p[0], pts[i].p[1] - pts[j].p[1])).toBeGreaterThanOrEqual(10 - 1e-6);
      }
    }
  });
});
