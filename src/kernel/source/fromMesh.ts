/**
 * Build a `PreparedSource` straight from geometry we generated ourselves (Base
 * Studio scenes). `prepareSource()` has to guess a raw STL's structure; here
 * the caller already knows the body outline and hands over the sculpt shells
 * (terrain slab + props), so we weld, bin and package them and the cutter
 * treats the scene exactly like an OPR file.
 */
import type { Bounds3, IndexedMesh, Polygon2, Shape, Soup } from '../types';
import { concatSoups } from '../types';
import { weld } from '../mesh/weld';
import { manifoldReport } from '../mesh/validate';
import { boundsOfSoup } from '../mesh/bbox';
import { connectedComponents } from '../mesh/components';
import { buildBins } from '../sculpt/bins';
import { polygonCentroid, scalePolygonAbout } from '../geom2d/polygon';
import type { PreparedSource } from './prepareSource';

export interface FromMeshInput {
  name: string;
  /** nominal footprint the cutter shows and sizes by */
  nominal: Shape;
  /** footprint at z = 0 (CCW, convex), centred on the origin */
  bottom: Polygon2;
  /** plate top outline; defaults to `bottom` scaled by `topScale` about its centroid */
  top?: Polygon2;
  /** per-axis top/bottom scale; the OPR look is 0.9237, flat sides are 1 */
  topScale?: [number, number];
  /** plate thickness, mm (OPR: 2.984) */
  plateTop: number;
  /** sculpt shells already in the source frame, bottoms at plateTop - sculptOverlap */
  sculpt: Soup[];
  sculptOverlap?: number;
  binSize?: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function buildPreparedSourceFromMesh(input: FromMeshInput): PreparedSource {
  const t0 = now();
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const overlap = input.sculptOverlap ?? 0.1;
  const ts = input.topScale ?? [1, 1];
  const c = polygonCentroid(input.bottom);
  const top = input.top ?? scalePolygonAbout(input.bottom, ts[0], ts[1], c[0], c[1]);

  const raw: Soup = concatSoups(input.sculpt);
  const rawBounds: Bounds3 = raw.triCount > 0 ? boundsOfSoup(raw) : { min: [0, 0, 0], max: [0, 0, 0] };
  const sculptTrimZ = input.plateTop - overlap;
  if (raw.triCount > 0 && rawBounds.min[2] < sculptTrimZ - 0.05) warnings.push(`sculpt reaches ${(sculptTrimZ - rawBounds.min[2]).toFixed(2)} mm below the plate top overlap`);

  const sculpt: IndexedMesh = weld(raw);
  timings.weld = now() - t0;
  let t1 = now();
  const report = manifoldReport(sculpt);
  const comps = connectedComponents(sculpt);
  timings.analyse = now() - t1;
  t1 = now();
  const bins = buildBins(sculpt, input.binSize ?? 2);
  timings.bins = now() - t1;

  const bodyBounds: Bounds3 = { min: [Math.min(...input.bottom.map((p) => p[0])), Math.min(...input.bottom.map((p) => p[1])), 0], max: [Math.max(...input.bottom.map((p) => p[0])), Math.max(...input.bottom.map((p) => p[1])), input.plateTop] };
  const bounds: Bounds3 = {
    min: [Math.min(bodyBounds.min[0], rawBounds.min[0]), Math.min(bodyBounds.min[1], rawBounds.min[1]), 0],
    max: [Math.max(bodyBounds.max[0], rawBounds.max[0]), Math.max(bodyBounds.max[1], rawBounds.max[1]), Math.max(input.plateTop, rawBounds.max[2])],
  };

  return {
    name: input.name,
    nominal: input.nominal,
    measuredScale: 1,
    mode: 'twoShell',
    outline: { bottom: input.bottom, top, plateTop: input.plateTop, topScale: ts, zMin: 0, zMax: input.plateTop },
    sculpt,
    bins,
    sculptTrimZ,
    stats: {
      tris: raw.triCount,
      bodyTris: 0,
      sculptTris: sculpt.triCount,
      components: comps.count,
      nonManifoldEdges: report.nonManifoldEdges,
      boundaryEdges: report.boundaryEdges,
      bounds,
      rawBounds: bounds,
    },
    warnings,
    transform: { scale: 1, translate: [0, 0, 0] },
    timings,
  };
}
