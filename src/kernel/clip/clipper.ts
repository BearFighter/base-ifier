/**
 * Clip triangles of an indexed mesh by a set of half-spaces (planes), keeping the
 * side n·p <= d for every plane. Produces the kept geometry as a soup plus the
 * cut segments lying on each plane, keyed by mesh topology so that segments from
 * neighbouring triangles share bit-identical endpoints and keys (no snapping).
 *
 * Keys:
 *  - "V<i>"            mesh vertex i lying on the plane
 *  - "E<u>:<v>@<k>"    intersection of mesh edge (u<v) with plane k
 *  - "C<i>:<j>@<t>"    intersection of the polygon edge lying on plane i with plane j
 *                      inside triangle t (a point on the corner line of planes i and j)
 */
import type { IndexedMesh, Plane } from '../types';
import { SoupBuilder } from '../types';

export interface CutSegment {
  aKey: string;
  bKey: string;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  /** +1: a->b is the preferred direction (material on the left, seen from the plane's outward normal), -1: b->a, 0: unknown */
  prefer: -1 | 0 | 1;
}

export interface ClipOptions {
  eps?: number;
  /** Reuse an output builder (e.g. to accumulate several batches). */
  out?: SoupBuilder;
  /** Triangle ids to process; null/undefined = all triangles. */
  triIds?: Uint32Array | null;
  /** Skip triangles already stamped with `id`; stamps processed triangles. */
  stamp?: { arr: Uint32Array; id: number };
}

export interface ClipResult {
  /** builder holding the kept geometry; callers may append caps before calling build() */
  out: SoupBuilder;
  /** cut segments per plane index */
  segments: CutSegment[][];
  keptTriangles: number;
  clippedTriangles: number;
  droppedTriangles: number;
}

interface PolyVert {
  x: number; y: number; z: number;
  key: string;
  /** signed distance to each plane */
  dist: Float64Array;
  /** carrier of the edge that STARTS at this vertex: 'E<u>:<v>' or 'P<k>' */
  carrier: string;
}

const CH_E = 'E'.charCodeAt(0);

