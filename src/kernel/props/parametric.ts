/**
 * Parametric props: licence-free elements Base Studio scatters and places
 * (boulders, rubble, crates, planks, pipes, rebar, deck plates, gratings,
 * crystals, column drums). Every generator returns closed triangle shells in
 * the prop's local frame: z = 0 is the ground line, the part below it (down
 * to `underground`) beds into the terrain, `height` is what shows above, and
 * `footprintRadius` is the radius the scatter keeps clear. Deterministic per
 * seed. Printability rules from docs/research/basing-practice.md are clamped
 * in: nothing thinner than 0.5 mm, grating holes >= 1 mm with bars >= 0.5 mm,
 * pipes >= 1.5 mm, rebar tapered and leaning no more than 65° from upright.
 * Pure kernel code; the worker builds these for previews and bakes.
 */
import type { Soup, Vec3 } from '../types';
import { SoupBuilder } from '../types';

export interface Prop {
  /** closed shells (possibly several, overlapping) in the prop's local frame */
  soup: Soup;
  /** radius around the origin the prop occupies in XY, mm */
  footprintRadius: number;
  /** top of the prop above the ground line, mm */
  height: number;
  /** lowest point below the ground line (<= 0), mm; that part beds into the terrain */
  underground: number;
}

export type ParametricKind =
  | 'boulder'
  | 'rubble'
  | 'crystal'
  | 'crate'
  | 'container'
  | 'plank'
  | 'pipe'
  | 'rebar'
  | 'deck-plate'
  | 'grating'
  | 'column-drum'
  | 'crystal-cluster'
  | 'cable';

export type ParametricFamily = 'rock' | 'debris' | 'alien' | 'scifi' | 'wood' | 'ruin';

export interface ParametricSpec {
  kind: ParametricKind;
  params: Record<string, number>;
  seed: number;
}

export interface ParametricEntry {
  kind: ParametricKind;
  label: string;
  /** one line for the UI */
  help: string;
  family: ParametricFamily;
  defaults: Record<string, number>;
}

/** Everything the studio can build without an asset file. Sizes are mm at 28-32 mm scale. */
export const PARAMETRIC_CATALOG: ParametricEntry[] = [
  { kind: 'boulder', label: 'Boulder', help: 'A rounded, half-buried rock.', family: 'rock', defaults: { size: 6, squash: 0.7, rough: 0.25 } },
  { kind: 'rubble', label: 'Rubble chunk', help: 'An angular broken chunk, 2-8 mm.', family: 'debris', defaults: { size: 4, rough: 0.5 } },
  { kind: 'crystal', label: 'Crystal', help: 'A six-sided crystal shard growing out of the ground at a slight lean.', family: 'alien', defaults: { size: 2.5, height: 6, sides: 6, lean: 15 } },
  { kind: 'crate', label: 'Crate', help: 'A slatted wooden or plastic crate.', family: 'scifi', defaults: { size: 6, height: 5, slats: 3 } },
  { kind: 'container', label: 'Cargo container', help: 'A ribbed shipping container.', family: 'scifi', defaults: { length: 12, width: 6, height: 5 } },
  { kind: 'plank', label: 'Plank', help: 'A loose board lying flat.', family: 'wood', defaults: { length: 12, width: 3.5, thickness: 0.8 } },
  { kind: 'pipe', label: 'Pipe', help: 'A pipe section with end flanges, lying on the ground.', family: 'scifi', defaults: { length: 14, dia: 2.5, flanges: 1 } },
  { kind: 'rebar', label: 'Rebar', help: 'A bent bar sticking out of the rubble, tapered and leaning so it prints.', family: 'scifi', defaults: { length: 8, dia: 1, lean: 40 } },
  { kind: 'deck-plate', label: 'Deck plate', help: 'A riveted metal plate on the ground.', family: 'scifi', defaults: { size: 10, thickness: 0.6, rivets: 1 } },
  { kind: 'grating', label: 'Grating', help: 'A framed metal grate; holes at least 1 mm so resin drains.', family: 'scifi', defaults: { size: 10, bar: 0.6, pitch: 2.2, frame: 1 } },
  { kind: 'column-drum', label: 'Column drum', help: 'A fallen or standing section of a stone column, chipped on top.', family: 'ruin', defaults: { dia: 8, height: 4 } },
  { kind: 'crystal-cluster', label: 'Crystal cluster', help: 'Three to five crystal shards growing from one spot.', family: 'alien', defaults: { size: 2, height: 5, count: 4 } },
  { kind: 'cable', label: 'Cable run', help: 'A thick cable lying on the ground, held by two clips.', family: 'scifi', defaults: { length: 14, dia: 1.6 } },
];

