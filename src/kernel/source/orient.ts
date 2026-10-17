/**
 * Which way is up: stand an imported scene on its flat bottom.
 *
 * Many base STLs are saved Y up (or on some other side), and everything after
 * the import (plate detection, the outline, every cut) assumes Z up with the
 * base standing at the bottom of its bounding box. The heuristic, one pass over
 * the triangles:
 *
 *  - For each of the six axis directions `up`, the base would stand on the face
 *    that looks along -up: the triangles whose normal is within 10 degrees of -up
 *    AND whose three corners all lie within a thin band (0.3 mm, or 1% of the
 *    extent along that axis, whichever is larger) of the bounding box's end in
 *    that direction.
 *  - The score is that face's STANCE: the area inside its outline (the convex
 *    hull of its corners, taken from their extremes in 16 directions), not the
 *    area of its triangles. An OPR base stands on a narrow brim ring round its
 *    hollow underside, and a flat-topped sculpt can have twice the ring's flat
 *    area; but the bottom is the widest part of a base (the plate leans in), so
 *    its outline is always the biggest. A face whose triangles cover under 2% of
 *    its outline is a scatter of specks, not something to stand on, and scores 0.
 *  - A base is never taller than its footprint, so a direction whose extent is
 *    larger than both footprint extents scores 0.
 *  - `detected` is the best direction only when its stance is at least twice the
 *    file's own bottom ('z+') and at least a quarter of its footprint's bounding
 *    rectangle; otherwise 'z+'. A plain slab (as flat on top as underneath) is a
 *    tie, so it stays as saved.
 *  - The detection is only acted on (`confident`) when the result is plate-like:
 *    no taller than 0.75 x its smaller footprint extent. A tall prop lying down
 *    is as tall as it is narrow, so it is left standing and only gets a warning.
 *  - Rotations are quarter turns (proper rotations, never mirrors): float32
 *    coordinates are swapped and negated exactly and the winding stays outward.
 *    A rotated soup is lifted so it stands on z = 0; `prepareSource` re-centres
 *    it anyway, and 'z+' hands back the input untouched.
 */
import type { Soup, Vec2 } from '../types';
import { boundsOfSoup } from '../mesh/bbox';
import { permuteSoupAxes, type AxisPermutation } from '../mesh/transform';
import { convexHull } from '../geom2d/hull';
import { polygonArea } from '../geom2d/polygon';

/** Which axis of the file should point up (become +Z). 'z+' is the file as saved. */
export type UpAxis = 'z+' | 'z-' | 'y+' | 'y-' | 'x+' | 'x-';

/** In order of preference when two directions tie. */
export const UP_AXES: readonly UpAxis[] = ['z+', 'z-', 'y+', 'y-', 'x+', 'x-'];

/** What the import did about the orientation (travels to the UI in the source summary). */
export interface SourceOrientation {
  /** the rotation that was applied: this axis of the file now points up */
  applied: UpAxis;
  /** the axis whose flat face looked like the bottom ('z+' when nothing clearly did) */
  detected: UpAxis;
  /** no explicit choice: the rotation was picked automatically */
  auto: boolean;
  /** the detection was sure enough to act on */
  confident: boolean;
}

export interface UpDetection {
  /** what 'auto' applies: `detected` when confident, else 'z+' */
  best: UpAxis;
  detected: UpAxis;
  /** stance per direction: the area inside the outline of its flat bottom face, mm² (0 = nothing to stand on) */
  scores: Record<UpAxis, number>;
  /** area of the flat bottom face's own triangles per direction, mm² */
  flat: Record<UpAxis, number>;
  confident: boolean;
}