export function clipTriangles(mesh: IndexedMesh, planes: Plane[], opts: ClipOptions = {}): ClipResult {
  const eps = opts.eps ?? 1e-6;
  const out = opts.out ?? new SoupBuilder(1024);
  const nP = planes.length;
  const V = mesh.vertices;
  const I = mesh.indices;
  const segments: CutSegment[][] = [];
  for (let k = 0; k < nP; k++) segments.push([]);

  const pn = new Float64Array(nP * 4);
  for (let k = 0; k < nP; k++) {
    pn[k * 4] = planes[k].nx; pn[k * 4 + 1] = planes[k].ny; pn[k * 4 + 2] = planes[k].nz; pn[k * 4 + 3] = planes[k].d;
  }
  const distOf = (x: number, y: number, z: number, k: number): number =>
    pn[k * 4] * x + pn[k * 4 + 1] * y + pn[k * 4 + 2] * z - pn[k * 4 + 3];

  let keptTriangles = 0, clippedTriangles = 0, droppedTriangles = 0;
  const triIds = opts.triIds ?? null;
  const count = triIds ? triIds.length : mesh.triCount;
  const stamp = opts.stamp;

  const d0 = new Float64Array(nP), d1 = new Float64Array(nP), d2 = new Float64Array(nP);

  const edgeCarrier = (u: number, v: number): string => (u < v ? 'E' + u + ':' + v : 'E' + v + ':' + u);

  const pushSeg = (
    list: CutSegment[], aKey: string, bKey: string,
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    k: number, nx: number, ny: number, nz: number,
  ): void => {
    if (aKey === bKey) return;
    const tx = bx - ax, ty = by - ay, tz = bz - az;
    const pnx = pn[k * 4], pny = pn[k * 4 + 1], pnz = pn[k * 4 + 2];
    // L = n x t is the "left" direction when viewed from the plane's outward normal
    const lx = pny * tz - pnz * ty, ly = pnz * tx - pnx * tz, lz = pnx * ty - pny * tx;
    const dot = lx * nx + ly * ny + lz * nz;
    const mag = Math.hypot(lx, ly, lz) * Math.hypot(nx, ny, nz);
    let prefer: -1 | 0 | 1 = 0;
    // the solid is on the -N side of the triangle: we want L pointing into the solid, i.e. dot(L, N) < 0
    if (mag > 0 && Math.abs(dot) > 1e-9 * mag) prefer = dot < 0 ? 1 : -1;
    list.push({ aKey, bKey, ax, ay, az, bx, by, bz, prefer });
  };

  const crossing = (a: PolyVert, b: PolyVert, k: number, t: number): PolyVert => {
    const carrier = a.carrier;
    let x: number, y: number, z: number, key: string;
    if (carrier.charCodeAt(0) === CH_E) {
      // canonical computation from the original mesh vertices u < v (bit-identical across neighbours)
      const colon = carrier.indexOf(':');
      const u = parseInt(carrier.substring(1, colon), 10);
      const v = parseInt(carrier.substring(colon + 1), 10);
      const ux = V[u * 3], uy = V[u * 3 + 1], uz = V[u * 3 + 2];
      const vx = V[v * 3], vy = V[v * 3 + 1], vz = V[v * 3 + 2];
      const du = distOf(ux, uy, uz, k), dv = distOf(vx, vy, vz, k);
      let s = du / (du - dv);
      if (!(s >= 0 && s <= 1)) s = Math.min(1, Math.max(0, s));
      x = ux + (vx - ux) * s; y = uy + (vy - uy) * s; z = uz + (vz - uz) * s;
      key = carrier + '@' + k;
    } else {
      const i = carrier.substring(1);
      const da = a.dist[k], db = b.dist[k];
      const s = da / (da - db);
      x = a.x + (b.x - a.x) * s; y = a.y + (b.y - a.y) * s; z = a.z + (b.z - a.z) * s;
      key = 'C' + i + ':' + k + '@' + t;
    }
    const dist = new Float64Array(nP);
    for (let m = 0; m < nP; m++) dist[m] = m === k ? 0 : distOf(x, y, z, m);
    return { x, y, z, key, dist, carrier: '' };
  };

  const clipPolyByPlane = (poly: PolyVert[], k: number, t: number): PolyVert[] => {
    const n = poly.length;
    const outP: PolyVert[] = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const da = a.dist[k], db = b.dist[k];
      const inA = da <= eps, inB = db <= eps;
      const strictCross = (da > eps && db < -eps) || (da < -eps && db > eps);
      if (inA) {
        let carrier = a.carrier;
        if (!inB && !strictCross) carrier = 'P' + k; // a on the plane, b outside: boundary continues along plane k
        outP.push({ x: a.x, y: a.y, z: a.z, key: a.key, dist: a.dist, carrier });
      }
      if (strictCross) {
        const X = crossing(a, b, k, t);
        X.carrier = inA ? 'P' + k : a.carrier; // exiting: along the plane; entering: continue along original carrier
        outP.push(X);
      }
    }
    return outP;
  };

  for (let c = 0; c < count; c++) {
    const t = triIds ? triIds[c] : c;
    if (stamp) {
      if (stamp.arr[t] === stamp.id) continue;
      stamp.arr[t] = stamp.id;
    }
    const i0 = I[t * 3], i1 = I[t * 3 + 1], i2 = I[t * 3 + 2];
    const x0 = V[i0 * 3], y0 = V[i0 * 3 + 1], z0 = V[i0 * 3 + 2];
    const x1 = V[i1 * 3], y1 = V[i1 * 3 + 1], z1 = V[i1 * 3 + 2];
    const x2 = V[i2 * 3], y2 = V[i2 * 3 + 1], z2 = V[i2 * 3 + 2];

    let allInside = true;
    let outsideSomePlane = false;
    let anyOnPlane = false;
    for (let k = 0; k < nP; k++) {
      const a = distOf(x0, y0, z0, k), b = distOf(x1, y1, z1, k), cc = distOf(x2, y2, z2, k);
      d0[k] = a; d1[k] = b; d2[k] = cc;
      if (a > eps && b > eps && cc > eps) { outsideSomePlane = true; break; }
      if (a > eps || b > eps || cc > eps) allInside = false;
      if (Math.abs(a) <= eps || Math.abs(b) <= eps || Math.abs(cc) <= eps) anyOnPlane = true;
    }
    if (outsideSomePlane) { droppedTriangles++; continue; }

    const ex1 = x1 - x0, ey1 = y1 - y0, ez1 = z1 - z0;
    const ex2 = x2 - x0, ey2 = y2 - y0, ez2 = z2 - z0;
    const nx = ey1 * ez2 - ez1 * ey2, ny = ez1 * ex2 - ex1 * ez2, nz = ex1 * ey2 - ey1 * ex2;

    if (allInside) {
      if (anyOnPlane) {
        // A triangle coplanar with a plane is a face of the kept solid only if it faces
        // the plane's outward side; otherwise its solid lies on the removed side.
        let drop = false;
        for (let k = 0; k < nP; k++) {
          if (Math.abs(d0[k]) <= eps && Math.abs(d1[k]) <= eps && Math.abs(d2[k]) <= eps) {
            if (nx * pn[k * 4] + ny * pn[k * 4 + 1] + nz * pn[k * 4 + 2] < 0) { drop = true; break; }
          }
        }
        if (drop) { droppedTriangles++; continue; }
      }
      out.tri(x0, y0, z0, x1, y1, z1, x2, y2, z2);
      keptTriangles++;
      if (anyOnPlane) {
        // On-plane edges are reported by every kept triangle that has them (including
        // coplanar faces); parity reduction in chainLoops cancels interior ones.
        for (let k = 0; k < nP; k++) {
          const a = Math.abs(d0[k]) <= eps, b = Math.abs(d1[k]) <= eps, cc = Math.abs(d2[k]) <= eps;
          if (a && b) pushSeg(segments[k], 'V' + i0, 'V' + i1, x0, y0, z0, x1, y1, z1, k, nx, ny, nz);
          if (b && cc) pushSeg(segments[k], 'V' + i1, 'V' + i2, x1, y1, z1, x2, y2, z2, k, nx, ny, nz);
          if (cc && a) pushSeg(segments[k], 'V' + i2, 'V' + i0, x2, y2, z2, x0, y0, z0, k, nx, ny, nz);
        }
      }
      continue;
    }

    let poly: PolyVert[] = [
      { x: x0, y: y0, z: z0, key: 'V' + i0, dist: d0.slice(), carrier: edgeCarrier(i0, i1) },
      { x: x1, y: y1, z: z1, key: 'V' + i1, dist: d1.slice(), carrier: edgeCarrier(i1, i2) },
      { x: x2, y: y2, z: z2, key: 'V' + i2, dist: d2.slice(), carrier: edgeCarrier(i2, i0) },
    ];
    for (let k = 0; k < nP && poly.length >= 3; k++) {
      let needs = false;
      for (const v of poly) if (v.dist[k] > eps) { needs = true; break; }
      if (!needs) continue;
      poly = clipPolyByPlane(poly, k, t);
    }
    if (poly.length < 3) { droppedTriangles++; continue; }
    const n = poly.length;
    // A clipped polygon coplanar with a plane is kept only if it faces that plane's outward side.
    let dropCoplanar = false;
    for (let k = 0; k < nP && !dropCoplanar; k++) {
      let onCount = 0;
      for (let m = 0; m < n; m++) if (Math.abs(poly[m].dist[k]) <= eps) onCount++;
      if (onCount === n && nx * pn[k * 4] + ny * pn[k * 4 + 1] + nz * pn[k * 4 + 2] < 0) dropCoplanar = true;
    }
    if (dropCoplanar) { droppedTriangles++; continue; }
    for (let m = 1; m + 1 < n; m++) {
      out.tri(poly[0].x, poly[0].y, poly[0].z, poly[m].x, poly[m].y, poly[m].z, poly[m + 1].x, poly[m + 1].y, poly[m + 1].z);
    }
    clippedTriangles++;
    for (let k = 0; k < nP; k++) {
      let onCount = 0;
      for (let m = 0; m < n; m++) if (Math.abs(poly[m].dist[k]) <= eps) onCount++;
      if (onCount < 2) continue;
      for (let m = 0; m < n; m++) {
        const a = poly[m], b = poly[(m + 1) % n];
        if (Math.abs(a.dist[k]) <= eps && Math.abs(b.dist[k]) <= eps) {
          pushSeg(segments[k], a.key, b.key, a.x, a.y, a.z, b.x, b.y, b.z, k, nx, ny, nz);
        }
      }
    }
  }

  return { out, segments, keptTriangles, clippedTriangles, droppedTriangles };
}

/** Build a plane from a normal (normalised inside) and a point on it. Kept side is n·p <= d. */
export function planeFromNormalPoint(nx: number, ny: number, nz: number, px: number, py: number, pz: number): Plane {
  const m = Math.hypot(nx, ny, nz) || 1;
  nx /= m; ny /= m; nz /= m;
  return { nx, ny, nz, d: nx * px + ny * py + nz * pz };
}

/** Vertical planes for a CCW convex polygon; outward normals; kept side = inside the polygon. */
export function verticalPlanesForPolygon(poly: ArrayLike<[number, number]>): Plane[] {
  const n = poly.length;
  const planes: Plane[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    // outward normal of a CCW polygon edge is (ty, -tx)
    planes.push(planeFromNormalPoint(ty, -tx, 0, a[0], a[1], 0));
  }
  return planes;
}