export const PARAMETRIC_KINDS: ParametricKind[] = PARAMETRIC_CATALOG.map((c) => c.kind);

export function parametricEntry(kind: string): ParametricEntry | undefined {
  return PARAMETRIC_CATALOG.find((c) => c.kind === kind);
}

// ---------------------------------------------------------------- helpers

function mulberry(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashKind(kind: string): number {
  let h = 2166136261;
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619);
  return h >>> 0;
}

function quad(out: SoupBuilder, a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
  out.triV(a, b, c);
  out.triV(a, c, d);
}

/** Axis-aligned closed box, CCW outward. */
function box(out: SoupBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const p = (x: number, y: number, z: number): Vec3 => [x, y, z];
  quad(out, p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)); // bottom
  quad(out, p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)); // top
  quad(out, p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)); // front (-y)
  quad(out, p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)); // back (+y)
  quad(out, p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1)); // left (-x)
  quad(out, p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)); // right (+x)
}

/**
 * Skin a stack of rings (each the same length, angles counter-clockwise about
 * the stacking axis, rings ordered along +axis). Ends are closed with a pole
 * point, a fan over the ring, or nothing; with `closed` the last ring joins
 * the first (a torus, used for square frames).
 */
function skin(out: SoupBuilder, rings: Vec3[][], ends: { bottom?: Vec3 | 'fan'; top?: Vec3 | 'fan'; closed?: boolean }): void {
  const n = rings[0].length;
  const link = (lo: Vec3[], hi: Vec3[]) => {
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      quad(out, lo[j], lo[k], hi[k], hi[j]);
    }
  };
  for (let i = 0; i + 1 < rings.length; i++) link(rings[i], rings[i + 1]);
  if (ends.closed) link(rings[rings.length - 1], rings[0]);
  const centre = (r: Vec3[]): Vec3 => {
    let x = 0, y = 0, z = 0;
    for (const p of r) { x += p[0]; y += p[1]; z += p[2]; }
    return [x / r.length, y / r.length, z / r.length];
  };
  if (ends.bottom) {
    const r = rings[0];
    const c = ends.bottom === 'fan' ? centre(r) : ends.bottom;
    for (let j = 0; j < n; j++) out.triV(c, r[(j + 1) % n], r[j]);
  }
  if (ends.top) {
    const r = rings[rings.length - 1];
    const c = ends.top === 'fan' ? centre(r) : ends.top;
    for (let j = 0; j < n; j++) out.triV(c, r[j], r[(j + 1) % n]);
  }
}

/** A ring of `n` points around the z axis at height z (angles CCW from +x). */
function ringZ(n: number, z: number, radius: (j: number, theta: number) => number, cx = 0, cy = 0, phase = 0): Vec3[] {
  const r: Vec3[] = [];
  for (let j = 0; j < n; j++) {
    const t = phase + (j / n) * Math.PI * 2;
    const rad = radius(j, t);
    r.push([cx + Math.cos(t) * rad, cy + Math.sin(t) * rad, z]);
  }
  return r;
}

/** A ring of `n` points around the x axis at position x (angles CCW viewed from +x, from +y towards +z). */
function ringX(n: number, x: number, radius: number, cy: number, cz: number, phase = 0): Vec3[] {
  const r: Vec3[] = [];
  for (let j = 0; j < n; j++) {
    const t = phase + (j / n) * Math.PI * 2;
    r.push([x, cy + Math.cos(t) * radius, cz + Math.sin(t) * radius]);
  }
  return r;
}