/** cos(10°): how close to straight down a face must look to count as part of the bottom */
export const FLAT_NORMAL_COS = Math.cos((10 * Math.PI) / 180);
/** the best stance must be this many times the file's own */
export const CONFIDENCE_RATIO = 2;
/** ... and at least this fraction of its footprint's bounding rectangle */
export const MIN_STANCE_FRACTION = 0.25;
/** a flat face covering less of its own outline than this is specks */
export const MIN_FILL = 0.02;
/** acted on only when the result is no taller than this times its smaller footprint extent */
export const PLATE_ASPECT = 0.75;

/** Quarter turns taking each source direction to +Z (all determinant +1). */
const ROTATIONS: Record<UpAxis, AxisPermutation> = {
  'z+': { src: [0, 1, 2], sign: [1, 1, 1] },
  // half turn about X: (x, -y, -z)
  'z-': { src: [0, 1, 2], sign: [1, -1, -1] },
  // +90° about X: (x, -z, y) — the usual Y-up to Z-up conversion
  'y+': { src: [0, 2, 1], sign: [1, -1, 1] },
  // -90° about X: (x, z, -y)
  'y-': { src: [0, 2, 1], sign: [1, 1, -1] },
  // -90° about Y: (-z, y, x)
  'x+': { src: [2, 1, 0], sign: [-1, 1, 1] },
  // +90° about Y: (z, y, -x)
  'x-': { src: [2, 1, 0], sign: [1, 1, -1] },
};

/** the two footprint axes of each axis */
const FOOT: [number, number][] = [[1, 2], [0, 2], [0, 1]];

/** directions the outline extremes are taken in */
const DIRS = 16;
const DIR_C = Array.from({ length: DIRS }, (_, k) => Math.cos((k * Math.PI * 2) / DIRS));
const DIR_S = Array.from({ length: DIRS }, (_, k) => Math.sin((k * Math.PI * 2) / DIRS));

function axisIndex(up: UpAxis): 0 | 1 | 2 {
  return up[0] === 'x' ? 0 : up[0] === 'y' ? 1 : 2;
}

/** slot of a direction in the per-candidate arrays: 2 * axis, +1 for a '-' direction */
function slot(up: UpAxis): number {
  return 2 * axisIndex(up) + (up[1] === '-' ? 1 : 0);
}

/**
 * Rigid quarter-turn rotation that makes the file's `up` axis point along +Z,
 * then lifted so the lowest point is at z = 0. 'z+' returns `soup` itself.
 */
export function rotateSoupUp(soup: Soup, up: UpAxis, inPlace = false): Soup {
  if (up === 'z+') return soup;
  const out = permuteSoupAxes(soup, ROTATIONS[up], inPlace);
  const n = out.triCount * 9;
  if (n === 0) return out;
  const P = out.positions;
  let minZ = Infinity;
  for (let i = 2; i < n; i += 3) if (P[i] < minZ) minZ = P[i];
  if (minZ !== 0) for (let i = 2; i < n; i += 3) P[i] -= minZ;
  return out;
}

