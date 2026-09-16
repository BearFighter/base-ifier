/**
 * Triangulate oriented loops on a plane into cap triangles whose normals point
 * along the plane's outward normal.
 */
import { earcutFull } from './earcutFull';
import type { Plane, SoupBuilder } from '../types';
import type { LoopResult } from './loops';

/** Even-odd point-in-polygon on a flat uv array. */
function pointInLoop(uv: number[], x: number, y: number): boolean {
  let inside = false;
  const n = uv.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = uv[i * 2], yi = uv[i * 2 + 1], xj = uv[j * 2], yj = uv[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Cap loops. Positive-area loops are outers, negative-area loops are holes of the
 * smallest outer that contains them. Returns the number of triangles emitted.
 */
export function capLoops(loops: LoopResult[], plane: Plane, out: SoupBuilder, warnings: string[]): number {
  const outers = loops.filter((l) => l.area > 0);
  const holes = loops.filter((l) => l.area < 0);
  const holesOf = new Map<LoopResult, LoopResult[]>();
  for (const h of holes) {
    let best: LoopResult | null = null;
    for (const o of outers) {
      if (pointInLoop(o.uv, h.uv[0], h.uv[1])) {
        if (!best || o.area < best.area) best = o;
      }
    }
    if (best) {
      let list = holesOf.get(best);
      if (!list) { list = []; holesOf.set(best, list); }
      list.push(h);
    } else {
      warnings.push('cap: hole loop without a containing outer loop, capped as an outer');
      outers.push({ ...h, points: h.points.slice().reverse(), keys: h.keys.slice().reverse(), uv: reverseUV(h.uv), area: -h.area });
    }
  }
  let emitted = 0;
  for (const o of outers) {
    const hs = holesOf.get(o) ?? [];
    const flat: number[] = o.uv.slice();
    const pts = o.points.slice();
    const holeIdx: number[] = [];
    for (const h of hs) {
      holeIdx.push(flat.length / 2);
      for (let i = 0; i < h.uv.length; i++) flat.push(h.uv[i]);
      for (const p of h.points) pts.push(p);
    }
    let tris: number[];
    try {
      tris = earcutFull(flat, holeIdx.length ? holeIdx : undefined, warnings);
    } catch (e) {
      warnings.push('cap: earcut failed: ' + String(e));
      continue;
    }
    if (tris.length === 0 && flat.length >= 6) warnings.push('cap: earcut produced no triangles for a loop');
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const a = pts[tris[i]], b = pts[tris[i + 1]], c = pts[tris[i + 2]];
      const ex1 = b[0] - a[0], ey1 = b[1] - a[1], ez1 = b[2] - a[2];
      const ex2 = c[0] - a[0], ey2 = c[1] - a[1], ez2 = c[2] - a[2];
      const nx = ey1 * ez2 - ez1 * ey2, ny = ez1 * ex2 - ex1 * ez2, nz = ex1 * ey2 - ey1 * ex2;
      if (nx * plane.nx + ny * plane.ny + nz * plane.nz >= 0) out.triV(a, b, c);
      else out.triV(a, c, b);
      emitted++;
    }
  }
  return emitted;
}

function reverseUV(uv: number[]): number[] {
  const n = uv.length / 2;
  const r: number[] = new Array(uv.length);
  for (let i = 0; i < n; i++) {
    r[i * 2] = uv[(n - 1 - i) * 2];
    r[i * 2 + 1] = uv[(n - 1 - i) * 2 + 1];
  }
  return r;
}
