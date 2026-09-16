import type { Bounds3, Soup } from '../types';

export function boundsOfPositions(positions: Float32Array, floatCount: number): Bounds3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < floatCount; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return { min, max };
}

export function boundsOfSoup(soup: Soup): Bounds3 {
  return boundsOfPositions(soup.positions, soup.triCount * 9);
}
