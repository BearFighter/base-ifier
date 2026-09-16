/**
 * Heightfield → closed sculpt slab. The slab's top is the terrain surface, its
 * sides drop to `zBase` (the plate top minus the usual 0.1 mm overlap) and it
 * is capped underneath, so it is a single closed shell like the sculpt shells
 * of the OPR files: the existing prism cutter, bins and exporter treat it like
 * any other sculpt. Non-rectangular boards clip the rectangular slab with the
 * same `cutPrism` the cutter uses.
 */
import type { IndexedMesh, Polygon2, Soup } from '../types';
import { SoupBuilder } from '../types';
import { weld } from '../mesh/weld';
import { buildBins } from '../sculpt/bins';
import { cutPrism } from '../sculpt/cutPrism';
import type { Heightfield } from './heightfield';
import { sampleX, sampleY } from './heightfield';

export interface SlabOptions {
  /** bottom of the slab, mm; use plateTop - 0.1 so it overlaps the plate */
  zBase: number;
  /** clip the rectangular slab to this footprint (CCW, convex); omit for rectangular boards */
  clipTo?: Polygon2;
}

/** Triangulate the field: top surface, four skirt walls, bottom cap. CCW outward. */
export function heightfieldToSlab(hf: Heightfield, opts: SlabOptions): Soup {
  const { nx, ny, z } = hf;
  const zb = opts.zBase;
  const out = new SoupBuilder((nx - 1) * (ny - 1) * 2 + (nx + ny) * 4 + 2);
  const X = (i: number) => sampleX(hf, i);
  const Y = (j: number) => sampleY(hf, j);
  // guard: the surface must stay above the base
  const top = (i: number, j: number) => Math.max(z[j * nx + i], zb + 1e-3);

  // top surface, seen from above CCW: alternate the diagonal to avoid a directional bias
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const x0 = X(i), x1 = X(i + 1), y0 = Y(j), y1 = Y(j + 1);
      const z00 = top(i, j), z10 = top(i + 1, j), z01 = top(i, j + 1), z11 = top(i + 1, j + 1);
      if ((i + j) & 1) {
        out.tri(x0, y0, z00, x1, y0, z10, x1, y1, z11);
        out.tri(x0, y0, z00, x1, y1, z11, x0, y1, z01);
      } else {
        out.tri(x0, y0, z00, x1, y0, z10, x0, y1, z01);
        out.tri(x1, y0, z10, x1, y1, z11, x0, y1, z01);
      }
    }
  }
  // skirts (outward normals): front y = -d/2 faces -y, back faces +y, left faces -x, right faces +x
  for (let i = 0; i < nx - 1; i++) {
    const x0 = X(i), x1 = X(i + 1);
    const yf = Y(0), yb = Y(ny - 1);
    // front: normal -y, CCW seen from -y
    out.tri(x0, yf, zb, x1, yf, top(i + 1, 0), x0, yf, top(i, 0));
    out.tri(x0, yf, zb, x1, yf, zb, x1, yf, top(i + 1, 0));
    // back: normal +y
    out.tri(x0, yb, zb, x0, yb, top(i, ny - 1), x1, yb, top(i + 1, ny - 1));
    out.tri(x0, yb, zb, x1, yb, top(i + 1, ny - 1), x1, yb, zb);
  }
  for (let j = 0; j < ny - 1; j++) {
    const y0 = Y(j), y1 = Y(j + 1);
    const xl = X(0), xr = X(nx - 1);
    // left: normal -x
    out.tri(xl, y0, zb, xl, y0, top(0, j), xl, y1, top(0, j + 1));
    out.tri(xl, y0, zb, xl, y1, top(0, j + 1), xl, y1, zb);
    // right: normal +x
    out.tri(xr, y0, zb, xr, y1, top(nx - 1, j + 1), xr, y0, top(nx - 1, j));
    out.tri(xr, y0, zb, xr, y1, zb, xr, y1, top(nx - 1, j + 1));
  }
  // bottom cap, faces -z: a fan over the perimeter samples so its edges match the skirts' bottom edges exactly
  const cx = 0, cy = 0;
  const perim: [number, number][] = [];
  for (let i = 0; i < nx - 1; i++) perim.push([X(i), Y(0)]);
  for (let j = 0; j < ny - 1; j++) perim.push([X(nx - 1), Y(j)]);
  for (let i = nx - 1; i > 0; i--) perim.push([X(i), Y(ny - 1)]);
  for (let j = ny - 1; j > 0; j--) perim.push([X(0), Y(j)]);
  for (let k = 0; k < perim.length; k++) {
    const a = perim[k], b = perim[(k + 1) % perim.length];
    // perimeter runs CCW seen from above; facing -z needs the reverse winding
    out.tri(cx, cy, zb, b[0], b[1], zb, a[0], a[1], zb);
  }

  const slab = out.buildCopy();
  if (!opts.clipTo) return slab;
  // clip to the board footprint with the cutter's own prism: caps the cut faces
  const mesh: IndexedMesh = weld(slab);
  const bins = buildBins(mesh, 2);
  return cutPrism(mesh, bins, opts.clipTo).soup;
}

/** Suggested sample spacing for a board: fine for bases, coarser for display boards. */
export function suggestedCell(w: number, d: number): number {
  const m = Math.max(w, d);
  if (m <= 60) return 0.2;
  if (m <= 200) return 0.25;
  if (m <= 400) return 0.4;
  return 0.5;
}
