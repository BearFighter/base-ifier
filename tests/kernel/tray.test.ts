import { describe, it, expect } from 'vitest';
import { prepareSource } from '@/kernel/source/prepareSource';
import { computePiece, sourceFrame } from '@/kernel/pipeline/computePiece';
import type { TrayParams } from '@/kernel/pipeline/computePiece';
import { DEFAULT_HOLLOW } from '@/kernel/body/hollow';
import { densitySpacing, presupport, DEFAULT_PRESUPPORT } from '@/kernel/pipeline/presupport';
import { PROFILE_FLAT } from '@/kernel/types';
import { syntheticTwoShellBase, boxSoup } from '../fixtures/synthetic';
import type { EdgeTreatment } from '@/kernel/types';
import { largestBareFloor, minWidth, rectPoly, slotWallWarnings, traySurroundCells, trayPocket, TRAY_SEAM_EPS } from '@/kernel/tray/cells';
import { buildTray, TRAY_EMBED, TRAY_MARK_PROUD } from '@/kernel/tray/buildTray';
import { rectPolygon, ellipsePolygon } from '@/kernel/geom2d/shapes';
import { polygonArea, pointInConvexPolygon } from '@/kernel/geom2d/polygon';
import { outsetConvex } from '@/kernel/pipeline/plug';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { isWatertight } from '@/kernel/mesh/validate';
import { signedVolume } from '@/kernel/mesh/volume';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import type { Polygon2, Soup } from '@/kernel/types';

const sizing = { dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 24 };
const UNDERSIDE = { depth: 2, rim: 2, ringWidth: 0.4 };

/** The tray of a 2 x 1 block of 25 mm bases: 56 x 31 outline, two pockets, ready-made cells. */
function twoSlotTray(floor: number, opts: { magnets?: boolean; gap?: number } = {}) {
  const gap = opts.gap ?? 0.2;
  const tray = rectPolygon(56, 31);
  const pockets = [outsetConvex(rectPolygon(25, 25, -12.5, 0), gap), outsetConvex(rectPolygon(25, 25, 12.5, 0), gap)];
  const { cells } = traySurroundCells(tray, pockets);
  const magnets = opts.magnets ? { slots: magnetSlotSpecs(sizing, [{ x: -12.5, y: 0 }, { x: 12.5, y: 0 }]), floorMin: 0.6 } : undefined;
  const res = buildTray(tray, cells, { floor, plateHeight: 3, magnets, pockets, gap, underside: UNDERSIDE, watermark: 'BITDEATHLABS', watermarkHeight: 0.3 });
  return { tray, pockets, cells, res };
}

/**
 * Height range of the triangles that sit over `poly`. Uses centroids, because a
 * cap triangulated over the tray outline has no vertex inside an opening at all.
 */
function zRangeOver(soup: Soup, poly: Polygon2): { min: number; max: number } {
  const P = soup.positions;
  let min = Infinity, max = -Infinity;
  for (let t = 0; t < soup.triCount; t++) {
    const i = t * 9;
    const cx = (P[i] + P[i + 3] + P[i + 6]) / 3, cy = (P[i + 1] + P[i + 4] + P[i + 7]) / 3;
    if (!pointInConvexPolygon(poly, cx, cy, -0.05)) continue;
    for (let v = 0; v < 3; v++) {
      const z = P[i + v * 3 + 2];
      if (z < min) min = z;
      if (z > max) max = z;
    }
  }
  return { min, max };
}

const exact = { seamEps: 0, minRib: 0 };

/** A convex polygon pulled in by `d` (for measuring inside a slot, clear of its walls). */
function insetConvexPoly(p: Polygon2, d: number): Polygon2 {
  let cx = 0, cy = 0;
  for (const [x, y] of p) { cx += x; cy += y; }
  cx /= p.length; cy /= p.length;
  return p.map(([x, y]) => {
    const r = Math.hypot(x - cx, y - cy) || 1;
    return [x - ((x - cx) / r) * d, y - ((y - cy) / r) * d] as [number, number];
  });
}

function totalArea(cells: { poly: Polygon2 }[]): number {
  return cells.reduce((a, c) => a + polygonArea(c.poly), 0);
}

/**
 * Samples `n` x `n` points over the tray and reports how they land. Points within
 * `tol` of any cell edge are ignored for the overlap and gap counts, so exactly
 * abutting cells (seamEps 0) are not reported as both double-covered and bare.
 */
