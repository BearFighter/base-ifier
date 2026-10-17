import type { Soup } from '../types';

/**
 * Applies p' = p * scale + translate (scale first, then translate) to every
 * vertex of the soup. Defaults: scale = [1,1,1], translate = [0,0,0].
 */
export function transformSoup(
  soup: Soup,
  opts: { scale?: [number, number, number]; translate?: [number, number, number] },
  inPlace = false,
): Soup {
  const [sx, sy, sz] = opts.scale ?? [1, 1, 1];
  const [tx, ty, tz] = opts.translate ?? [0, 0, 0];

  const src = soup.positions;
  const n = soup.triCount * 9;
  const out = inPlace ? src : new Float32Array(src.length);

  for (let i = 0; i < n; i += 3) {
    out[i] = src[i] * sx + tx;
    out[i + 1] = src[i + 1] * sy + ty;
    out[i + 2] = src[i + 2] * sz + tz;
  }

  if (inPlace) {
    return soup;
  }
  return { positions: out, triCount: soup.triCount };
}

/**
 * A rotation that maps coordinate axes onto coordinate axes (quarter turns):
 * output axis k = sign[k] * input axis src[k]. Only proper rotations are
 * allowed: a mirror would turn every triangle inside out.
 */
export interface AxisPermutation {
  src: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
  sign: [1 | -1, 1 | -1, 1 | -1];
}

/** Determinant of an axis permutation: +1 for a rotation, -1 for a mirror. */
export function axisPermutationDet(p: AxisPermutation): number {
  const [a, b, c] = p.src;
  if (a === b || b === c || a === c) return 0;
  // parity of the permutation: even when it is a cyclic shift of [0, 1, 2]
  const even = (a === 0 && b === 1) || (a === 1 && b === 2) || (a === 2 && b === 0);
  return (even ? 1 : -1) * p.sign[0] * p.sign[1] * p.sign[2];
}

/**
 * Applies an axis permutation to every vertex. Swapping and negating float32
 * coordinates is exact, so no vertex moves by even one ulp and welding is
 * unaffected; the winding stays CCW outward because the map is a rotation.
 */
export function permuteSoupAxes(soup: Soup, p: AxisPermutation, inPlace = false): Soup {
  if (axisPermutationDet(p) !== 1) throw new Error('permuteSoupAxes: not a rotation (it would mirror the mesh)');
  const src = soup.positions;
  const n = soup.triCount * 9;
  const out = inPlace ? src : new Float32Array(n);
  const [i0, i1, i2] = p.src;
  const [s0, s1, s2] = p.sign;
  for (let i = 0; i < n; i += 3) {
    const v0 = src[i + i0], v1 = src[i + i1], v2 = src[i + i2];
    out[i] = s0 * v0;
    out[i + 1] = s1 * v1;
    out[i + 2] = s2 * v2;
  }
  return inPlace ? soup : { positions: out, triCount: soup.triCount };
}
