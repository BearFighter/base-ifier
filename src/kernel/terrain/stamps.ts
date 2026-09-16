/**
 * Procedural stamp maps (0..1 height maps) for the terrain: the licence-free
 * ground vocabulary. Sizes follow the research for 28-32 mm scale: cobbles and
 * bricks on a 5 x 10 mm repeat, deck-plate panels with 0.6 mm seams, grating
 * with holes >= 1 mm and bars >= 0.4 mm, rubble 2-8 mm.
 */
import type { StampMap } from './heightfield';
import { rng, simplex2 } from './heightfield';

function blank(nx: number, ny: number, size: number): StampMap {
  return { nx, ny, size, h: new Float32Array(nx * ny) };
}

function forEach(st: StampMap, fn: (u: number, v: number, x: number, y: number, k: number) => void): void {
  for (let j = 0; j < st.ny; j++) {
    for (let i = 0; i < st.nx; i++) {
      const u = i / (st.nx - 1), v = j / (st.ny - 1);
      fn(u, v, u * st.size, v * st.size, j * st.nx + i);
    }
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(1e-9, e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Load an image's grey values (0..255 per pixel, row-major) as a stamp. */
export function stampFromGrey(nx: number, ny: number, grey: ArrayLike<number>, size: number): StampMap {
  const st = blank(nx, ny, size);
  for (let k = 0; k < nx * ny; k++) st.h[k] = grey[k] / 255;
  return st;
}

/** Rounded cobbles on a staggered grid; `w` x `d` per cobble, `gap` between them. */
export function cobbles(size = 40, w = 5, d = 10, gap = 0.8, seed = 1, res = 0.25): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  const r = rng(seed);
  const jitter = new Map<string, [number, number, number]>();
  const cellJ = (cx: number, cy: number) => {
    const key = cx + ',' + cy;
    let v = jitter.get(key);
    if (!v) { v = [(r() - 0.5) * 0.3, (r() - 0.5) * 0.3, 0.75 + r() * 0.25]; jitter.set(key, v); }
    return v;
  };
  forEach(st, (_u, _v, x, y, k) => {
    const row = Math.floor(y / d);
    const off = (row & 1) ? w / 2 : 0;
    const col = Math.floor((x + off) / w);
    const cx = col * w - off + w / 2, cy = row * d + d / 2;
    const jv = cellJ(col, row);
    const dx = (x - cx - jv[0] * w) / (w / 2 - gap / 2), dy = (y - cy - jv[1] * d) / (d / 2 - gap / 2);
    const e = Math.sqrt(dx * dx * dx * dx + dy * dy * dy * dy); // superellipse: squarer than a circle
    st.h[k] = (1 - smoothstep(0.75, 1.05, e)) * jv[2];
  });
  return st;
}

/** Running-bond bricks (flat tops, recessed mortar). */
export function bricks(size = 40, w = 6, d = 2.5, mortar = 0.5, seed = 2, res = 0.2): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  const r = rng(seed);
  const heights = new Map<string, number>();
  forEach(st, (_u, _v, x, y, k) => {
    const row = Math.floor(y / d);
    const off = (row & 1) ? w / 2 : 0;
    const col = Math.floor((x + off) / w);
    const key = col + ',' + row;
    let hgt = heights.get(key);
    if (hgt === undefined) { hgt = 0.85 + r() * 0.15; heights.set(key, hgt); }
    const lx = ((x + off) % w + w) % w, ly = ((y % d) + d) % d;
    const inside = lx > mortar / 2 && lx < w - mortar / 2 && ly > mortar / 2 && ly < d - mortar / 2;
    st.h[k] = inside ? hgt : 0;
  });
  return st;
}

/** Sci-fi deck plating: panels separated by seams, with a rivet at each panel corner. */
export function plating(size = 40, panel = 10, seam = 0.6, rivet = 0.9, res = 0.2): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  forEach(st, (_u, _v, x, y, k) => {
    const lx = ((x % panel) + panel) % panel, ly = ((y % panel) + panel) % panel;
    const inSeam = lx < seam / 2 || lx > panel - seam / 2 || ly < seam / 2 || ly > panel - seam / 2;
    let h = inSeam ? 0.55 : 1;
    // rivet heads 1.2 mm in from each corner
    const rx = Math.min(lx, panel - lx) - 1.2, ry = Math.min(ly, panel - ly) - 1.2;
    const dr = Math.hypot(rx, ry);
    if (!inSeam && dr < rivet / 2) h = 1 + 0.35 * Math.sqrt(1 - (dr / (rivet / 2)) ** 2);
    st.h[k] = h / 1.35;
  });
  return st;
}

/** Industrial grating: square holes of `hole` mm between bars of `bar` mm. */
export function grating(size = 40, hole = 1.6, bar = 0.6, res = 0.1): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  const pitch = hole + bar;
  forEach(st, (_u, _v, x, y, k) => {
    const lx = ((x % pitch) + pitch) % pitch, ly = ((y % pitch) + pitch) % pitch;
    const onBar = lx < bar || ly < bar;
    st.h[k] = onBar ? 1 : 0;
  });
  return st;
}