function sample(tray: Polygon2, pockets: Polygon2[], cells: { poly: Polygon2 }[], n = 90, tol = 0.02) {
  let inPocketAndCell = 0, coveredTwice = 0, uncovered = 0, checked = 0;
  const bx = tray.reduce((a, p) => [Math.min(a[0], p[0]), Math.max(a[1], p[0])] as [number, number], [Infinity, -Infinity]);
  const by = tray.reduce((a, p) => [Math.min(a[0], p[1]), Math.max(a[1], p[1])] as [number, number], [Infinity, -Infinity]);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = bx[0] + ((i + 0.5) / n) * (bx[1] - bx[0]);
      const y = by[0] + ((j + 0.5) / n) * (by[1] - by[0]);
      if (!pointInConvexPolygon(tray, x, y, -tol)) continue;
      checked++;
      const strict = cells.filter((c) => pointInConvexPolygon(c.poly, x, y, -tol)).length;
      const loose = cells.filter((c) => pointInConvexPolygon(c.poly, x, y, tol)).length;
      const inPocket = pockets.some((p) => pointInConvexPolygon(p, x, y, -tol));
      const nearPocket = pockets.some((p) => pointInConvexPolygon(p, x, y, tol));
      if (inPocket && strict > 0) inPocketAndCell++;
      if (strict > 1) coveredTwice++;
      if (!nearPocket && loose === 0) uncovered++;
    }
  }
  return { inPocketAndCell, coveredTwice, uncovered, checked };
}