/** Score the six directions and decide which way is up (see the header). */
export function detectUpAxis(soup: Soup): UpDetection {
  const zero = (): Record<UpAxis, number> => ({ 'z+': 0, 'z-': 0, 'y+': 0, 'y-': 0, 'x+': 0, 'x-': 0 });
  const scores = zero(), flat = zero();
  const n = soup.triCount;
  if (n === 0) return { best: 'z+', detected: 'z+', scores, flat, confident: false };
  const b = boundsOfSoup(soup);
  const lo = b.min, hi = b.max;
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const band = ext.map((e) => Math.max(0.3, 0.01 * e));
  // per candidate slot (see `slot`): flat area, and the outline's extreme corner in each direction
  const area = new Float64Array(6);
  const reach = new Float64Array(6 * DIRS).fill(-Infinity);
  const cu = new Float64Array(6 * DIRS), cv = new Float64Array(6 * DIRS);
  const P = soup.positions;
  for (let t = 0; t < n; t++) {
    const i = t * 9;
    const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2];
    const vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 0)) continue;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const a = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const na = a === 0 ? nx : a === 1 ? ny : nz;
    if (Math.abs(na) < FLAT_NORMAL_COS * len) continue;
    const c0 = P[i + a], c1 = P[i + 3 + a], c2 = P[i + 6 + a];
    let c: number;
    if (na < 0) {
      // looks along -axis at the low end: the bottom if this axis points up
      const lim = lo[a] + band[a];
      if (!(c0 <= lim && c1 <= lim && c2 <= lim)) continue;
      c = 2 * a;
    } else {
      const lim = hi[a] - band[a];
      if (!(c0 >= lim && c1 >= lim && c2 >= lim)) continue;
      c = 2 * a + 1;
    }
    area[c] += len / 2;
    const [fu, fv] = FOOT[a];
    for (let v = 0; v < 3; v++) {
      const pu = P[i + v * 3 + fu], pv = P[i + v * 3 + fv];
      for (let k = 0; k < DIRS; k++) {
        const d = pu * DIR_C[k] + pv * DIR_S[k];
        const j = c * DIRS + k;
        if (d > reach[j]) { reach[j] = d; cu[j] = pu; cv[j] = pv; }
      }
    }
  }
  for (const up of UP_AXES) {
    const c = slot(up), a = axisIndex(up);
    flat[up] = area[c];
    if (area[c] === 0) continue;
    const pts: Vec2[] = [];
    for (let k = 0; k < DIRS; k++) pts.push([cu[c * DIRS + k], cv[c * DIRS + k]]);
    const stance = Math.abs(polygonArea(convexHull(pts)));
    const [fu, fv] = FOOT[a];
    const tall = ext[a] > ext[fu] && ext[a] > ext[fv];
    scores[up] = tall || area[c] < MIN_FILL * stance ? 0 : stance;
  }
  let top: UpAxis = 'z+';
  for (const up of UP_AXES) if (scores[up] > scores[top]) top = up;
  const [fu, fv] = FOOT[axisIndex(top)];
  const clear = top !== 'z+' && scores[top] >= CONFIDENCE_RATIO * scores['z+'] && scores[top] >= MIN_STANCE_FRACTION * ext[fu] * ext[fv];
  const detected: UpAxis = clear ? top : 'z+';
  const confident = clear && ext[axisIndex(top)] <= PLATE_ASPECT * Math.min(ext[fu], ext[fv]);
  return { best: confident ? detected : 'z+', detected, scores, flat, confident };
}

/**
 * The import step: detect, then rotate as asked ('auto' = rotate only when
 * confident). `inPlace` rotates the caller's soup (the worker's private copy).
 */
export function orientSoup(raw: Soup, choice: UpAxis | 'auto' = 'auto', inPlace = false): { soup: Soup; orientation: SourceOrientation; warnings: string[] } {
  const det = detectUpAxis(raw);
  const auto = choice === 'auto';
  const applied: UpAxis = auto ? det.best : choice;
  const soup = rotateSoupUp(raw, applied, inPlace);
  const warnings: string[] = [];
  if (auto && applied !== 'z+') {
    warnings.push(applied === 'z-'
      ? "This file was upside down. It has been turned over so the flat face is the bottom. Wrong? Change 'Which way is up' on the Scene tab."
      : `This file was lying on its side (its ${applied[0].toUpperCase()} axis pointed ${applied[1] === '+' ? 'up' : 'down'}). It has been stood up so the flat face is the bottom. Wrong? Change 'Which way is up' on the Scene tab.`);
  } else if (auto && det.detected !== 'z+') {
    warnings.push(det.detected === 'z-'
      ? "This scene may be upside down. If it looks wrong, change 'Which way is up' on the Scene tab."
      : "This scene may be on its side. If it looks wrong, change 'Which way is up' on the Scene tab.");
  }
  return { soup, orientation: { applied, detected: det.detected, auto, confident: det.confident }, warnings };
}
