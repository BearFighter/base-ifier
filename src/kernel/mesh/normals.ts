import type { Soup } from '../types';

/**
 * Per-triangle face normal, repeated for each of the 3 vertices (9 floats
 * per triangle), suitable for a flat three.js BufferGeometry "normal"
 * attribute matching a non-indexed "position" attribute built from the soup.
 */
export function flatNormals(soup: Soup): Float32Array {
  const p = soup.positions;
  const out = new Float32Array(soup.triCount * 9);
  for (let t = 0; t < soup.triCount; t++) {
    const i = t * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len; ny /= len; nz /= len;
    } else {
      nx = 0; ny = 0; nz = 0;
    }
    out[i] = nx; out[i + 1] = ny; out[i + 2] = nz;
    out[i + 3] = nx; out[i + 4] = ny; out[i + 5] = nz;
    out[i + 6] = nx; out[i + 7] = ny; out[i + 8] = nz;
  }
  return out;
}