describe('tray cells', () => {
  it('covers the surround of a 2 x 2 block of slots and nothing else', () => {
    const tray = rectPolygon(62, 62);
    const pockets = [
      outsetConvex(rectPolygon(25, 25, -13, -13), 0.2),
      outsetConvex(rectPolygon(25, 25, 13, -13), 0.2),
      outsetConvex(rectPolygon(25, 25, -13, 13), 0.2),
      outsetConvex(rectPolygon(25, 25, 13, 13), 0.2),
    ];
    const r = traySurroundCells(tray, pockets, exact);
    expect(r.warnings).toEqual([]);
    const pocketArea = pockets.reduce((a, p) => a + polygonArea(p), 0);
    expect(totalArea(r.cells)).toBeCloseTo(62 * 62 - pocketArea, 6);
    const s = sample(tray, pockets, r.cells);
    expect(s.checked).toBeGreaterThan(5000);
    expect(s.inPocketAndCell).toBe(0);
    expect(s.coveredTwice).toBe(0);
    expect(s.uncovered).toBe(0);
  });

  it('merges slots that touch into one opening with no wall between them', () => {
    // two 25 mm bases side by side at a 25 mm pitch: with 0.2 mm per side the pockets overlap
    const tray = rectPolygon(56, 31);
    const pockets = [outsetConvex(rectPolygon(25, 25, -12.5, 0), 0.2), outsetConvex(rectPolygon(25, 25, 12.5, 0), 0.2)];
    const r = traySurroundCells(tray, pockets, exact);
    expect(r.cells.length).toBe(4);
    // nothing lives in the 0.4 mm band where the two pockets overlap
    for (const c of r.cells) {
      for (const [x, y] of c.poly) expect(Math.abs(x) > 0.2 - 1e-9 || Math.abs(y) > 12.7 - 1e-9).toBe(true);
    }
    // the merged opening is one 50.4 x 25.4 rectangle
    const opening = r.cells.filter((c) => c.onPocket.some(Boolean));
    expect(opening.length).toBe(4);
    const xs = r.cells.flatMap((c) => c.poly.map((p) => p[0]));
    expect(Math.min(...xs)).toBeCloseTo(-28, 6);
    const inner = r.cells.flatMap((c, i) => c.poly.filter((_, k) => c.onPocket[k]).map(() => i));
    expect(inner.length).toBeGreaterThan(0);
    const s = sample(tray, pockets, r.cells);
    expect(s.inPocketAndCell).toBe(0);
    expect(s.uncovered).toBe(0);
  });

  it('drops a wall thinner than the minimum rib and says so', () => {
    // bases 0.7 mm apart: after 0.2 mm per side the pockets leave a 0.3 mm rib
    const tray = rectPolygon(56.7, 31);
    const pockets = [outsetConvex(rectPolygon(25, 25, -12.85, 0), 0.2), outsetConvex(rectPolygon(25, 25, 12.85, 0), 0.2)];
    const r = traySurroundCells(tray, pockets, { seamEps: 0 });
    expect(r.slivers).toBe(1);
    expect(r.warnings.some((w) => /almost touching/.test(w))).toBe(true);
    for (const c of r.cells) {
      for (const [x, y] of c.poly) expect(Math.abs(x) > 0.15 - 1e-9 || Math.abs(y) > 12.7 - 1e-9).toBe(true);
    }
    // with the rule off, the 0.3 mm rib survives
    const keep = traySurroundCells(tray, pockets, exact);
    expect(keep.slivers).toBe(0);
    expect(keep.cells.length).toBe(keep.cells.length);
    expect(keep.cells.some((c) => minWidth(c.poly) < 0.35)).toBe(true);
  });

  it('works for round slots, including two that overlap', () => {
    const tray = rectPolygon(80, 44);
    const a = trayPocket({ kind: 'ellipse', w: 32, d: 32 }, -17, 0, 0, 0.2);
    const b = trayPocket({ kind: 'ellipse', w: 32, d: 32 }, 17, 0, 0, 0.2);
    const r = traySurroundCells(tray, [a, b], exact);
    expect(totalArea(r.cells)).toBeCloseTo(80 * 44 - polygonArea(a) - polygonArea(b), 4);
    const s = sample(tray, [a, b], r.cells);
    expect(s.inPocketAndCell).toBe(0);
    expect(s.coveredTwice).toBe(0);
    expect(s.uncovered).toBe(0);

    // tangent circles, grown by the gap, overlap: the double wedge pass still gives a disjoint cover
    const c = trayPocket({ kind: 'ellipse', w: 32, d: 32 }, -16, 0, 0, 0.2);
    const d = trayPocket({ kind: 'ellipse', w: 32, d: 32 }, 16, 0, 0, 0.2);
    const r2 = traySurroundCells(rectPolygon(76, 44), [c, d], exact);
    const s2 = sample(rectPolygon(76, 44), [c, d], r2.cells);
    expect(s2.inPocketAndCell).toBe(0);
    expect(s2.coveredTwice).toBe(0);
    expect(s2.uncovered).toBe(0);
  });

  it('clips the cells to a round tray outline', () => {
    const tray = ellipsePolygon(70, 50, 64);
    const pockets = [trayPocket({ kind: 'ellipse', w: 32, d: 32 }, 0, 0, 0, 0.2)];
    const r = traySurroundCells(tray, pockets, exact);
    expect(totalArea(r.cells)).toBeCloseTo(polygonArea(tray) - polygonArea(pockets[0]), 3);
    for (const c of r.cells) for (const [x, y] of c.poly) expect(pointInConvexPolygon(tray, x, y, 1e-6)).toBe(true);
  });

  it('pushes seams outward but keeps the tray outline and the slot walls exact', () => {
    const tray = rectPolygon(40, 40);
    const pockets = [outsetConvex(rectPolygon(20, 20), 0.2)];
    const r = traySurroundCells(tray, pockets, {});
    // the tray's own corners are untouched
    const xs = r.cells.flatMap((c) => c.poly.map((p) => p[0]));
    expect(Math.max(...xs)).toBeCloseTo(20, 9);
    // the pocket walls are exactly at 10.2
    const walls = r.cells.flatMap((c) => c.poly.filter((_, i) => c.onPocket[i] || c.onPocket[(i + c.poly.length - 1) % c.poly.length]));
    expect(walls.some((p) => Math.abs(Math.abs(p[0]) - 10.2) < 1e-9 || Math.abs(Math.abs(p[1]) - 10.2) < 1e-9)).toBe(true);
    // and the seams overlap by the whisker, so the cover is slightly more than exact
    const over = totalArea(r.cells) - (40 * 40 - polygonArea(pockets[0]));
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(TRAY_SEAM_EPS * 200);
  });

  it('measures the largest unbroken span of bare floor', () => {
    const tray = rectPolygon(60, 40);
    const wide = traySurroundCells(tray, [outsetConvex(rectPolygon(50, 30), 0.2)], exact);
    expect(Math.max(wide.thinSpan.w, wide.thinSpan.d)).toBeGreaterThan(48);
    // a rib between two slots breaks the span in half
    const ribbed = traySurroundCells(tray, [outsetConvex(rectPolygon(24, 30, -13, 0), 0.2), outsetConvex(rectPolygon(24, 30, 13, 0), 0.2)], exact);
    expect(Math.max(ribbed.thinSpan.w, ribbed.thinSpan.d)).toBeLessThan(31);
    expect(largestBareFloor(tray, [{ poly: rectPoly(-30, -20, 30, 20) }]).w).toBe(0);
  });

  it('warns when a slot reaches the edge of the tray', () => {
    const tray = rectPolygon(30, 30);
    expect(slotWallWarnings(tray, [rectPolygon(25, 25)])).toEqual([]);
    expect(slotWallWarnings(tray, [rectPolygon(29, 25)]).some((w) => /less than 1 mm/.test(w))).toBe(true);
    expect(slotWallWarnings(tray, [rectPolygon(32, 25)]).some((w) => /past the edge/.test(w))).toBe(true);
  });

  it('keeps the asked gap around a round slot even with a coarse pocket', () => {
    const p = trayPocket({ kind: 'ellipse', w: 32, d: 32 }, 0, 0, 0, 0.2);
    expect(p.length).toBeLessThanOrEqual(32);
    // every point of the base's own 100-sided outline is at least the gap inside the pocket
    const base = ellipsePolygon(32, 32, 100);
    for (const [x, y] of base) {
      let worst = Infinity;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const ex = b[0] - a[0], ey = b[1] - a[1];
        const len = Math.hypot(ex, ey);
        worst = Math.min(worst, (ex * (y - a[1]) - ey * (x - a[0])) / len);
      }
      expect(worst).toBeGreaterThan(0.19);
    }
  });
});

