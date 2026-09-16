/**
 * Heightfield terrain for Base Studio: a regular grid of heights (mm, Z up)
 * over a rectangle centred on the origin. Everything here is pure TypeScript
 * on a Float32Array so it runs in the worker; generation is deterministic for
 * a given seed. Heights are absolute z: the studio keeps them between the
 * plate top and the genre's height cap, and `mesh.ts` turns the field into a
 * closed sculpt slab.
 */
import type { Polygon2, Vec2, Vec3 } from '../types';
import { minEdgeDistance, pointInConvexPolygon } from '../geom2d/polygon';

export interface Heightfield {
  /** extent along x and y, mm (samples run from -w/2 to +w/2) */
  w: number;
  d: number;
  /** sample spacing, mm */
  cell: number;
  /** samples along x and y (nx = round(w / cell) + 1) */
  nx: number;
  ny: number;
  /** heights, row-major: z[j * nx + i] at x = -w/2 + i*cell, y = -d/2 + j*cell */
  z: Float32Array;
}

/** A normalised height map (0..1) used as a stamp; `size` is its side in mm when applied at scale 1. */
export interface StampMap {
  nx: number;
  ny: number;
  size: number;
  h: Float32Array;
}

export function createHeightfield(w: number, d: number, cell: number, base = 0): Heightfield {
  const nx = Math.max(2, Math.round(w / cell) + 1);
  const ny = Math.max(2, Math.round(d / cell) + 1);
  const z = new Float32Array(nx * ny);
  if (base !== 0) z.fill(base);
  return { w, d, cell, nx, ny, z };
}

export function cloneHeightfield(hf: Heightfield): Heightfield {
  return { ...hf, z: hf.z.slice() };
}

export function sampleX(hf: Heightfield, i: number): number {
  return -hf.w / 2 + i * hf.cell;
}
export function sampleY(hf: Heightfield, j: number): number {
  return -hf.d / 2 + j * hf.cell;
}

/** Bilinear height at (x, y); clamps to the field's edge outside it. */
export function sampleHeight(hf: Heightfield, x: number, y: number): number {
  const fx = Math.min(hf.nx - 1, Math.max(0, (x + hf.w / 2) / hf.cell));
  const fy = Math.min(hf.ny - 1, Math.max(0, (y + hf.d / 2) / hf.cell));
  const i0 = Math.min(hf.nx - 2, Math.floor(fx)), j0 = Math.min(hf.ny - 2, Math.floor(fy));
  const tx = fx - i0, ty = fy - j0;
  const z = hf.z, nx = hf.nx;
  const a = z[j0 * nx + i0], b = z[j0 * nx + i0 + 1], c = z[(j0 + 1) * nx + i0], e = z[(j0 + 1) * nx + i0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}

/** Unit surface normal at (x, y) from central differences (Z up). */
export function sampleNormal(hf: Heightfield, x: number, y: number): Vec3 {
  const h = hf.cell;
  const dzdx = (sampleHeight(hf, x + h, y) - sampleHeight(hf, x - h, y)) / (2 * h);
  const dzdy = (sampleHeight(hf, x, y + h) - sampleHeight(hf, x, y - h)) / (2 * h);
  const len = Math.hypot(dzdx, dzdy, 1);
  return [-dzdx / len, -dzdy / len, 1 / len];
}

export function heightRange(hf: Heightfield): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < hf.z.length; k++) {
    const v = hf.z[k];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/* ------------------------------------------------------------------------ */
/* Deterministic randomness                                                  */
/* ------------------------------------------------------------------------ */

/** mulberry32: small, fast, seedable; good enough for terrain and scatter. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D simplex noise (Gustavson), permutation shuffled from the seed. Returns -1..1. */
export function simplex2(seed: number): (x: number, y: number) => number {
  const r = rng(seed);
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return (xin, yin) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    const corner = (x: number, y: number, gi: number) => {
      let tt = 0.5 - x * x - y * y;
      if (tt < 0) return 0;
      tt *= tt;
      const g = grad[gi % 8];
      return tt * tt * (g[0] * x + g[1] * y);
    };
    n += corner(x0, y0, p[ii + p[jj]]);
    n += corner(x1, y1, p[ii + i1 + p[jj + j1]]);
    n += corner(x2, y2, p[ii + 1 + p[jj + 1]]);
    return 70 * n;
  };
}

export interface NoiseParams {
  seed: number;
  /** peak-to-peak amplitude, mm */
  amplitude: number;
  /** feature size of the first octave, mm */
  scale: number;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  /** 0 = plain fbm; 1 = ridged (creases), useful for rock and ash */
  ridged?: number;
}

