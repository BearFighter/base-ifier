/**
 * Trim a mesh with a horizontal plane, keeping everything above z and capping
 * the opening with a downward-facing cap.
 */
import type { IndexedMesh, Plane, Soup } from '../types';
import { SoupBuilder } from '../types';
import { clipTriangles } from '../clip/clipper';
import { chainLoops, planeBasis } from '../clip/loops';
import { capLoops } from '../clip/cap';

export interface TrimResult {
  soup: Soup;
  warnings: string[];
  capTriangles: number;
  loops: number;
}

export function trimAbove(mesh: IndexedMesh, z: number): TrimResult {
  // keep n·p <= d with n = -z: -pz <= -z  <=>  pz >= z
  const plane: Plane = { nx: 0, ny: 0, nz: -1, d: -z };
  const out = new SoupBuilder(Math.max(1024, mesh.triCount));
  const res = clipTriangles(mesh, [plane], { out });
  const warnings: string[] = [];
  const basis = planeBasis(plane);
  const { loops, warnings: w } = chainLoops(res.segments[0], basis);
  warnings.push(...w.map((s) => 'trim: ' + s));
  const capTriangles = capLoops(loops, plane, out, warnings);
  return {
    soup: out.build(),
    warnings,
    capTriangles,
    loops: loops.length,
  };
}