describe('tray body', () => {
  it('is watertight with square slots, round slots and merged slots', () => {
    expect(isWatertight(twoSlotTray(1).res.soup)).toBe(true);

    const round = rectPolygon(80, 44);
    const rp = [trayPocket({ kind: 'ellipse', w: 32, d: 32 }, -17, 0, 0, 0.2), trayPocket({ kind: 'ellipse', w: 32, d: 32 }, 17, 0, 0, 0.2)];
    const rc = traySurroundCells(round, rp).cells;
    expect(isWatertight(buildTray(round, rc, { floor: 1, plateHeight: 3 }).soup)).toBe(true);

    // slots at a 25 mm pitch: their pockets overlap into one opening
    const merged = rectPolygon(56, 31);
    const mp = [outsetConvex(rectPolygon(25, 25, -12.5, 0), 0.2), outsetConvex(rectPolygon(25, 25, 12.5, 0), 0.2)];
    const mc = traySurroundCells(merged, mp).cells;
    expect(isWatertight(buildTray(merged, mc, { floor: 1, plateHeight: 3 }).soup)).toBe(true);

    // the whisker is what keeps it watertight: with the seams butting together it must go non-manifold
    const butted = traySurroundCells(merged, mp, { seamEps: 0 }).cells;
    expect(isWatertight(buildTray(merged, butted, { floor: 1, plateHeight: 3, seamEps: 0 }).soup)).toBe(false);
  });

  it('has the volume of the floor plus the surround, and stands from 0 to floor + plate', () => {
    const { res, pockets } = twoSlotTray(1);
    const A = 56 * 31;
    const pocketArea = 50.4 * 25.4; // the two pockets merged into one opening
    void pockets;
    const expected = A * 1 + (A - pocketArea) * 3;
    // the shells overlap by the whisker and the surround is sunk 0.1 mm into the floor, so a little more
    expect(signedVolume(res.soup)).toBeGreaterThan(expected);
    expect(signedVolume(res.soup)).toBeLessThan(expected * 1.03);
    const b = boundsOfSoup(res.soup);
    expect(b.min[2]).toBeCloseTo(0, 9);
    expect(b.max[2]).toBeCloseTo(4, 9);
    expect(b.max[0]).toBeCloseTo(28, 9);
  });

  it('recesses the magnets when the floor is thick enough and drills through when it is not', () => {
    const thin = twoSlotTray(1, { magnets: true });
    expect(thin.res.magnets).toBe('through');
    expect(thin.res.magnetFloorWanted).toBeCloseTo(2.7, 6);
    expect(thin.res.warnings.some((w) => /right through/.test(w))).toBe(true);
    expect(isWatertight(thin.res.soup)).toBe(true);

    const thick = twoSlotTray(2.8, { magnets: true });
    expect(thick.res.magnets).toBe('recess');
    expect(thick.res.magnetDepth).toBeCloseTo(2.1, 6);
    expect(thick.res.warnings.filter((w) => /magnet/i.test(w))).toEqual([]);
    expect(isWatertight(thick.res.soup)).toBe(true);

    // the holes remove the right volume (compared with the same tray without magnets)
    const r = 1.6, n = 24;
    const discArea = 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);
    expect(signedVolume(twoSlotTray(1).res.soup) - signedVolume(thin.res.soup)).toBeCloseTo(2 * discArea * 1, 3);
    expect(signedVolume(twoSlotTray(2.8).res.soup) - signedVolume(thick.res.soup)).toBeCloseTo(2 * discArea * 2.1, 3);

    // a hole through reaches the underside; a recess leaves the bottom face untouched
    const reachesBottom = (s: Soup, cx: number) => {
      const P = s.positions;
      for (let i = 0; i < s.triCount * 9; i += 3) {
        if (Math.abs(P[i + 2]) < 1e-9 && Math.hypot(P[i] - cx, P[i + 1]) <= r + 1e-6) return true;
      }
      return false;
    };
    expect(reachesBottom(thin.res.soup, -12.5)).toBe(true);
    expect(reachesBottom(thick.res.soup, -12.5)).toBe(false);
  });

  it('puts the opening floor exactly at the floor thickness, whatever that is', () => {
    for (const t of [0.6, 1.0, 4.0]) {
      const { res } = twoSlotTray(t);
      // the opening: nothing but the floor stands over the merged 50.4 x 25.4 hole
      const over = zRangeOver(res.soup, rectPolygon(44, 20));
      expect(over.min).toBeCloseTo(0, 6);
      expect(over.max).toBeCloseTo(t, 6);
      const b = boundsOfSoup(res.soup);
      expect(b.max[2]).toBeCloseTo(t + 3, 6);
      expect(isWatertight(res.soup)).toBe(true);
    }
  });

  it('embosses the maker mark on the outer wall, standing proud of it, and never inside a slot', () => {
    const { res } = twoSlotTray(1);
    expect(res.watermark).toBe(true);
    // the mark lives on the front wall (y = -15.5) and stands TRAY_MARK_PROUD out of it
    const P = res.soup.positions;
    let outside = 0, minY = Infinity, maxZ = 0;
    for (let i = 0; i < res.soup.triCount * 9; i += 3) {
      minY = Math.min(minY, P[i + 1]);
      if (P[i + 1] < -15.5 - 1e-6) { outside++; maxZ = Math.max(maxZ, P[i + 2]); }
    }
    expect(outside).toBeGreaterThan(50);
    expect(minY).toBeCloseTo(-15.5 - TRAY_MARK_PROUD, 6);
    expect(maxZ).toBeLessThanOrEqual(4);
    expect(isWatertight(res.soup)).toBe(true);
    // nothing of it is inside a slot
    for (const x of [-12.5, 12.5]) expect(zRangeOver(res.soup, rectPolygon(24, 24, x, 0)).max).toBeLessThanOrEqual(1 + 1e-6);

    // a slot that opens at the front edge leaves no wall there: the mark moves to a wall that exists
    const openTray = rectPolygon(56, 31);
    const openPockets = [outsetConvex(rectPolygon(25, 25, -12.5, -6), 0.2), outsetConvex(rectPolygon(25, 25, 12.5, 0), 0.2)];
    const open = buildTray(openTray, traySurroundCells(openTray, openPockets).cells, { floor: 1, plateHeight: 3, pockets: openPockets, gap: 0.2, watermark: 'BITDEATHLABS', watermarkHeight: 0.3 });
    expect(open.watermark).toBe(true);
    let frontMark = 0, backMark = 0;
    for (let i = 0; i < open.soup.triCount * 9; i += 3) {
      const y = open.soup.positions[i + 1];
      if (y < -15.5 - 1e-6) frontMark++;
      if (y > 15.5 + 1e-6) backMark++;
    }
    expect(frontMark).toBe(0);
    expect(backMark).toBeGreaterThan(50);
    for (const pk of openPockets) expect(zRangeOver(open.soup, insetConvexPoly(pk, 0.5)).max).toBeLessThanOrEqual(1 + 1e-6);

    // too little wall height to be legible: left off, with a warning
    const flat = buildTray(rectPolygon(56, 31), twoSlotTray(0.6).cells, { floor: 0.6, plateHeight: 1, watermark: 'BITDEATHLABS', watermarkHeight: 0.3 });
    expect(flat.watermark).toBe(false);
    expect(flat.warnings.some((w) => /mark/.test(w))).toBe(true);

    // a round tray: the mark follows the curved wall round the front, and the slot floor stays bare
    const roundTray = ellipsePolygon(80, 60, 64);
    const rp = [trayPocket({ kind: 'ellipse', w: 50, d: 50 }, 0, 0, 0, 0.2)];
    const rc = traySurroundCells(roundTray, rp).cells;
    const rr = buildTray(roundTray, rc, { floor: 1, plateHeight: 3, pockets: rp, gap: 0.2, underside: UNDERSIDE, watermark: 'BITDEATHLABS', watermarkHeight: 0.3 });
    expect(rr.watermark).toBe(true);
    expect(isWatertight(rr.soup)).toBe(true);
    const Q = rr.soup.positions;
    let out = 0;
    for (let i = 0; i < rr.soup.triCount * 9; i += 3) {
      const x = Q[i], y = Q[i + 1], z = Q[i + 2];
      const e = (x / 40) ** 2 + (y / 30) ** 2;
      if (e > 1 + 1e-4) {
        out++;
        expect(y).toBeLessThan(0); // round the front
        expect((x / 40.35) ** 2 + (y / 30.35) ** 2).toBeLessThanOrEqual(1 + 1e-4); // never more than the mark's height proud
      }
      // nothing stands on the floor inside the slot
      if (Math.hypot(x, y) < 24.5) expect(z).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(out).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// the whole pipeline: a tray cut from a scene
// ---------------------------------------------------------------------------

const FLAT4: EdgeTreatment[] = [{ kind: 'vertical' }, { kind: 'vertical' }, { kind: 'vertical' }, { kind: 'vertical' }];

/** A 150 x 100 two-shell scene, like the bundled OPR plate. */
function scene() {
  return prepareSource(syntheticTwoShellBase({ shape: 'rect', w: 150, d: 100 }), 'S_Base_Square_150mm_100mm_1.stl');
}

/** Tray params for a row of `cols` bases of `size` mm, centred on the scene. */
function trayParamsFor(cols: number, size: number, floor: number, opts: Partial<TrayParams> = {}): TrayParams {
  const pockets: Polygon2[] = [];
  const centres: { x: number; y: number }[] = [];
  for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * size;
    pockets.push(trayPocket({ kind: 'rect', w: size, d: size }, x, 0, 0, 0.2));
    centres.push({ x, y: 0 });
  }
  return {
    floor,
    plateHeight: 3,
    pockets,
    magnets: magnetSlotSpecs(sizing, centres),
    magnetFloorMin: 0.6,
    gap: 0.2,
    minWall: 1,
    watermark: 'BITDEATHLABS',
    watermarkHeight: 0.3,
    underside: UNDERSIDE,
    ...opts,
  };
}

describe('tray in the pipeline', () => {
  it('holds a base flush with its surround at any floor thickness', () => {
    const src = scene();
    const root = sourceFrame(src);
    for (const t of [0.6, 1.0, 4.0]) {
      const frameRes = computePiece(root, { shape: { kind: 'rect', w: 50, d: 25 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, profile: PROFILE_FLAT, role: 'frame' }, { source: src, skipSculpt: true });
      const base = computePiece(frameRes.frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [-12.5, 0], rotDeg: 0, edges: FLAT4, profile: PROFILE_FLAT }, { source: src, hollow: DEFAULT_HOLLOW });
      const tray = computePiece(root, { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, t) }, { source: src });
      // with 2 mm magnets a floor under 2.7 mm is made 2.7 mm; the base's plate height plus the floor as built IS the tray's height
      const f = tray.tray!.floor;
      expect(f).toBeCloseTo(Math.max(t, 2.7), 6);
      expect(tray.outline.plateTop - f).toBeCloseTo(base.outline.plateTop, 9);
      // and the scenery on the tray sits exactly the floor thickness above the scenery on the base
      const bz = boundsOfSoup(base.sculpt).min[2];
      expect(boundsOfSoup(tray.sculpt).min[2] - f).toBeCloseTo(bz, 4);
      // the opening's floor is the top of the floor slab, whatever it is
      expect(zRangeOver(tray.body, rectPolygon(44, 20)).max).toBeCloseTo(f, 5);
    }
  });

  it('cuts a clean tray out of a two-shell scene', () => {
    const src = scene();
    const tray = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 56, d: 31 }, xy: [10, -5], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, 1, { pockets: [trayPocket({ kind: 'rect', w: 25, d: 25 }, -2.5, -5, 0, 0.2), trayPocket({ kind: 'rect', w: 25, d: 25 }, 22.5, -5, 0, 0.2)], magnets: magnetSlotSpecs(sizing, [{ x: -2.5, y: -5 }, { x: 22.5, y: -5 }]) }) }, { source: src });
    expect(tray.warnings.filter((w) => /failed|force-closed/.test(w))).toEqual([]);
    expect(tray.sculpt.triCount).toBeGreaterThan(0);
    expect(isWatertight(tray.body)).toBe(true);
    expect(tray.size.w).toBeCloseTo(56, 6);
    expect(tray.size.d).toBeCloseTo(31, 6);
    expect(tray.tray).toBeDefined();
    expect(tray.tray!.cells).toBe(4);
    expect(tray.tray!.magnetMode).toBe('recess');
    expect(tray.tray!.floorAsked).toBeCloseTo(1, 6);
    expect(tray.tray!.floor).toBeCloseTo(2.7, 6); // deepened for the 2 mm magnets
    expect(boundsOfSoup(tray.body).max[2]).toBeCloseTo(2.7 + 3, 5); // and the surround rose with it
    expect(tray.tray!.watermark).toBe(true);
    expect(Math.max(tray.tray!.thinSpan.w, tray.tray!.thinSpan.d)).toBeGreaterThan(40);
    const b = boundsOfSoup(tray.body);
    expect(b.max[0] - b.min[0]).toBeCloseTo(56, 5);
    expect(b.max[2]).toBeCloseTo(2.7 + 3, 5);
  });

  it('bumps the cut stamp for every cell, so no cell loses the scenery another one touched', () => {
    const src = scene();
    const root = sourceFrame(src);
    const params = { shape: { kind: 'rect' as const, w: 56, d: 31 }, xy: [0, 0] as [number, number], rotDeg: 0, edges: FLAT4, role: 'tray' as const, tray: trayParamsFor(2, 25, 1) };
    // a shared stamp is how the worker calls this: every cell must bump it itself
    const stamp = { arr: new Uint32Array(src.sculpt.triCount), id: 0 };
    stamp.id++;
    const a = computePiece(root, params, { source: src, stamp });
    stamp.id++;
    const b = computePiece(root, params, { source: src, stamp });
    // with no stamp at all every cut allocates its own, which is the correct answer
    const fresh = computePiece(root, params, { source: src });
    expect(a.sculpt.triCount).toBeGreaterThan(0);
    expect(a.sculpt.triCount).toBe(fresh.sculpt.triCount);
    expect(b.sculpt.triCount).toBe(fresh.sculpt.triCount);
    // and all four sides of the surround carry scenery, not just the first one cut
    const strips = [rectPolygon(56, 2, 0, -14.4), rectPolygon(56, 2, 0, 14.4), rectPolygon(2, 31, -26.9, 0), rectPolygon(2, 31, 26.9, 0)];
    const P = a.sculpt.positions;
    for (const strip of strips) {
      let hits = 0;
      for (let t = 0; t < a.sculpt.triCount; t++) {
        const i = t * 9;
        const cx = (P[i] + P[i + 3] + P[i + 6]) / 3, cy = (P[i + 1] + P[i + 4] + P[i + 7]) / 3;
        if (pointInConvexPolygon(strip, cx, cy, 0.2)) hits++;
      }
      expect(hits).toBeGreaterThan(0);
    }
  });

  it('carves a tray out of an object scene and stands it on its own floor', () => {
    const src = prepareSource(boxSoup(60, 40, 8), 'slab_60x40.stl');
    expect(src.mode).toBe('generic');
    const t = 2.7; // thick enough for the 2 mm magnets, so the floor is exactly what was asked
    const tray = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, t, { watermark: '' }) }, { source: src });
    expect(tray.warnings.filter((w) => /failed|force-closed/.test(w))).toEqual([]);
    expect(tray.outline.plateTop).toBeCloseTo(t, 9);
    expect(isWatertight(tray.body)).toBe(true);
    expect(isWatertight(tray.sculpt)).toBe(true);
    // the floor slab, then the scene's own material standing on it
    expect(boundsOfSoup(tray.body).max[2]).toBeCloseTo(t, 5);
    expect(boundsOfSoup(tray.sculpt).min[2]).toBeCloseTo(t, 5);
    expect(boundsOfSoup(tray.sculpt).max[2]).toBeCloseTo(t + 7.95, 3);
    // the surround is the material around the openings, and nothing stands in them
    const surroundArea = 56 * 31 - 50.4 * 25.4;
    expect(signedVolume(tray.sculpt)).toBeGreaterThan(surroundArea * 7.9 * 0.97);
    expect(signedVolume(tray.sculpt)).toBeLessThan(surroundArea * 7.9 * 1.06);
    expect(zRangeOver(tray.body, rectPolygon(44, 20)).max).toBeCloseTo(t, 5);
    expect(zRangeOver(tray.sculpt, rectPolygon(44, 20)).max).toBe(-Infinity);

    // with the mark on: an object scene's outer wall is the floor band plus the scene's own material
    // standing on it, so the mark goes there, and never on the floor inside a slot
    const slots = [rectPolygon(24, 24, -12.5, 0), rectPolygon(24, 24, 12.5, 0)];
    const marked = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, t) }, { source: src });
    expect(marked.tray!.watermark).toBe(true);
    for (const sl of slots) expect(zRangeOver(marked.body, sl).max).toBeLessThanOrEqual(t + 1e-4);
    // a floor too thin for the mark on its own still gets it, on the scene's wall above the floor
    const thin = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, 1, { magnets: undefined }) }, { source: src });
    expect(thin.tray!.floor).toBeCloseTo(1, 6);
    expect(thin.tray!.watermark).toBe(true);
    for (const sl of slots) expect(zRangeOver(thin.body, sl).max).toBeLessThanOrEqual(1 + 1e-4);
    const tb = boundsOfSoup(thin.body);
    expect(tb.max[2]).toBeGreaterThan(1.5); // up the wall, not in the floor band
    // on the long (56 mm) wall, standing its full height proud of it
    expect(Math.min(tb.min[1], -tb.max[1])).toBeCloseTo(-(15.5 + TRAY_MARK_PROUD), 5);
  });

  it('reports a slot at the tray edge, a magnet thicker than the floor, and mixed edge shapes', () => {
    const src = scene();
    const root = sourceFrame(src);
    // 25 mm bases in a 50.6 mm tray: only 0.1 mm of rim
    const tight = computePiece(root, { shape: { kind: 'rect', w: 50.6, d: 25.6 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, 1) }, { source: src });
    expect(tight.warnings.some((w) => /less than 1 mm from the edge|past the edge/.test(w))).toBe(true);
    const thin = computePiece(root, { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, 1) }, { source: src });
    expect(thin.warnings.some((w) => /right through/.test(w))).toBe(false);
    expect(thin.tray!.floor).toBeCloseTo(2.7, 6);
    expect(thin.tray!.floorAsked).toBeCloseTo(1, 6);
    const mixed = computePiece(root, { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, 3, { mixedHeights: true }) }, { source: src });
    expect(mixed.warnings.some((w) => /same edge shape/.test(w))).toBe(true);
    expect(mixed.tray!.magnetMode).toBe('recess');
    const empty = computePiece(root, { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(0, 25, 1, { pockets: [], magnets: [] }) }, { source: src });
    expect(empty.warnings.some((w) => /nothing to hold/.test(w))).toBe(true);
  });
});