/** Fractal noise added to every sample. */
export function addNoise(hf: Heightfield, params: NoiseParams): void {
  const oct = Math.max(1, Math.round(params.octaves ?? 4));
  const pers = params.persistence ?? 0.5, lac = params.lacunarity ?? 2;
  const ridged = params.ridged ?? 0;
  const noises: ((x: number, y: number) => number)[] = [];
  for (let o = 0; o < oct; o++) noises.push(simplex2(params.seed * 7919 + o * 104729));
  let norm = 0, a = 1;
  for (let o = 0; o < oct; o++) { norm += a; a *= pers; }
  const amp = params.amplitude / 2;
  for (let j = 0; j < hf.ny; j++) {
    const y = sampleY(hf, j);
    for (let i = 0; i < hf.nx; i++) {
      const x = sampleX(hf, i);
      let v = 0, f = 1 / Math.max(0.01, params.scale), aa = 1;
      for (let o = 0; o < oct; o++) {
        let n = noises[o](x * f, y * f);
        if (ridged > 0) n = n * (1 - ridged) + (1 - Math.abs(n) * 2) * ridged;
        v += n * aa;
        aa *= pers;
        f *= lac;
      }
      hf.z[j * hf.nx + i] += (v / norm) * amp;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Stamps and brushes                                                        */
/* ------------------------------------------------------------------------ */

export interface StampPlacement {
  x: number;
  y: number;
  /** stamp side length on the terrain, mm (scales the map) */
  size: number;
  /** height of a full-white pixel, mm; negative carves */
  strength: number;
  rotDeg?: number;
  /** 0..1 fraction of the radius over which the stamp fades out */
  falloff?: number;
  /** add (default), max (raise to at least), min (carve to at most) */
  mode?: 'add' | 'max' | 'min';
}

function sampleStamp(st: StampMap, u: number, v: number): number {
  // u, v in 0..1
  const fx = Math.min(st.nx - 1, Math.max(0, u * (st.nx - 1)));
  const fy = Math.min(st.ny - 1, Math.max(0, v * (st.ny - 1)));
  const i0 = Math.min(st.nx - 2, Math.floor(fx)), j0 = Math.min(st.ny - 2, Math.floor(fy));
  const tx = fx - i0, ty = fy - j0;
  const h = st.h, nx = st.nx;
  const a = h[j0 * nx + i0], b = h[j0 * nx + i0 + 1], c = h[(j0 + 1) * nx + i0], e = h[(j0 + 1) * nx + i0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}

/** Press a stamp into the field. */
export function applyStamp(hf: Heightfield, st: StampMap, place: StampPlacement): void {
  const half = place.size / 2;
  const rot = ((place.rotDeg ?? 0) * Math.PI) / 180;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const fall = Math.min(0.95, Math.max(0, place.falloff ?? 0.25));
  const mode = place.mode ?? 'add';
  // 'max'/'min' work relative to the ground level under the stamp's centre
  const zc = sampleHeight(hf, place.x, place.y);
  const i0 = Math.max(0, Math.floor((place.x - half * 1.5 + hf.w / 2) / hf.cell));
  const i1 = Math.min(hf.nx - 1, Math.ceil((place.x + half * 1.5 + hf.w / 2) / hf.cell));
  const j0 = Math.max(0, Math.floor((place.y - half * 1.5 + hf.d / 2) / hf.cell));
  const j1 = Math.min(hf.ny - 1, Math.ceil((place.y + half * 1.5 + hf.d / 2) / hf.cell));
  for (let j = j0; j <= j1; j++) {
    const y = sampleY(hf, j) - place.y;
    for (let i = i0; i <= i1; i++) {
      const x = sampleX(hf, i) - place.x;
      // into stamp space
      const lx = x * cr + y * sr, ly = -x * sr + y * cr;
      const u = lx / place.size + 0.5, v = ly / place.size + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      // radial fade near the square's edge
      const e = Math.max(Math.abs(lx), Math.abs(ly)) / half;
      const w = e < 1 - fall ? 1 : Math.max(0, (1 - e) / Math.max(1e-6, fall));
      if (w <= 0) continue;
      const hv = sampleStamp(st, u, v) * place.strength * w;
      const k = j * hf.nx + i;
      if (mode === 'add') hf.z[k] += hv;
      else if (mode === 'max') hf.z[k] = Math.max(hf.z[k], zc + hv);
      else hf.z[k] = Math.min(hf.z[k], zc + hv);
    }
  }
}

export interface BrushStroke {
  x: number;
  y: number;
  radius: number;
  /** raise/lower: mm at the centre; smooth: 0..1 blend; flatten: target height in mm */
  strength: number;
  kind: 'raise' | 'lower' | 'smooth' | 'flatten';
  /** 0..1 softness of the edge */
  hardness?: number;
}

/** One brush dab; call along a stroke for painting. */
export function brush(hf: Heightfield, s: BrushStroke): void {
  const r = s.radius;
  const hard = Math.min(1, Math.max(0, s.hardness ?? 0.5));
  const i0 = Math.max(0, Math.floor((s.x - r + hf.w / 2) / hf.cell));
  const i1 = Math.min(hf.nx - 1, Math.ceil((s.x + r + hf.w / 2) / hf.cell));
  const j0 = Math.max(0, Math.floor((s.y - r + hf.d / 2) / hf.cell));
  const j1 = Math.min(hf.ny - 1, Math.ceil((s.y + r + hf.d / 2) / hf.cell));
  const weightAt = (dist: number): number => {
    const t = dist / r;
    if (t >= 1) return 0;
    if (t <= hard) return 1;
    const u = (t - hard) / Math.max(1e-6, 1 - hard);
    return 1 - u * u * (3 - 2 * u);
  };
  if (s.kind === 'smooth') {
    const src = hf.z.slice();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = weightAt(Math.hypot(sampleX(hf, i) - s.x, sampleY(hf, j) - s.y)) * Math.min(1, Math.max(0, s.strength));
        if (w <= 0) continue;
        let sum = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= hf.nx || jj >= hf.ny) continue;
            sum += src[jj * hf.nx + ii];
            n++;
          }
        }
        const k = j * hf.nx + i;
        hf.z[k] = src[k] * (1 - w) + (sum / n) * w;
      }
    }
    return;
  }
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const w = weightAt(Math.hypot(sampleX(hf, i) - s.x, sampleY(hf, j) - s.y));
      if (w <= 0) continue;
      const k = j * hf.nx + i;
      if (s.kind === 'raise') hf.z[k] += s.strength * w;
      else if (s.kind === 'lower') hf.z[k] -= s.strength * w;
      else hf.z[k] = hf.z[k] * (1 - w) + s.strength * w;
    }
  }
}

