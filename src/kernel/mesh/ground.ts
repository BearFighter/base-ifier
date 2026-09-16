/**
 * Put a prop mesh on the ground line: centre it in XY on its footprint bounds
 * and drop its lowest point to z = 0, so the studio can place it by its ground
 * contact. Mutates the soup in place (the caller owns it) and reports the
 * footprint radius and height the scatter needs.
 */
import type { Soup } from '../types';

export function groundSoup(soup: Soup): { footprintRadius: number; height: number } {
  const P = soup.positions;
  const n = soup.triCount * 9;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 3) {
    minX = Math.min(minX, P[i]); maxX = Math.max(maxX, P[i]);
    minY = Math.min(minY, P[i + 1]); maxY = Math.max(maxY, P[i + 1]);
    minZ = Math.min(minZ, P[i + 2]); maxZ = Math.max(maxZ, P[i + 2]);
  }
  if (!Number.isFinite(minX)) return { footprintRadius: 0, height: 0 };
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let r2 = 0;
  for (let i = 0; i < n; i += 3) {
    P[i] -= cx; P[i + 1] -= cy; P[i + 2] -= minZ;
    r2 = Math.max(r2, P[i] * P[i] + P[i + 1] * P[i + 1]);
  }
  return { footprintRadius: Math.sqrt(r2), height: maxZ - minZ };
}
