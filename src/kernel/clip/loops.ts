/**
 * Chain cut segments (from clipper.ts) into closed loops on a plane, orient them
 * (outer loops CCW when viewed from the plane's outward normal, holes CW) and
 * project them into a 2D basis on the plane.
 *
 * Segments are first reduced by parity: an on-plane edge reported by two kept
 * triangles is interior to the solid (e.g. a face coplanar with the plane next
 * to a side face) and cancels; edges reported an odd number of times are real
 * boundary segments of the cap.
 */
import type { Plane, Vec3 } from '../types';
import type { CutSegment } from './clipper';

export interface PlaneBasis {
  ux: number; uy: number; uz: number;
  vx: number; vy: number; vz: number;
  ox: number; oy: number; oz: number;
}

export interface LoopResult {
  points: Vec3[];
  keys: string[];
  /** flat [u0,v0,u1,v1,...] coordinates in the plane basis */
  uv: number[];
  /** signed area in the uv basis after orientation (positive = outer, negative = hole) */
  area: number;
  /** true if the loop had to be force-closed */
  forced: boolean;
}

export interface ChainOptions {
  /** max gap to bridge between open chain ends, mm */
  joinTol?: number;
  /** loops with |area| below this are dropped (degenerate collinear chains), mm^2 */
  minArea?: number;
  /**
   * Planes adjacent to this one in a closed prism. Open chain ends lying on one
   * of these planes sit on the corner line and are paired up along it (sorted by
   * position along the line, consecutive pairs) to close the cap.
   */
  adjacentPlanes?: Plane[];
  eps?: number;
}

/** Right-handed basis (u, v, n) on the plane: a CCW loop in (u,v) has normal +n. */
export function planeBasis(plane: Plane): PlaneBasis {
  const nx = plane.nx, ny = plane.ny, nz = plane.nz;
  let ux: number, uy: number, uz: number;
  if (Math.abs(nz) < 0.9) { ux = -ny; uy = nx; uz = 0; }
  else { ux = 1; uy = 0; uz = 0; }
  const dot = ux * nx + uy * ny + uz * nz;
  ux -= dot * nx; uy -= dot * ny; uz -= dot * nz;
  const m = Math.hypot(ux, uy, uz) || 1;
  ux /= m; uy /= m; uz /= m;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  return { ux, uy, uz, vx, vy, vz, ox: nx * plane.d, oy: ny * plane.d, oz: nz * plane.d };
}

export function toUV(b: PlaneBasis, x: number, y: number, z: number): [number, number] {
  const dx = x - b.ox, dy = y - b.oy, dz = z - b.oz;
  return [dx * b.ux + dy * b.uy + dz * b.uz, dx * b.vx + dy * b.vy + dz * b.vz];
}

interface Chain {
  keys: string[];
  pts: Vec3[];
  vote: number;
  closed: boolean;
  forced: boolean;
}