/** Flat landing zone for a miniature: a disc pressed to `z` with a feathered edge. */
export function flattenDisc(hf: Heightfield, x: number, y: number, radius: number, z: number, feather = 1.5): void {
  brush(hf, { x, y, radius: radius + feather, strength: z, kind: 'flatten', hardness: radius / (radius + feather) });
}

/**
 * Blend the terrain down to `floorZ` within `width` mm of the footprint edge so
 * the sculpt meets the plate cleanly (the OPR sets keep their sculpt just inside
 * the bevel). Points outside the polygon are set to `floorZ`.
 */
export function rimTaper(hf: Heightfield, outline: Polygon2, width: number, floorZ: number): void {
  for (let j = 0; j < hf.ny; j++) {
    const y = sampleY(hf, j);
    for (let i = 0; i < hf.nx; i++) {
      const x = sampleX(hf, i);
      const k = j * hf.nx + i;
      if (!pointInConvexPolygon(outline, x, y)) { hf.z[k] = floorZ; continue; }
      const dist = minEdgeDistance(outline, x, y);
      if (dist >= width) continue;
      const t = dist / width;
      const s = t * t * (3 - 2 * t);
      hf.z[k] = floorZ + (hf.z[k] - floorZ) * s;
    }
  }
}

export function clampHeights(hf: Heightfield, min: number, max: number): void {
  for (let k = 0; k < hf.z.length; k++) hf.z[k] = Math.min(max, Math.max(min, hf.z[k]));
}

/** Shift all heights so the lowest sample sits at `floor`. */
export function settleFloor(hf: Heightfield, floor: number): void {
  const { min } = heightRange(hf);
  const dz = floor - min;
  if (dz !== 0) for (let k = 0; k < hf.z.length; k++) hf.z[k] += dz;
}

/** Points of a polygon's interior on the field grid (for statistics and tests). */
export function samplesInside(hf: Heightfield, outline: Polygon2): Vec2[] {
  const out: Vec2[] = [];
  for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) {
    const x = sampleX(hf, i), y = sampleY(hf, j);
    if (pointInConvexPolygon(outline, x, y)) out.push([x, y]);
  }
  return out;
}