describe('tray print-ready export', () => {
  it('supports a tray flat or on a shallow tilt, clear of the magnet holes', () => {
    const src = scene();
    const tray = computePiece(sourceFrame(src), { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, 1) }, { source: src });
    const info = tray.tray!;
    const maxDim = Math.max(tray.size.w, tray.size.d);
    // the rule the worker's exportable() applies: flat up to 80 mm, a shallow tilt above it
    expect(maxDim <= 80 ? 0 : 25).toBe(0);
    const d = densitySpacing(maxDim, 'medium');
    const flat = presupport(
      { body: tray.body, sculpt: tray.sculpt, bottom: tray.outline.bottom, slots: info.magnets },
      { ...DEFAULT_PRESUPPORT, tiltDeg: 0, spacing: Math.min(d.spacing, 6), edgeSpacing: d.edgeSpacing },
    );
    expect(flat.tiltDeg).toBe(0);
    expect(flat.supportCount).toBeGreaterThan(20);
    expect(isWatertight(flat.supports)).toBe(true);
    expect(boundsOfSoup(flat.body).min[2]).toBeCloseTo(DEFAULT_PRESUPPORT.standoff, 3);
    // no support tip stands in a magnet hole
    for (const c of flat.contacts) {
      for (const m of info.magnets) expect(Math.hypot(c[0] - m.x, c[1] - m.y)).toBeGreaterThan(m.radius);
    }

    // a big tray gets the shallow tilt instead, and the middle spacing stays clamped
    const big = densitySpacing(131, 'medium');
    expect(big.spacing).toBe(8);
    expect(Math.min(big.spacing, 6)).toBe(6);
    const tilted = presupport(
      { body: tray.body, sculpt: tray.sculpt, bottom: tray.outline.bottom, slots: info.magnets },
      { ...DEFAULT_PRESUPPORT, tiltDeg: 25, spacing: 6, edgeSpacing: big.edgeSpacing },
    );
    expect(tilted.tiltDeg).toBe(25);
    expect(isWatertight(tilted.supports)).toBe(true);
    expect(tilted.height).toBeGreaterThan(flat.height);
  });
});

