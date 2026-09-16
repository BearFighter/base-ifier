import { describe, it, expect } from 'vitest';
import type { IndexedMesh, Plane, Soup } from '@/kernel/types';
import { SoupBuilder } from '@/kernel/types';
import { clipTriangles, planeFromNormalPoint } from '@/kernel/clip/clipper';
import { chainLoops, planeBasis } from '@/kernel/clip/loops';
import { capLoops } from '@/kernel/clip/cap';
import { cutPrism } from '@/kernel/sculpt/cutPrism';
import { trimAbove } from '@/kernel/sculpt/trim';

/** Indexed axis-aligned box [x0,x1]x[y0,y1]x[z0,z1], outward CCW. */
function indexedBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): IndexedMesh {
  const v = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, // 0..3 bottom
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, // 4..7 top
  ]);
  const idx = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom (-z)
    4, 5, 6, 4, 6, 7, // top (+z)
    0, 1, 5, 0, 5, 4, // -y
    1, 2, 6, 1, 6, 5, // +x
    2, 3, 7, 2, 7, 6, // +y
    3, 0, 4, 3, 4, 7, // -x
  ]);
  return { vertices: v, vertexCount: 8, indices: idx, triCount: 12 };
}

function volume(s: Soup): number {
  let v = 0;
  const p = s.positions;
  for (let t = 0; t < s.triCount; t++) {
    const i = t * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2], bx = p[i + 3], by = p[i + 4], bz = p[i + 5], cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Count boundary / non-manifold edges after welding on exact bits (local helper). */
function edgeReport(s: Soup): { boundary: number; nonManifold: number } {
  const map = new Map<string, number>();
  const idx = new Map<string, number>();
  const p = s.positions;
  const key = (i: number) => `${p[i]},${p[i + 1]},${p[i + 2]}`;
  const vid = (i: number) => {
    const k = key(i);
    let v = idx.get(k);
    if (v === undefined) { v = idx.size; idx.set(k, v); }
    return v;
  };
  for (let t = 0; t < s.triCount; t++) {
    const a = vid(t * 9), b = vid(t * 9 + 3), c = vid(t * 9 + 6);
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const e = u < w ? `${u}|${w}` : `${w}|${u}`;
      map.set(e, (map.get(e) ?? 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const n of map.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  return { boundary, nonManifold };
}

function clipAndCap(mesh: IndexedMesh, plane: Plane): { soup: Soup; warnings: string[]; loops: number } {
  const out = new SoupBuilder();
  const res = clipTriangles(mesh, [plane], { out });
  const basis = planeBasis(plane);
  const { loops, warnings } = chainLoops(res.segments[0], basis);
  capLoops(loops, plane, out, warnings);
  return { soup: out.build(), warnings, loops: loops.length };
}

describe('clipTriangles + cap on a box', () => {
  const box = indexedBox(0, 0, 0, 2, 2, 2);

  it('keeps the lower half when clipped by z=1 (normal +z)', () => {
    const plane = planeFromNormalPoint(0, 0, 1, 0, 0, 1);
    const r = clipAndCap(box, plane);
    expect(r.warnings).toEqual([]);
    expect(r.loops).toBe(1);
    expect(volume(r.soup)).toBeCloseTo(4, 6);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });

  it('keeps the upper half when clipped by z=1 (normal -z)', () => {
    const plane = planeFromNormalPoint(0, 0, -1, 0, 0, 1);
    const r = clipAndCap(box, plane);
    expect(volume(r.soup)).toBeCloseTo(4, 6);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });

  it('handles a plane through vertices (diagonal cut)', () => {
    // plane x + y = 2 through the vertical edges at (2,0) and (0,2); keep x+y <= 2
    const plane = planeFromNormalPoint(1, 1, 0, 2, 0, 0);
    const r = clipAndCap(box, plane);
    expect(r.warnings).toEqual([]);
    expect(volume(r.soup)).toBeCloseTo(4, 5);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });

  it('handles a plane coincident with a face (keeps everything, no cap)', () => {
    const plane = planeFromNormalPoint(0, 0, 1, 0, 0, 2);
    const r = clipAndCap(box, plane);
    expect(volume(r.soup)).toBeCloseTo(8, 6);
    expect(r.loops).toBe(0);
  });

  it('drops everything when the box is fully outside', () => {
    const plane = planeFromNormalPoint(0, 0, 1, 0, 0, -1);
    const out = new SoupBuilder();
    const res = clipTriangles(box, [plane], { out });
    expect(res.out.build().triCount).toBe(0);
    expect(res.droppedTriangles).toBe(12);
  });

  it('tilted plane through the middle', () => {
    const plane = planeFromNormalPoint(1, 0, 1, 1, 1, 1);
    const r = clipAndCap(box, plane);
    expect(r.warnings).toEqual([]);
    expect(volume(r.soup)).toBeCloseTo(4, 5);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });
});

describe('trimAbove', () => {
  it('keeps the part above z with a downward cap', () => {
    const box = indexedBox(-1, -1, 0, 1, 1, 3);
    const r = trimAbove(box, 2.5);
    expect(r.warnings).toEqual([]);
    expect(volume(r.soup)).toBeCloseTo(4 * 0.5, 6);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });
});

describe('cutPrism', () => {
  it('cuts a rectangle out of a box', () => {
    const box = indexedBox(-10, -10, 0, 10, 10, 3);
    const poly: [number, number][] = [[-5, -2], [5, -2], [5, 2], [-5, 2]];
    const r = cutPrism(box, null, poly);
    expect(r.warnings).toEqual([]);
    expect(volume(r.soup)).toBeCloseTo(10 * 4 * 3, 5);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });

  it('cuts a rectangle that shares edges with the box', () => {
    const box = indexedBox(-10, -10, 0, 10, 10, 3);
    const poly: [number, number][] = [[-10, -10], [0, -10], [0, 0], [-10, 0]];
    const r = cutPrism(box, null, poly);
    expect(volume(r.soup)).toBeCloseTo(10 * 10 * 3, 5);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });

  it('cuts a 64-gon circle out of a box', () => {
    const box = indexedBox(-10, -10, 0, 10, 10, 3);
    const poly: [number, number][] = [];
    for (let i = 0; i < 64; i++) poly.push([4 * Math.cos((i / 64) * Math.PI * 2), 4 * Math.sin((i / 64) * Math.PI * 2)]);
    const r = cutPrism(box, null, poly);
    expect(r.warnings).toEqual([]);
    const polyArea = 0.5 * 64 * 16 * Math.sin((2 * Math.PI) / 64);
    expect(volume(r.soup)).toBeCloseTo(polyArea * 3, 3);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });

  it('cuts a rectangle partly outside the box', () => {
    const box = indexedBox(-10, -10, 0, 10, 10, 3);
    const poly: [number, number][] = [[5, -5], [15, -5], [15, 5], [5, 5]];
    const r = cutPrism(box, null, poly);
    expect(volume(r.soup)).toBeCloseTo(5 * 10 * 3, 5);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });

  it('cuts a box with a bump (two overlapping shells) and keeps both caps', () => {
    // main slab plus a bump straddling the cut plane x = 0
    const a = indexedBox(-10, -10, 0, 10, 10, 3);
    const b = indexedBox(-2, -2, 2.9, 2, 2, 5);
    const vertices = new Float32Array(a.vertices.length + b.vertices.length);
    vertices.set(a.vertices); vertices.set(b.vertices, a.vertices.length);
    const indices = new Uint32Array(a.indices.length + b.indices.length);
    indices.set(a.indices);
    for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + 8;
    const mesh: IndexedMesh = { vertices, vertexCount: 16, indices, triCount: 24 };
    const poly: [number, number][] = [[-10, -10], [0, -10], [0, 10], [-10, 10]];
    const r = cutPrism(mesh, null, poly);
    expect(r.warnings).toEqual([]);
    expect(volume(r.soup)).toBeCloseTo(10 * 20 * 3 + 2 * 4 * 2.1, 4);
    expect(edgeReport(r.soup)).toEqual({ boundary: 0, nonManifold: 0 });
  });
});
