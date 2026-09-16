/**
 * Extract the analytic description of a base "body" shell: bottom footprint at
 * z=0, plate-top outline at z=plateTop, and the per-axis top/bottom scale.
 */
import type { BodyOutline, Soup, Vec2 } from '../types';
import { convexHull } from '../geom2d/hull';
import { polygonBounds } from '../geom2d/polygon';

export interface BodyAnalysis extends BodyOutline {
  /** top extent / bottom extent per axis */
  topScale: [number, number];
  zMin: number;
  zMax: number;
}

export function analyzeBody(body: Soup, eps = 0.02): BodyAnalysis {
  const P = body.positions;
  const n = body.triCount * 3;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = P[i * 3 + 2];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const botPts: Vec2[] = [];
  const topPts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const z = P[i * 3 + 2];
    if (z <= zMin + eps) botPts.push([P[i * 3], P[i * 3 + 1]]);
    if (z >= zMax - eps) topPts.push([P[i * 3], P[i * 3 + 1]]);
  }
  const bottom = convexHull(botPts);
  const top = convexHull(topPts);
  if (bottom.length < 3) throw new Error('analyzeBody: could not find a bottom outline');
  if (top.length < 3) throw new Error('analyzeBody: could not find a top outline');
  const bb = polygonBounds(bottom), tb = polygonBounds(top);
  const bw = bb.max[0] - bb.min[0], bd = bb.max[1] - bb.min[1];
  const tw = tb.max[0] - tb.min[0], td = tb.max[1] - tb.min[1];
  return {
    bottom,
    top,
    plateTop: zMax - zMin,
    topScale: [bw > 0 ? tw / bw : 1, bd > 0 ? td / bd : 1],
    zMin,
    zMax,
  };
}