/**
 * The tray and one of its bases put together the way they are printed and used: the base
 * dropped into its slot, standing on the floor the tray actually reports. This is the check
 * the user does with the real parts, so it runs for a two-shell scene AND an object scene,
 * with and without magnets, on a floor thinner than the magnets (deepened) and a thick one.
 */
describe('tray assembly: a base dropped into its slot', () => {
  const objectScene = () => prepareSource(boxSoup(80, 50, 8), 'slab_80x50.stl');
  const cases = [
    { name: 'two-shell scene', src: scene },
    { name: 'object scene', src: objectScene },
  ];
  for (const c of cases) {
    for (const magnets of [true, false]) {
      for (const asked of [1, 3]) {
        it(`${c.name}, magnets ${magnets ? 'on' : 'off'}, floor asked ${asked} mm`, () => {
          const src = c.src();
          const root = sourceFrame(src);
          const frameRes = computePiece(root, { shape: { kind: 'rect', w: 50, d: 25 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, profile: PROFILE_FLAT, role: 'frame' }, { source: src, skipSculpt: true });
          const baseSlots = magnets ? magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]) : [];
          const base = computePiece(frameRes.frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [-12.5, 0], rotDeg: 0, edges: FLAT4, profile: PROFILE_FLAT }, { source: src, hollow: DEFAULT_HOLLOW, magnetSlots: baseSlots });
          const tray = computePiece(root, { shape: { kind: 'rect', w: 56, d: 31 }, xy: [0, 0], rotDeg: 0, edges: FLAT4, role: 'tray', tray: trayParamsFor(2, 25, asked, magnets ? {} : { magnets: undefined }) }, { source: src });
          const F = tray.tray!.floor;
          // the floor is only ever deepened for magnets, never thinned
          expect(F).toBeGreaterThanOrEqual(asked - 1e-9);
          if (!magnets) expect(F).toBeCloseTo(asked, 9);

          // 1. the base stands on its own underside: nothing of it reaches below z = 0
          const baseAll = [base.body, base.sculpt].filter((s) => s.triCount > 0);
          const baseMin = Math.min(...baseAll.map((s) => boundsOfSoup(s).min[2]));
          const baseMax = Math.max(...baseAll.map((s) => boundsOfSoup(s).max[2]));
          expect(baseMin).toBeCloseTo(0, 4);

          // 2. nothing of the tray stands above the floor inside the slot (the base sits on the floor)
          const slot = rectPolygon(24, 24, -12.5, 0); // the slot, 0.5 mm in from its walls
          for (const s of [tray.body, tray.sculpt]) if (s.triCount > 0) expect(zRangeOver(s, slot).max).toBeLessThanOrEqual(F + 1e-4);

          // 3. flush: the base's top, standing on the floor, is level with the surround's top
          const trayAll = [tray.body, tray.sculpt].filter((s) => s.triCount > 0);
          const ring = [rectPolygon(3, 31, -26.5, 0), rectPolygon(3, 31, 26.5, 0)]; // the rim beside the slots
          let trayTop = -Infinity;
          for (const s of trayAll) for (const r of ring) trayTop = Math.max(trayTop, zRangeOver(s, r).max);
          expect(trayTop).toBeCloseTo(F + baseMax, 3);
        });
      }
    }
  }
});
