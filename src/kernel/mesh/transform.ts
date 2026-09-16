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