/** Closed lathe about z: profile (r, z) bottom to top; r = 0 at an end makes a pole. */
function lathe(out: SoupBuilder, profile: [number, number][], segments: number, phase = 0): void {
  const rings: Vec3[][] = [];
  let bottom: Vec3 | 'fan' | undefined;
  let top: Vec3 | 'fan' | undefined;
  profile.forEach(([r, z], i) => {
    if (r <= 0) {
      if (i === 0) bottom = [0, 0, z];
      else top = [0, 0, z];
    } else rings.push(ringZ(segments, z, () => r, 0, 0, phase));
  });
  if (!bottom) bottom = 'fan';
  if (!top) top = 'fan';
  skin(out, rings, { bottom, top });
}

/** A closed cylinder along x from x0 to x1, centre (cy, cz). */
function cylinderX(out: SoupBuilder, x0: number, x1: number, radius: number, cy: number, cz: number, segments: number, phase = 0): void {
  skin(out, [ringX(segments, x0, radius, cy, cz, phase), ringX(segments, x1, radius, cy, cz, phase)], { bottom: 'fan', top: 'fan' });
}

/** Square frame (outer square `o`, inner square `i`, z0..z1) as one closed shell. */
function squareFrame(out: SoupBuilder, o: number, i: number, z0: number, z1: number): void {
  const sq = (h: number, z: number): Vec3[] => [[h, -h, z], [h, h, z], [-h, h, z], [-h, -h, z]];
  skin(out, [sq(o, z0), sq(o, z1), sq(i, z1), sq(i, z0)], { closed: true });
}

function rotateX(p: Float32Array, deg: number): void {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1], z = p[i + 2];
    p[i + 1] = y * c - z * s;
    p[i + 2] = y * s + z * c;
  }
}

function rotateZ(p: Float32Array, deg: number): void {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    p[i] = x * c - y * s;
    p[i + 1] = x * s + y * c;
  }
}

/** Shift the soup so its lowest point sits `bed` below the ground line and measure it. */
function finish(soup: Soup, bed: number): Prop {
  const p = soup.positions;
  const n = soup.triCount * 9;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 2; i < n; i += 3) { if (p[i] < minZ) minZ = p[i]; if (p[i] > maxZ) maxZ = p[i]; }
  const dz = -bed - minZ;
  let r2 = 0;
  for (let i = 0; i < n; i += 3) {
    p[i + 2] += dz;
    const d = p[i] * p[i] + p[i + 1] * p[i + 1];
    if (d > r2) r2 = d;
  }
  return { soup, footprintRadius: Math.sqrt(r2), height: maxZ + dz, underground: -bed };
}

const clampMin = (v: number, min: number): number => (Number.isFinite(v) ? Math.max(min, v) : min);

// ---------------------------------------------------------------- generators

/** A lumpy ellipsoid: low harmonics for the shape, a little per-vertex grit, flattened below. */
function lumpyStone(out: SoupBuilder, rnd: () => number, size: number, squash: number, rough: number, bands: number, segments: number, flatFrac: number): number {
  const r = size / 2;
  const amp = [0, 1, 2, 3].map(() => (rnd() * 2 - 1));
  const ph = [0, 1, 2, 3].map(() => rnd() * Math.PI * 2);
  const sx = 0.85 + rnd() * 0.3, sy = 0.85 + rnd() * 0.3;
  const flatZ = -r * squash * (1 - flatFrac * 2);
  const shape = (theta: number, phi: number) => {
    const cp = Math.cos(phi);
    let f = 1 + rough * (0.5 * amp[0] * Math.cos(theta + ph[0]) * cp + 0.35 * amp[1] * Math.cos(2 * theta + ph[1]) * cp + 0.2 * amp[2] * Math.cos(3 * theta + ph[2]) * cp + 0.3 * amp[3] * Math.sin(2 * phi + ph[3]));
    f += rough * 0.15 * (rnd() * 2 - 1);
    return Math.max(0.55, f);
  };
  const rings: Vec3[][] = [];
  for (let k = 1; k < bands; k++) {
    const phi = -Math.PI / 2 + (Math.PI * k) / bands;
    const ring: Vec3[] = [];
    for (let j = 0; j < segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const f = shape(theta, phi);
      const rr = r * f * Math.cos(phi);
      const z = Math.max(flatZ, r * f * Math.sin(phi) * squash);
      ring.push([rr * Math.cos(theta) * sx, rr * Math.sin(theta) * sy, z]);
    }
    rings.push(ring);
  }
  const topF = shape(0, Math.PI / 2);
  skin(out, rings, { bottom: [0, 0, flatZ], top: [0, 0, r * topF * squash] });
  return r * squash * 2; // rough vertical extent, for the bedding depth
}