/** Cracked dry earth / concrete: cells separated by shallow cracks (Voronoi edges). */
export function cracks(size = 40, cell = 6, crackW = 0.5, seed = 3, res = 0.2): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  const r = rng(seed);
  const cols = Math.ceil(size / cell) + 2;
  const seeds: [number, number][] = [];
  for (let j = -1; j <= cols; j++) for (let i = -1; i <= cols; i++) seeds.push([(i + 0.2 + r() * 0.6) * cell, (j + 0.2 + r() * 0.6) * cell]);
  forEach(st, (_u, _v, x, y, k) => {
    let d1 = Infinity, d2 = Infinity;
    for (const s of seeds) {
      const dd = Math.hypot(s[0] - x, s[1] - y);
      if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
    }
    const edge = d2 - d1; // 0 on the crack line
    st.h[k] = smoothstep(0, crackW, edge);
  });
  return st;
}

/** Impact craters: a raised rim around a bowl, several per stamp. */
export function craters(size = 40, count = 4, seed = 4, res = 0.25): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  st.h.fill(0.5);
  const r = rng(seed);
  const cs: [number, number, number][] = [];
  for (let c = 0; c < count; c++) cs.push([r() * size, r() * size, 2 + r() * 5]);
  forEach(st, (_u, _v, x, y, k) => {
    let h = 0.5;
    for (const [cx, cy, R] of cs) {
      const t = Math.hypot(x - cx, y - cy) / R;
      if (t < 1.4) {
        // bowl to -0.5 at the centre, rim +0.35 at t = 1, fading out by 1.4
        const bowl = t < 1 ? -(1 - t * t) * 0.5 : 0;
        const rim = 0.35 * Math.exp(-((t - 1) * (t - 1)) / 0.03);
        h += bowl + rim;
      }
    }
    st.h[k] = Math.min(1, Math.max(0, h));
  });
  return st;
}

/** Wind or water ripples along one axis. */
export function ripples(size = 40, wavelength = 4, seed = 5, res = 0.25): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  const nz = simplex2(seed);
  forEach(st, (_u, _v, x, y, k) => {
    const warp = nz(x / 12, y / 12) * 1.5;
    const s = Math.sin(((y + warp) / wavelength) * Math.PI * 2);
    st.h[k] = 0.5 + 0.5 * Math.sign(s) * Math.pow(Math.abs(s), 0.6);
  });
  return st;
}

/** Fine pebbles / gravel: many small domes. */
export function pebbles(size = 40, pebble = 1.6, seed = 6, res = 0.15): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  const r = rng(seed);
  const cnt = Math.round((size * size) / (pebble * pebble) * 0.6);
  const ps: [number, number, number][] = [];
  for (let c = 0; c < cnt; c++) ps.push([r() * size, r() * size, pebble * (0.35 + r() * 0.3)]);
  // spatial hash for speed
  const cellSz = pebble * 1.5;
  const grid = new Map<string, number[]>();
  ps.forEach((p, idx) => {
    const key = Math.floor(p[0] / cellSz) + ',' + Math.floor(p[1] / cellSz);
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(idx);
  });
  forEach(st, (_u, _v, x, y, k) => {
    const gx = Math.floor(x / cellSz), gy = Math.floor(y / cellSz);
    let h = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      for (const idx of grid.get((gx + di) + ',' + (gy + dj)) ?? []) {
        const p = ps[idx];
        const t = Math.hypot(x - p[0], y - p[1]) / p[2];
        if (t < 1) h = Math.max(h, Math.sqrt(1 - t * t));
      }
    }
    st.h[k] = h;
  });
  return st;
}

/** Generic rocky noise stamp (ridged), for boulders and outcrops. */
export function rockNoise(size = 40, seed = 7, res = 0.25): StampMap {
  const n = Math.max(8, Math.round(size / res)) + 1;
  const st = blank(n, n, size);
  const a = simplex2(seed), b = simplex2(seed + 1), c = simplex2(seed + 2);
  forEach(st, (_u, _v, x, y, k) => {
    const v = (1 - Math.abs(a(x / 14, y / 14))) * 0.6 + (1 - Math.abs(b(x / 6, y / 6))) * 0.3 + (c(x / 2.5, y / 2.5) * 0.5 + 0.5) * 0.1;
    st.h[k] = Math.min(1, Math.max(0, v));
  });
  return st;
}

export type StampId = 'cobbles' | 'bricks' | 'plating' | 'grating' | 'cracks' | 'craters' | 'ripples' | 'pebbles' | 'rockNoise';

/** All procedural stamps by id (cached per process). */
const cache = new Map<string, StampMap>();
export function proceduralStamp(id: StampId, seed = 1): StampMap {
  const key = id + ':' + seed;
  let st = cache.get(key);
  if (st) return st;
  switch (id) {
    case 'cobbles': st = cobbles(40, 5, 10, 0.8, seed); break;
    case 'bricks': st = bricks(40, 6, 2.5, 0.5, seed); break;
    case 'plating': st = plating(40); break;
    case 'grating': st = grating(40); break;
    case 'cracks': st = cracks(40, 6, 0.5, seed); break;
    case 'craters': st = craters(40, 4, seed); break;
    case 'ripples': st = ripples(40, 4, seed); break;
    case 'pebbles': st = pebbles(40, 1.6, seed); break;
    default: st = rockNoise(40, seed);
  }
  cache.set(key, st);
  return st;
}
