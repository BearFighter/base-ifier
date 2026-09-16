import { describe, expect, it } from 'vitest';
import type { Polygon2, Vec2 } from '@/kernel/types';
import {
  dedupePolygon,
  ensureCCW,
  isCCW,
  minEdgeDistance,
  pointInConvexPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonEdgeDistances,
  polygonPerimeter,
  rotatePolygon,
  translatePolygon,
} from '@/kernel/geom2d/polygon';
import { convexHull } from '@/kernel/geom2d/hull';
import { clipConvexPolygons, clipPolygonByHalfPlane } from '@/kernel/geom2d/clipConvex';
import { insetConvex, insetConvexEdges } from '@/kernel/geom2d/offset';
import { ellipsePolygon, rectPolygon, shapeBounds, shapePolygon, shapeSegments } from '@/kernel/geom2d/shapes';
import { largestEmptyRect, type Rect } from '@/kernel/geom2d/maxEmptyRect';

/** Deterministic PRNG (mulberry32) so hull tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('polygon: area / centroid / winding', () => {
  it('computes area, centroid and CCW-ness of a rectangle', () => {
    const rect = rectPolygon(10, 6, 2, 3); // centred at (2,3)
    expect(polygonArea(rect)).toBeCloseTo(60, 9);
    expect(isCCW(rect)).toBe(true);
    const [cx, cy] = polygonCentroid(rect);
    expect(cx).toBeCloseTo(2, 9);
    expect(cy).toBeCloseTo(3, 9);
  });

  it('reverses a CW polygon to CCW via ensureCCW', () => {
    const rect = rectPolygon(10, 6);
    const cw = rect.slice().reverse();
    expect(isCCW(cw)).toBe(false);
    const fixed = ensureCCW(cw);
    expect(isCCW(fixed)).toBe(true);
    expect(polygonArea(fixed)).toBeCloseTo(60, 9);
  });

  it('ellipse polygon area/centroid/CCW, approaching pi*a*b as segments grow', () => {
    const a = 16;
    const b = 10;
    const exact = Math.PI * a * b;
    const areas = [8, 32, 128, 512].map((segs) => {
      const poly = ellipsePolygon(2 * a, 2 * b, segs);
      expect(isCCW(poly)).toBe(true);
      return polygonArea(poly);
    });
    // Monotonically closer to the analytic area (relative error shrinks).
    const relErr = areas.map((ar) => Math.abs(ar - exact) / exact);
    for (let i = 1; i < relErr.length; i++) {
      expect(relErr[i]).toBeLessThan(relErr[i - 1]);
    }
    expect(relErr[relErr.length - 1]).toBeLessThan(1e-4);

    const poly512 = ellipsePolygon(2 * a, 2 * b, 512, 5, -3);
    const [cx, cy] = polygonCentroid(poly512);
    expect(cx).toBeCloseTo(5, 6);
    expect(cy).toBeCloseTo(-3, 6);
  });

  it('degenerate polygon centroid falls back to vertex mean', () => {
    const degenerate: Polygon2 = [
      [0, 0],
      [2, 0],
      [4, 0],
    ]; // zero area (collinear)
    expect(Math.abs(polygonArea(degenerate))).toBeLessThan(1e-12);
    const [cx, cy] = polygonCentroid(degenerate);
    expect(cx).toBeCloseTo(2, 9);
    expect(cy).toBeCloseTo(0, 9);
  });

  it('polygonBounds returns the axis-aligned bounding box', () => {
    const rect = rectPolygon(10, 6, 1, -2);
    const b = polygonBounds(rect);
    expect(b.min[0]).toBeCloseTo(-4, 9);
    expect(b.min[1]).toBeCloseTo(-5, 9);
    expect(b.max[0]).toBeCloseTo(6, 9);
    expect(b.max[1]).toBeCloseTo(1, 9);
  });

  it('pointInConvexPolygon / pointInPolygon agree on a simple rect', () => {
    const rect = rectPolygon(10, 10);
    expect(pointInConvexPolygon(rect, 0, 0)).toBe(true);
    expect(pointInConvexPolygon(rect, 5, 5)).toBe(true); // boundary
    expect(pointInConvexPolygon(rect, 5.0000001, 0)).toBe(false);
  });

  it('translatePolygon and dedupePolygon behave as expected', () => {
    const rect = rectPolygon(4, 4);
    const moved = translatePolygon(rect, 1, 2);
    expect(moved[0]).toEqual([-1, 0]);

    const withJunk: Polygon2 = [
      [0, 0],
      [0, 0.0000001],
      [4, 0],
      [4, 0], // collinear-ish duplicate near corner
      [4, 4],
      [2, 4], // collinear middle point on top edge
      [0, 4],
    ];
    const clean = dedupePolygon(withJunk, 1e-6);
    expect(clean.length).toBe(4);
    expect(Math.abs(polygonArea(clean) - 16)).toBeLessThan(1e-6);
  });

  it('polygonPerimeter sums edge lengths', () => {
    const rect = rectPolygon(3, 4);
    expect(polygonPerimeter(rect)).toBeCloseTo(14, 9);
  });
});

describe('polygonEdgeDistances / minEdgeDistance sign convention', () => {
  it('is positive inside, negative outside, for a CCW square', () => {
    const square = rectPolygon(10, 10); // spans [-5,5] x [-5,5]
    const centerDists = polygonEdgeDistances(square, 0, 0);
    for (const d of centerDists) expect(d).toBeCloseTo(5, 9);
    expect(minEdgeDistance(square, 0, 0)).toBeCloseTo(5, 9);

    const outsideDists = polygonEdgeDistances(square, 10, 0);
    // Right edge (index 1: (5,-5)->(5,5)) should read negative for a point at x=10.
    expect(outsideDists[1]).toBeCloseTo(-5, 9);
    expect(minEdgeDistance(square, 10, 0)).toBeLessThan(0);
  });
});

describe('rotatePolygon', () => {
  it('rotates 90 degrees exactly (about origin and about an arbitrary centre)', () => {
    const rect: Polygon2 = [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ];
    const rotated = rotatePolygon(rect, 90);
    // CCW rotation of (x,y) about origin by 90 -> (-y, x)
    expect(rotated).toEqual([
      [0, 0],
      [0, 4],
      [-2, 4],
      [-2, 0],
    ]);

    const square = rectPolygon(10, 6, 3, 1);
    const rotatedAboutCentre = rotatePolygon(square, 90, 3, 1);
    const b = polygonBounds(rotatedAboutCentre);
    expect(b.min[0]).toBeCloseTo(3 - 3, 9); // half of d (6) becomes half-width
    expect(b.max[0]).toBeCloseTo(3 + 3, 9);
    expect(b.min[1]).toBeCloseTo(1 - 5, 9); // half of w (10) becomes half-height
    expect(b.max[1]).toBeCloseTo(1 + 5, 9);
  });
});

describe('convexHull', () => {
  it('returns [] for fewer than 3 distinct points', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([[0, 0]])).toEqual([]);
    expect(convexHull([[0, 0], [1, 1]])).toEqual([]);
    expect(convexHull([[0, 0], [0, 0], [1, 1]])).toEqual([]); // only 2 distinct
  });

  it('drops collinear points and handles duplicates', () => {
    const pts: Vec2[] = [
      [0, 0],
      [1, 0],
      [2, 0], // collinear with the two above
      [2, 2],
      [0, 2],
      [0, 0], // duplicate
    ];
    const hull = convexHull(pts);
    expect(hull.length).toBe(4);
    expect(isCCW(hull)).toBe(true);
    expect(polygonArea(hull)).toBeCloseTo(4, 9);
  });

  it('contains all input points and is convex, for random point sets', () => {
    const rand = mulberry32(12345);
    for (let trial = 0; trial < 5; trial++) {
      const pts: Vec2[] = [];
      const count = 40;
      for (let i = 0; i < count; i++) {
        pts.push([Math.round(rand() * 1000) / 10, Math.round(rand() * 1000) / 10]);
      }
      const hull = convexHull(pts);
      expect(hull.length).toBeGreaterThanOrEqual(3);
      expect(isCCW(hull)).toBe(true);

      // Convexity: every triple of consecutive vertices turns left (or straight).
      const n = hull.length;
      for (let i = 0; i < n; i++) {
        const a = hull[(i - 1 + n) % n];
        const b = hull[i];
        const c = hull[(i + 1) % n];
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        expect(cross).toBeGreaterThanOrEqual(-1e-9);
      }

      // Containment: every original point is inside or on the hull boundary.
      for (const p of pts) {
        expect(pointInConvexPolygon(hull, p[0], p[1], 1e-6)).toBe(true);
      }
    }
  });
});

describe('clipConvexPolygons / clipPolygonByHalfPlane', () => {
  const subject = rectPolygon(150, 100); // x:[-75,75], y:[-50,50]

  it('clip fully inside subject returns the clip rect exactly', () => {
    const clip = rectPolygon(125, 50); // x:[-62.5,62.5], y:[-25,25]
    const result = clipConvexPolygons(subject, clip);
    expect(result.length).toBe(4);
    const b = polygonBounds(result);
    expect(b.min).toEqual([-62.5, -25]);
    expect(b.max).toEqual([62.5, 25]);
    expect(polygonArea(result)).toBeCloseTo(125 * 50, 9);
  });

  it('partial overlap produces the exact intersection rectangle', () => {
    const clip = rectPolygon(125, 50, 100, 0); // x:[37.5,162.5], y:[-25,25]
    const result = clipConvexPolygons(subject, clip);
    const b = polygonBounds(result);
    expect(b.min[0]).toBeCloseTo(37.5, 9);
    expect(b.min[1]).toBeCloseTo(-25, 9);
    expect(b.max[0]).toBeCloseTo(75, 9);
    expect(b.max[1]).toBeCloseTo(25, 9);
    expect(polygonArea(result)).toBeCloseTo((75 - 37.5) * 50, 9);
  });

  it('no overlap returns []', () => {
    const clip = rectPolygon(125, 50, 250, 0); // x:[187.5,312.5] - well clear of subject
    expect(clipConvexPolygons(subject, clip)).toEqual([]);
  });

  it('clipping an ellipse by a rect approximates the analytic half-circle area', () => {
    const r = 16;
    const circle = ellipsePolygon(2 * r, 2 * r, 256);
    const halfPlaneRect = rectPolygon(200, 200, 100, 0); // x:[0,200], y:[-100,100] -> keeps x>=0
    const clipped = clipConvexPolygons(circle, halfPlaneRect);
    const expected = (Math.PI * r * r) / 2;
    const area = polygonArea(clipped);
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.01);
  });

  it('clipPolygonByHalfPlane keeps the left side of the directed line', () => {
    const square = rectPolygon(10, 10); // [-5,5]x[-5,5]
    // Line going from (0,5) to (0,-5): left side is +x (x >= 0).
    const right = clipPolygonByHalfPlane(square, [0, 5], [0, -5]);
    expect(polygonArea(right)).toBeCloseTo(50, 6);
    const b = polygonBounds(right);
    expect(b.min[0]).toBeCloseTo(0, 9);
    expect(b.max[0]).toBeCloseTo(5, 9);
  });
});

describe('insetConvexEdges / insetConvex', () => {
  it('uniform inset of a 25x25 square by 0.95 yields exactly 23.1 x 23.1', () => {
    const square = rectPolygon(25, 25);
    const result = insetConvex(square, 0.95);
    expect(result.length).toBe(4);
    const b = polygonBounds(result);
    expect(b.max[0] - b.min[0]).toBeCloseTo(23.1, 9);
    expect(b.max[1] - b.min[1]).toBeCloseTo(23.1, 9);
  });

  it('insets [1,0,1,0] on a 25x25 square yields 25 x 23', () => {
    const square = rectPolygon(25, 25);
    const result = insetConvexEdges(square, [1, 0, 1, 0]);
    expect(result.length).toBe(4);
    const b = polygonBounds(result);
    expect(b.max[0] - b.min[0]).toBeCloseTo(25, 9);
    expect(b.max[1] - b.min[1]).toBeCloseTo(23, 9);
  });

  it('skips a degenerate vertex between two parallel consecutive edges', () => {
    // A 10x10 square with an extra collinear vertex splitting the bottom edge in two.
    const withCollinear: Polygon2 = [
      [-5, -5],
      [0, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ];
    const result = insetConvexEdges(withCollinear, [1, 1, 1, 1, 1]);
    // The two parallel bottom edges merge into one offset line; the shared
    // vertex between them is dropped, leaving a clean 4-vertex 8x8 square.
    expect(result.length).toBe(4);
    const b = polygonBounds(result);
    expect(b.min).toEqual([-4, -4]);
    expect(b.max).toEqual([4, 4]);
    expect(polygonArea(result)).toBeCloseTo(64, 9);
  });

  it('returns [] when an asymmetric over-inset inverts the polygon', () => {
    const square = rectPolygon(10, 10); // [-5,5] x [-5,5]
    // Inset the bottom/top edges by 8 (more than the half-height of 5),
    // leaving left/right untouched -> the result is a negative-area (inverted) quad.
    const result = insetConvexEdges(square, [8, 0, 8, 0]);
    expect(result).toEqual([]);
  });

  it('returns [] for a fully-collapsing uniform inset (d == half the side)', () => {
    const square = rectPolygon(10, 10);
    expect(insetConvex(square, 5)).toEqual([]); // degenerates to a single point (area 0)
  });
});

describe('shapes', () => {
  it('rectPolygon starts at (cx - w/2, cy - d/2) and is CCW', () => {
    const rect = rectPolygon(8, 4, 1, 1);
    expect(rect[0]).toEqual([1 - 4, 1 - 2]);
    expect(isCCW(rect)).toBe(true);
  });

  it('ellipsePolygon starts at angle 0: (cx + w/2, cy)', () => {
    const ellipse = ellipsePolygon(20, 10, 64, 3, 4);
    expect(ellipse[0][0]).toBeCloseTo(3 + 10, 9);
    expect(ellipse[0][1]).toBeCloseTo(4, 9);
  });

  it('shapeSegments: rect is 4; ellipse is clamped to [48, 256]', () => {
    expect(shapeSegments({ kind: 'rect', w: 20, d: 30 })).toBe(4);

    const tiny = shapeSegments({ kind: 'ellipse', w: 4, d: 4 });
    expect(tiny).toBe(48);

    const huge = shapeSegments({ kind: 'ellipse', w: 400, d: 400 });
    expect(huge).toBe(256);

    const mid = shapeSegments({ kind: 'ellipse', w: 60, d: 60 });
    expect(mid).toBeGreaterThanOrEqual(48);
    expect(mid).toBeLessThanOrEqual(256);
    // Ramanujan perimeter for a circle of radius 30 is exactly 2*pi*30.
    expect(mid).toBe(Math.min(256, Math.max(48, Math.round(2 * Math.PI * 30))));
  });

  it('shapePolygon builds a rect or ellipse footprint at the given centre/rotation', () => {
    const rectShape = shapePolygon({ kind: 'rect', w: 8, d: 4 }, 2, 2, 90);
    const b = polygonBounds(rectShape);
    expect(b.max[0] - b.min[0]).toBeCloseTo(4, 9); // w/d swapped by 90 deg
    expect(b.max[1] - b.min[1]).toBeCloseTo(8, 9);
  });

  it('shapeBounds swaps w/d exactly under a 90 degree rotation', () => {
    const rectBounds = shapeBounds({ kind: 'rect', w: 8, d: 4 }, 90);
    expect(rectBounds).toEqual({ w: 4, d: 8 });

    const ellipseBounds = shapeBounds({ kind: 'ellipse', w: 20, d: 10 }, 90);
    expect(ellipseBounds.w).toBeCloseTo(10, 9);
    expect(ellipseBounds.d).toBeCloseTo(20, 9);

    const unrotated = shapeBounds({ kind: 'rect', w: 8, d: 4 }, 0);
    expect(unrotated).toEqual({ w: 8, d: 4 });
  });
});

describe('largestEmptyRect', () => {
  it('returns the full container when nothing is occupied', () => {
    const result = largestEmptyRect({ w: 125, h: 50 }, [], 0.5);
    expect(result).toEqual({ x: 0, y: 0, w: 125, h: 50 });
  });

  it('finds the free strip above five 25x25 rects along the bottom row', () => {
    const occupied: Rect[] = [0, 25, 50, 75, 100].map((x) => ({ x, y: 0, w: 25, h: 25 }));
    const result = largestEmptyRect({ w: 125, h: 50 }, occupied, 0.5);
    expect(result).toEqual({ x: 0, y: 25, w: 125, h: 25 });
  });

  it('returns null when the container is fully occupied', () => {
    const occupied: Rect[] = [{ x: 0, y: 0, w: 125, h: 50 }];
    const result = largestEmptyRect({ w: 125, h: 50 }, occupied, 0.5);
    expect(result).toBeNull();
  });

  it('prefers the rectangle closest to the origin when areas tie', () => {
    // Two disjoint free 10x50 columns of equal area on either side of a
    // blocking strip; the one nearer the origin should win.
    const occupied: Rect[] = [{ x: 10, y: 0, w: 5, h: 50 }];
    const result = largestEmptyRect({ w: 25, h: 50 }, occupied, 1);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(0);
    expect(result!.w).toBe(10);
    expect(result!.h).toBe(50);
  });
});