function buildBoulder(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const size = clampMin(p.size, 1.5);
  const ext = lumpyStone(out, rnd, size, Math.min(1.2, clampMin(p.squash, 0.35)), Math.min(0.6, clampMin(p.rough, 0)), 7, 12, 0.18);
  return ext * 0.3;
}

function buildRubble(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const size = Math.min(8, clampMin(p.size, 1.5));
  const ext = lumpyStone(out, rnd, size, 0.75 + rnd() * 0.3, Math.min(0.9, clampMin(p.rough, 0)), 4, 5 + Math.floor(rnd() * 3), 0.22);
  return ext * 0.22;
}

function buildCrystal(out: SoupBuilder, rnd: () => number, p: Record<string, number>): Built {
  const r = clampMin(p.size, 0.6);
  const h = clampMin(p.height, r * 1.5);
  const sides = Math.max(5, Math.min(8, Math.round(p.sides || 6)));
  const embed = Math.max(0.6, h * 0.3);
  const phase = rnd() * Math.PI;
  lathe(out, [[r * 0.95, -embed], [r, h * 0.62], [r * 0.5, h * 0.86], [0, h]], sides, phase);
  const lean = Math.min(35, clampMin(p.lean, 0)) * (rnd() < 0.5 ? -1 : 1);
  return finishLean(out, lean, rnd() * 360, embed);
}

/** What a builder returns: the bed depth, optionally with a lean (about x) and yaw (about z) to apply to the finished shell. */
type Built = number | { bed: number; rotate: { x: number; z: number } };

/** Lean a shell built upright: rotated after building, then bedded `embed` deep. */
function finishLean(_out: SoupBuilder, leanDeg: number, yawDeg: number, embed: number): Built {
  return { bed: embed, rotate: { x: leanDeg, z: yawDeg } };
}

function buildCrate(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const s = clampMin(p.w ?? p.size, 2), h = clampMin(p.h ?? p.height, 1.5);
  const slats = Math.max(1, Math.min(6, Math.round(p.slats || 3)));
  const hs = s / 2;
  box(out, -hs, -hs, 0, hs, hs, h);
  const t = 0.3, sw = Math.max(0.6, (h / slats) * 0.55);
  for (let i = 0; i < slats; i++) {
    const z0 = (i + 0.5) * (h / slats) - sw / 2, z1 = z0 + sw;
    box(out, -hs - t, -hs - t, z0, hs + t, -hs + 0.1, z1); // front
    box(out, -hs - t, hs - 0.1, z0, hs + t, hs + t, z1); // back
    box(out, -hs - t, -hs - t + 0.05, z0 + 0.01, -hs + 0.1, hs + t - 0.05, z1 - 0.01); // left
    box(out, hs - 0.1, -hs - t + 0.05, z0 + 0.01, hs + t, hs + t - 0.05, z1 - 0.01); // right
  }
  // corner posts
  const pw = Math.max(0.6, s * 0.12);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * hs, y = sy * hs;
    box(out, Math.min(x, x + sx * (t + 0.05)) - (sx < 0 ? 0 : pw), Math.min(y, y + sy * (t + 0.05)) - (sy < 0 ? 0 : pw), -0.02, Math.max(x, x + sx * (t + 0.05)) + (sx < 0 ? pw : 0), Math.max(y, y + sy * (t + 0.05)) + (sy < 0 ? pw : 0), h + 0.05);
  }
  void rnd;
  return 0.2;
}