export function chainLoops(
  segmentsIn: CutSegment[],
  basis: PlaneBasis,
  opts: ChainOptions = {},
): { loops: LoopResult[]; warnings: string[] } {
  const joinTol = opts.joinTol ?? 0.5;
  const minArea = opts.minArea ?? 1e-10;
  const eps = opts.eps ?? 1e-6;
  const warnings: string[] = [];

  // 1. parity reduction by unordered key pair
  const counts = new Map<string, { seg: CutSegment; n: number }>();
  for (const s of segmentsIn) {
    if (s.aKey === s.bKey) continue;
    const pair = s.aKey < s.bKey ? s.aKey + '|' + s.bKey : s.bKey + '|' + s.aKey;
    const e = counts.get(pair);
    if (e) e.n++;
    else counts.set(pair, { seg: s, n: 1 });
  }
  const segs: CutSegment[] = [];
  for (const e of counts.values()) if (e.n % 2 === 1) segs.push(e.seg);
  const n = segs.length;
  if (n === 0) return { loops: [], warnings };

  // 2. adjacency
  const adj = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    let la = adj.get(s.aKey); if (!la) { la = []; adj.set(s.aKey, la); } la.push(i);
    let lb = adj.get(s.bKey); if (!lb) { lb = []; adj.set(s.bKey, lb); } lb.push(i);
  }

  // 3. walk
  const used = new Uint8Array(n);
  const chains: Chain[] = [];
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const seg = segs[s];
    const chain: Chain = {
      keys: [seg.aKey, seg.bKey],
      pts: [[seg.ax, seg.ay, seg.az], [seg.bx, seg.by, seg.bz]],
      vote: seg.prefer,
      closed: false,
      forced: false,
    };
    let cur = seg.bKey;
    let prevPt = chain.pts[0];
    let curPt = chain.pts[1];
    for (;;) {
      if (cur === chain.keys[0]) {
        chain.keys.pop(); chain.pts.pop();
        chain.closed = true;
        break;
      }
      const cands = adj.get(cur);
      let best = -1, bestTurn = -Infinity;
      if (cands) {
        const [iu, iv] = dir2(basis, prevPt, curPt);
        for (const c of cands) {
          if (used[c]) continue;
          const sc = segs[c];
          const other: Vec3 = sc.aKey === cur ? [sc.bx, sc.by, sc.bz] : [sc.ax, sc.ay, sc.az];
          const [ou, ov] = dir2(basis, curPt, other);
          const turn = Math.atan2(iu * ov - iv * ou, iu * ou + iv * ov); // sharpest left turn wins
          if (turn > bestTurn) { bestTurn = turn; best = c; }
        }
      }
      if (best < 0) break;
      used[best] = 1;
      const sb = segs[best];
      const forward = sb.aKey === cur;
      const nextKey = forward ? sb.bKey : sb.aKey;
      const nextPt: Vec3 = forward ? [sb.bx, sb.by, sb.bz] : [sb.ax, sb.ay, sb.az];
      chain.vote += forward ? sb.prefer : -sb.prefer;
      chain.keys.push(nextKey);
      chain.pts.push(nextPt);
      prevPt = curPt; curPt = nextPt; cur = nextKey;
    }
    chains.push(chain);
  }

  // 4a. close across corner lines of adjacent planes
  const openChains = () => chains.filter((c) => !c.closed);
  if (opts.adjacentPlanes && openChains().length > 0) {
    for (const ap of opts.adjacentPlanes) {
      const onPlane = (p: Vec3) => Math.abs(ap.nx * p[0] + ap.ny * p[1] + ap.nz * p[2] - ap.d) <= Math.max(eps, 1e-5);
      // direction along the corner line = n_this x n_adjacent; sort by projection on it
      const ends: { pos: Vec3; t: number }[] = [];
      const axis = cornerAxis(basis, ap);
      for (const c of openChains()) {
        const h = c.pts[0], t = c.pts[c.pts.length - 1];
        if (onPlane(h)) ends.push({ pos: h, t: h[0] * axis[0] + h[1] * axis[1] + h[2] * axis[2] });
        if (onPlane(t)) ends.push({ pos: t, t: t[0] * axis[0] + t[1] * axis[1] + t[2] * axis[2] });
      }
      if (ends.length === 0) continue;
      ends.sort((a, b) => a.t - b.t);
      if (ends.length % 2 === 1) warnings.push(`corner line: odd number of open ends (${ends.length})`);
      for (let i = 0; i + 1 < ends.length; i += 2) {
        const A = findEnd(chains, ends[i].pos), B = findEnd(chains, ends[i + 1].pos);
        if (!A || !B) continue;
        if (A.chain === B.chain) { closeChain(A.chain); continue; }
        connect(chains, A.chain, A.end, B.chain, B.end);
      }
    }
  }

  // 4b. join remaining open chains greedily by nearest end-to-end distance.
  // The greedy search is quadratic per step; with a pathological number of fragments
  // (a plane grazing a wall) just close each chain on its own instead of stalling.
  const MAX_JOIN_CHAINS = 400;
  if (openChains().length > MAX_JOIN_CHAINS) {
    warnings.push(`cap: ${openChains().length} open fragments; closed individually`);
    for (const c of openChains()) { if (c.pts.length >= 3) { closeChain(c); c.forced = true; } else c.closed = true; }
  }
  for (;;) {
    const open = openChains();
    if (open.length === 0) break;
    let bestD = Infinity;
    let bA: { chain: Chain; end: 'head' | 'tail' } | null = null;
    let bB: { chain: Chain; end: 'head' | 'tail' } | null = null;
    for (const a of open) {
      for (const endA of ['head', 'tail'] as const) {
        const pa = endA === 'head' ? a.pts[0] : a.pts[a.pts.length - 1];
        for (const b of open) {
          for (const endB of ['head', 'tail'] as const) {
            if (a === b && (endA === endB || a.pts.length < 3)) continue;
            const pb = endB === 'head' ? b.pts[0] : b.pts[b.pts.length - 1];
            const d = dist3(pa, pb);
            if (d < bestD) { bestD = d; bA = { chain: a, end: endA }; bB = { chain: b, end: endB }; }
          }
        }
      }
    }
    if (!bA || !bB || bestD > joinTol) break;
    if (bA.chain === bB.chain) {
      closeChain(bA.chain);
      if (bestD > 1e-9) bA.chain.forced = true;
    } else {
      if (bestD > 1e-9) bA.chain.forced = true;
      connect(chains, bA.chain, bA.end, bB.chain, bB.end);
    }
  }
  for (const c of openChains()) {
    if (c.pts.length >= 3) { closeChain(c); c.forced = true; }
  }

  // 5. orient, project, filter
  const loops: LoopResult[] = [];
  for (const c of chains) {
    if (!c.closed || c.pts.length < 3) continue;
    let pts = c.pts, keys = c.keys;
    if (c.vote < 0) { pts = pts.slice().reverse(); keys = keys.slice().reverse(); }
    let uv = projectAll(basis, pts);
    let area = signedArea(uv);
    if (c.vote === 0 && area < 0) {
      pts = pts.slice().reverse(); keys = keys.slice().reverse();
      uv = projectAll(basis, pts); area = -area;
    }
    if (Math.abs(area) < minArea) continue;
    if (c.forced) {
      const gap = dist3(c.pts[0], c.pts[c.pts.length - 1]);
      if (gap > 1e-6) warnings.push(`cap loop force-closed across a ${gap.toFixed(3)}mm gap`);
    }
    loops.push({ points: pts, keys, uv, area, forced: c.forced });
  }
  return { loops, warnings };
}

