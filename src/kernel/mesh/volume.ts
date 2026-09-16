import type { Soup } from '../types';

/**
 * Signed volume of a (closed, CCW-outward) triangle soup, via the divergence
 * theorem: V = sum over triangles of dot(a, cross(b, c)) / 6. Positive for a
 * closed shell with outward-facing CCW winding.
 */
export function signedVolume(soup: Soup): number {
  const p = soup.positions;
  let vol = 0;
  for (let t = 0; t < soup.triCount; t++) {
    const i = t * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    // dot(a, cross(b, c))
    const cross_x = by * cz - bz * cy;
    const cross_y = bz * cx - bx * cz;
    const cross_z = bx * cy - by * cx;
    vol += ax * cross_x + ay * cross_y + az * cross_z;
  }
  return vol / 6;
}

export function surfaceArea(soup: Soup): number {
  const p = soup.positions;
  let area = 0;
  for (let t = 0; t < soup.triCount; t++) {
    const i = t * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
  }
  return area;
}