function buildContainer(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const L = clampMin(p.length, 3), W = clampMin(p.width, 2), H = clampMin(p.height, 1.5);
  const hl = L / 2, hw = W / 2;
  box(out, -hl, -hw, 0, hl, hw, H);
  // corrugation ribs on the long sides
  const pitch = 1.8, rib = 0.6, out0 = 0.3;
  const n = Math.max(1, Math.floor((L - 1.2) / pitch));
  const start = -((n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) {
    const x = start + i * pitch;
    box(out, x - rib / 2, -hw - out0, 0.25, x + rib / 2, -hw + 0.1, H - 0.25);
    box(out, x - rib / 2, hw - 0.1, 0.25, x + rib / 2, hw + out0, H - 0.25);
  }
  // corner posts and top rails
  const cp = 0.7;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x0 = sx < 0 ? -hl - 0.15 : hl - cp + 0.15, y0 = sy < 0 ? -hw - 0.15 : hw - cp + 0.15;
    box(out, x0, y0, -0.02, x0 + cp, y0 + cp, H + 0.12);
  }
  box(out, -hl + 0.2, -hw - 0.12, H - 0.5, hl - 0.2, -hw + 0.2, H + 0.08);
  box(out, -hl + 0.2, hw - 0.2, H - 0.5, hl - 0.2, hw + 0.12, H + 0.08);
  void rnd;
  return 0.2;
}

function buildPlank(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const L = clampMin(p.length, 2) * (0.85 + rnd() * 0.3), W = clampMin(p.width, 1), T = clampMin(p.thickness, 0.6);
  box(out, -L / 2, -W / 2, 0, L / 2, W / 2, T);
  return 0.1;
}

function buildPipe(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const L = clampMin(p.length, 3), r = clampMin(p.dia, 1.5) / 2;
  const seg = 16;
  cylinderX(out, -L / 2, L / 2, r, 0, r, seg);
  let bed = 0.15;
  if ((p.flanges ?? 1) > 0) {
    const fr = r * 1.35, fw = Math.max(0.6, r * 0.5);
    for (const x of [-L / 2 + 0.8, L / 2 - 0.8 - fw]) cylinderX(out, x, x + fw, fr, 0, r, seg, Math.PI / seg);
    bed = Math.max(bed, fr - r + 0.05);
  }
  void rnd;
  return bed;
}

function buildRebar(out: SoupBuilder, rnd: () => number, p: Record<string, number>): Built {
  const L = clampMin(p.length, 2), r0 = clampMin(p.dia, 0.8) / 2, r1 = Math.max(0.3, r0 * 0.6);
  const embed = Math.min(1.5, L * 0.3);
  lathe(out, [[r0, -embed], [r0, L * 0.45], [r1, L]], 8);
  // a kink two thirds of the way up reads as bent bar
  lathe(out, [[r1 * 1.01, L * 0.6], [r1 * 1.01, L * 0.6 + Math.max(0.6, r0 * 1.2)]], 8, Math.PI / 8);
  const lean = Math.min(65, clampMin(p.lean, 0));
  return finishLean(out, lean, rnd() * 360, embed);
}

function buildDeckPlate(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const w = clampMin(p.w ?? p.size, 3), d = clampMin(p.d ?? p.size, 3), t = clampMin(p.thickness, 0.5);
  const hw = w / 2, hd = d / 2;
  box(out, -hw, -hd, 0, hw, hd, t);
  if ((p.rivets ?? 1) > 0) {
    const inset = Math.min(1.2, Math.min(w, d) * 0.15);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = sx * (hw - inset), y = sy * (hd - inset);
      const rings = [ringZ(8, t - 0.1, () => 0.45, x, y), ringZ(8, t + 0.3, () => 0.3, x, y)];
      skin(out, rings, { bottom: 'fan', top: 'fan' });
    }
  }
  void rnd;
  return 0.15;
}