function cornerAxis(basis: PlaneBasis, ap: Plane): Vec3 {
  // this plane's normal n = u x v
  const nx = basis.uy * basis.vz - basis.uz * basis.vy;
  const ny = basis.uz * basis.vx - basis.ux * basis.vz;
  const nz = basis.ux * basis.vy - basis.uy * basis.vx;
  const ax = ny * ap.nz - nz * ap.ny, ay = nz * ap.nx - nx * ap.nz, az = nx * ap.ny - ny * ap.nx;
  const m = Math.hypot(ax, ay, az) || 1;
  return [ax / m, ay / m, az / m];
}

function findEnd(chains: Chain[], pos: Vec3): { chain: Chain; end: 'head' | 'tail' } | null {
  for (const c of chains) {
    if (c.closed) continue;
    if (same(c.pts[0], pos)) return { chain: c, end: 'head' };
    if (same(c.pts[c.pts.length - 1], pos)) return { chain: c, end: 'tail' };
  }
  return null;
}

function same(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Append chain B to chain A so that endA meets endB; B is removed from the list. */
function connect(chains: Chain[], A: Chain, endA: 'head' | 'tail', B: Chain, endB: 'head' | 'tail'): void {
  if (endA === 'head') reverse(A);
  if (endB === 'tail') reverse(B);
  const tail = A.pts[A.pts.length - 1], head = B.pts[0];
  const skip = same(tail, head) ? 1 : 0;
  for (let i = skip; i < B.pts.length; i++) { A.pts.push(B.pts[i]); A.keys.push(B.keys[i]); }
  A.vote += B.vote;
  A.forced = A.forced || B.forced;
  const idx = chains.indexOf(B);
  if (idx >= 0) chains.splice(idx, 1);
}

/** Mark a chain closed, dropping a duplicated seam point if head and tail coincide. */
function closeChain(c: Chain): void {
  while (c.pts.length > 1 && same(c.pts[0], c.pts[c.pts.length - 1])) { c.pts.pop(); c.keys.pop(); }
  c.closed = true;
}

function reverse(c: Chain): void {
  c.pts.reverse();
  c.keys.reverse();
  c.vote = -c.vote;
}

function dir2(b: PlaneBasis, from: Vec3, to: Vec3): [number, number] {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return [dx * b.ux + dy * b.uy + dz * b.uz, dx * b.vx + dy * b.vy + dz * b.vz];
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function projectAll(b: PlaneBasis, pts: Vec3[]): number[] {
  const uv: number[] = new Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const p = toUV(b, pts[i][0], pts[i][1], pts[i][2]);
    uv[i * 2] = p[0]; uv[i * 2 + 1] = p[1];
  }
  return uv;
}

export function signedArea(uv: number[]): number {
  let a = 0;
  const n = uv.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += uv[i * 2] * uv[j * 2 + 1] - uv[j * 2] * uv[i * 2 + 1];
  }
  return a / 2;
}
