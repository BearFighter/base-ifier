/**
 * Cut an indexed mesh with a vertical convex prism (the extrusion of a CCW convex
 * polygon), keeping the inside and capping every side face.
 */
import type { IndexedMesh, Polygon2, Soup } from '../types';
import { SoupBuilder } from '../types';
import { clipTriangles, verticalPlanesForPolygon } from '../clip/clipper';
import { chainLoops, planeBasis } from '../clip/loops';
import { capLoops } from '../clip/cap';
import { collectTriangles, type Bins } from './bins';

export interface CutPrismResult {
  soup: Soup;
  warnings: string[];
  stats: { candidates: number; kept: number; clipped: number; dropped: number; capTriangles: number };
}

export interface CutPrismOptions {
  stamp?: { arr: Uint32Array; id: number };
  eps?: number;
}

export function cutPrism(mesh: IndexedMesh, bins: Bins | null, polygon: Polygon2, opts: CutPrismOptions = {}): CutPrismResult {
  const eps = opts.eps ?? 1e-6;
  const planes = verticalPlanesForPolygon(polygon);
  const nP = planes.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  let triIds: Uint32Array | null = null;
  if (bins) {
    triIds = collectTriangles(bins, minX, minY, maxX, maxY, (cx0, cy0, cx1, cy1) => {
      // keep the cell unless it lies entirely outside some plane
      for (let k = 0; k < nP; k++) {
        const { nx, ny, d } = planes[k];
        const m = Math.min(nx * cx0 + ny * cy0, nx * cx1 + ny * cy0, nx * cx0 + ny * cy1, nx * cx1 + ny * cy1) - d;
        if (m > eps) return false;
      }
      return true;
    });
  }
  const stamp = opts.stamp ?? { arr: new Uint32Array(mesh.triCount), id: 1 };
  const out = new SoupBuilder(Math.max(1024, triIds ? triIds.length : mesh.triCount));
  const res = clipTriangles(mesh, planes, { out, triIds, stamp, eps });
  const warnings: string[] = [];
  let capTriangles = 0;
  for (let k = 0; k < nP; k++) {
    const segs = res.segments[k];
    if (segs.length === 0) continue;
    const basis = planeBasis(planes[k]);
    const adjacentPlanes = nP >= 2 ? [planes[(k + nP - 1) % nP], planes[(k + 1) % nP]] : [];
    const { loops, warnings: w } = chainLoops(segs, basis, { adjacentPlanes, eps });
    for (const s of w) warnings.push(`face ${k}: ${s}`);
    capTriangles += capLoops(loops, planes[k], out, warnings);
  }
  return {
    soup: out.build(),
    warnings,
    stats: {
      candidates: triIds ? triIds.length : mesh.triCount,
      kept: res.keptTriangles,
      clipped: res.clippedTriangles,
      dropped: res.droppedTriangles,
      capTriangles,
    },
  };
}