function buildGrating(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const s = clampMin(p.size, 3), bar = Math.max(0.5, p.bar || 0.6), frame = Math.max(0.6, p.frame || 1);
  const pitch = Math.max(bar + 1, p.pitch || 2.2); // holes >= 1 mm
  const h = 0.8;
  const hs = s / 2, inner = hs - frame;
  squareFrame(out, hs, inner, 0, h);
  const n = Math.max(0, Math.floor((inner * 2 - bar) / pitch));
  const start = -((n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) {
    const c = start + i * pitch;
    box(out, -inner - 0.2, c - bar / 2, 0.15, inner + 0.2, c + bar / 2, h - 0.15); // along x
    box(out, c - bar / 2 - 0.01, -inner - 0.2, 0.17, c + bar / 2 + 0.01, inner + 0.2, h - 0.17); // along y
  }
  void rnd;
  return 0.15;
}

function buildColumnDrum(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const r = clampMin(p.dia, 2) / 2, h = clampMin(p.height, 1);
  const seg = 20;
  const embed = 0.5;
  const rings = [ringZ(seg, -embed, () => r), ringZ(seg, h * 0.75, () => r), ringZ(seg, h, (j) => r * (0.9 + 0.1 * Math.sin(j * 1.7 + rnd() * 0.5)))];
  // chipped top: lift and drop the top ring a little around
  for (const v of rings[2]) v[2] = h + (rnd() - 0.5) * Math.min(0.8, h * 0.2);
  skin(out, rings, { bottom: 'fan', top: 'fan' });
  return embed;
}

function buildCrystalCluster(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const r = clampMin(p.size, 0.6), h = clampMin(p.height, r * 1.5);
  const count = Math.max(2, Math.min(6, Math.round(p.count || 4)));
  const embed = Math.max(0.6, h * 0.3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.8;
    const dist = i === 0 ? 0 : r * (0.9 + rnd() * 0.6);
    const cx = Math.cos(a) * dist, cy = Math.sin(a) * dist;
    const ri = r * (i === 0 ? 1 : 0.55 + rnd() * 0.35), hi = h * (i === 0 ? 1 : 0.45 + rnd() * 0.4);
    const phase = rnd() * Math.PI;
    const rings = [ringZ(6, -embed, () => ri * 0.95, cx, cy, phase), ringZ(6, hi * 0.62, () => ri, cx, cy, phase), ringZ(6, hi * 0.86, () => ri * 0.5, cx, cy, phase)];
    // lean the outer shards away from the centre
    if (i > 0) {
      const lean = (0.12 + rnd() * 0.18);
      for (const ring of rings) for (const v of ring) { v[0] += Math.cos(a) * (v[2] + embed) * lean; v[1] += Math.sin(a) * (v[2] + embed) * lean; }
    }
    const tip: Vec3 = [cx + (i > 0 ? Math.cos(a) * (hi + embed) * 0.2 : 0), cy + (i > 0 ? Math.sin(a) * (hi + embed) * 0.2 : 0), hi];
    skin(out, rings, { bottom: 'fan', top: tip });
  }
  return embed;
}

function buildCable(out: SoupBuilder, rnd: () => number, p: Record<string, number>): number {
  const L = clampMin(p.length, 3), r = clampMin(p.dia, 1.5) / 2;
  cylinderX(out, -L / 2, L / 2, r, 0, r, 12);
  // two clips holding it down
  for (const x of [-L * 0.3, L * 0.3]) {
    const cw = Math.max(0.8, r * 0.8);
    box(out, x - cw / 2, -r - 0.35, -0.02, x + cw / 2, r + 0.35, r * 2 + 0.3);
  }
  void rnd;
  return 0.1;
}

// ---------------------------------------------------------------- entry

const BUILDERS: Record<ParametricKind, (out: SoupBuilder, rnd: () => number, p: Record<string, number>) => Built> = {
  boulder: buildBoulder,
  rubble: buildRubble,
  crystal: buildCrystal,
  crate: buildCrate,
  container: buildContainer,
  plank: buildPlank,
  pipe: buildPipe,
  rebar: buildRebar,
  'deck-plate': buildDeckPlate,
  grating: buildGrating,
  'column-drum': buildColumnDrum,
  'crystal-cluster': buildCrystalCluster,
  cable: buildCable,
};

/** Build a prop from its kind, parameters (missing ones take the catalogue defaults) and seed. */
export function buildParametric(spec: ParametricSpec): Prop {
  const entry = parametricEntry(spec.kind);
  if (!entry) throw new Error(`unknown parametric prop ${spec.kind}`);
  const params = { ...entry.defaults, ...(spec.params ?? {}) };
  const rnd = mulberry((spec.seed >>> 0) ^ hashKind(spec.kind));
  const out = new SoupBuilder(256);
  const built = BUILDERS[spec.kind](out, rnd, params);
  const soup = out.buildCopy();
  const bed = typeof built === 'number' ? built : built.bed;
  if (typeof built !== 'number') {
    rotateX(soup.positions, built.rotate.x);
    rotateZ(soup.positions, built.rotate.z);
  }
  return finish(soup, bed);
}
