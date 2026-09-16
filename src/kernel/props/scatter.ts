/**
 * Prop scattering for Base Studio: Poisson-disc placement inside a footprint
 * with the hobby's rules baked in (research: docs/research + the plan):
 * props stay >= rimInset from the edge, never inside a miniature's foot zone,
 * never overlapping each other, density falls with area, small boards get no
 * hero prop, and everything is reproducible for a seed.
 */
import type { Polygon2, Vec2, Vec3 } from '../types';
import { minEdgeDistance, pointInConvexPolygon, polygonArea, polygonBounds, polygonCentroid } from '../geom2d/polygon';
import { insetConvex } from '../geom2d/offset';
import type { Heightfield } from '../terrain/heightfield';
import { rng, sampleHeight, sampleNormal } from '../terrain/heightfield';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** A thing that can be scattered: an asset id and how much ground it needs. */
export interface ScatterAsset {
  id: string;
  /** radius of the prop's footprint at scale 1, mm */
  footprintRadius: number;
  /** relative pick weight */
  weight?: number;
  /** allowed uniform scale range */
  scale?: [number, number];
  /** height at scale 1, mm (for the height cap) */
  height?: number;
}

export interface ScatterRules {
  /** keep-out from the footprint edge, mm (research: >= 1.5) */
  rimInset: number;
  /** miniature landing zones: nothing inside */
  footZones: Circle[];
  /** extra keep-outs (planned cut lines' hero props, splines...) */
  keepOut?: Circle[];
  /** props per cm² before the area scaling; 'light' 0.4, 'medium' 0.8, 'heavy' 1.4 are the presets */
  density: number;
  /** tallest allowed prop, mm */
  heightCap: number;
  /** how far props sink into the ground, mm */
  sink: number;
  /** place one hero prop when the footprint is at least this wide, mm; 0 = never */
  heroMinSize: number;
  seed: number;
}

export interface Placement {
  assetId: string;
  x: number;
  y: number;
  /** yaw, degrees */
  rotDeg: number;
  scale: number;
  hero: boolean;
}

export interface SettledPlacement extends Placement {
  z: number;
  /** ground normal under the prop (unit) */
  normal: Vec3;
}

export const DENSITY_PRESETS = { light: 0.4, medium: 0.8, heavy: 1.4 } as const;

/**
 * Density scaled by footprint area: small bases want negative space (research
 * rule 7). Full density from ~100 cm² up, a third of it at 25 mm.
 */
export function areaDensityFactor(areaMm2: number): number {
  const cm2 = areaMm2 / 100;
  return Math.min(1, 0.33 + (0.67 * Math.min(cm2, 100)) / 100);
}

/** Height cap by the smaller footprint dimension (research: 6 / 12 / 25 mm). */
export function defaultHeightCap(minSideMm: number): number {
  if (minSideMm <= 32) return 6;
  if (minSideMm <= 60) return 12;
  return 25;
}

function insideAll(p: Vec2, poly: Polygon2, inset: number, keep: Circle[], ownR: number): boolean {
  if (!pointInConvexPolygon(poly, p[0], p[1])) return false;
  if (minEdgeDistance(poly, p[0], p[1]) < inset + ownR) return false;
  for (const c of keep) if (Math.hypot(p[0] - c.x, p[1] - c.y) < c.r + ownR) return false;
  return true;
}

export interface PoissonOptions {
  /**
   * Floor on the centre-to-centre distance, mm: two points must be at least
   * max(r1 + r2, minSpacing) apart. This — not the point cap — is the knob that
   * sets how many points a domain ends up holding (see `spacingForCount`).
   */
  minSpacing?: number;
  /** candidate attempts per active point */
  k?: number;
}

/**
 * Bridson Poisson-disc sampling inside a convex polygon with per-point radii.
 * `radiusFor` gives the exclusion radius of the point about to be placed; two
 * points must be at least max(r1 + r2, `opts.minSpacing`) apart.
 *
 * `maxPoints` is a SAFETY ceiling, not a target. Bridson grows outward from its
 * first sample, so stopping the growth early leaves the far side of the polygon
 * bare (that was the "props clump in the middle-left third" bug): pass a ceiling
 * well above the count you want, set `minSpacing` from the count instead, and
 * thin the finished set with `thinTo`.
 */
export function poissonInPolygon<T = undefined>(
  poly: Polygon2,
  seed: number,
  radiusFor: (r: () => number) => { r: number; tag: T },
  inset: number,
  keepOut: Circle[],
  maxPoints: number,
  opts: PoissonOptions = {},
): { p: Vec2; r: number; tag: T }[] {
  const out: { p: Vec2; r: number; tag: T }[] = [];
  if (maxPoints <= 0 || poly.length < 3) return out;
  const minSpacing = Number.isFinite(opts.minSpacing) ? Math.max(0, opts.minSpacing as number) : 0;
  const k = opts.k ?? 24;
  const rand = rng(seed);
  const b = polygonBounds(poly);
  const active: number[] = [];
  // one cell per spacing step keeps the neighbour scan at ~5x5 cells whatever the scale
  const cell = Math.max(1, minSpacing);
  let maxR = 0;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  const fits = (p: Vec2, r: number): boolean => {
    if (!insideAll(p, poly, inset, keepOut, r)) return false;
    const reach = Math.floor(Math.max(r + maxR, minSpacing) / cell) + 1;
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      for (const idx of grid.get((gx + di) + ',' + (gy + dj)) ?? []) {
        const q = out[idx];
        if (Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < Math.max(q.r + r, minSpacing)) return false;
      }
    }
    return true;
  };
  const add = (p: Vec2, r: number, tag: T) => {
    out.push({ p, r, tag });
    active.push(out.length - 1);
    if (r > maxR) maxR = r;
    const kk = key(p[0], p[1]);
    (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(out.length - 1);
  };
  // first point: try a few random spots, then the centroid (a footprint that is
  // mostly keep-out can swallow every random try)
  for (let t = 0; t < 120 && out.length === 0; t++) {
    const p: Vec2 = [b.min[0] + rand() * (b.max[0] - b.min[0]), b.min[1] + rand() * (b.max[1] - b.min[1])];
    const { r, tag } = radiusFor(rand);
    if (fits(p, r)) add(p, r, tag);
  }
  if (out.length === 0) {
    const c = polygonCentroid(poly);
    const { r, tag } = radiusFor(rand);
    if (fits(c, r)) add(c, r, tag);
  }
  while (active.length > 0 && out.length < maxPoints) {
    const ai = Math.floor(rand() * active.length);
    const base = out[active[ai]];
    let placed = false;
    for (let t = 0; t < k; t++) {
      const { r, tag } = radiusFor(rand);
      const d0 = Math.max(base.r + r, minSpacing);
      // uniform over the annulus d0..2*d0 (uniform in radius would crowd the inner ring)
      const dist = d0 * Math.sqrt(1 + 3 * rand());
      const ang = rand() * Math.PI * 2;
      const p: Vec2 = [base.p[0] + Math.cos(ang) * dist, base.p[1] + Math.sin(ang) * dist];
      if (fits(p, r)) { add(p, r, tag); placed = true; break; }
    }
    if (!placed) active.splice(ai, 1);
  }
  return out;
}

/**
 * Poisson-disc packing holds about PACK_FILL * area / d² points at minimum
 * distance d (maximal hexagonal packing is 1.155 / d²; Bridson reaches ~57% of
 * it, measured 0.63-0.70 over the spacings these boards use). Deliberately at
 * the low end so the first pass lands at or just above the wanted count and the
 * extra points are thinned away rather than missing.
 */
const PACK_FILL = 0.66;

/** The minimum spacing whose Poisson-disc packing lands near `count` points in `area` mm². */
export function spacingForCount(area: number, count: number): number {
  if (count <= 0 || area <= 0) return Infinity;
  return Math.sqrt((PACK_FILL * area) / count);
}

/**
 * Keep `n` of `items`, chosen uniformly at random with the caller's seeded rng,
 * in their original order. Thinning an evenly grown set keeps it even; cutting
 * the growth short instead is what leaves half the board bare.
 */
export function thinTo<T>(items: T[], n: number, rand: () => number): T[] {
  if (n >= items.length) return items;
  if (n <= 0) return [];
  const idx = items.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (idx.length - i));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return idx.slice(0, n).sort((a, b) => a - b).map((i) => items[i]);
}

/** Rule-of-thirds candidates inside a footprint, nearest to the centroid first. */
export function heroPoints(poly: Polygon2): Vec2[] {
  const b = polygonBounds(poly);
  const w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
  const pts: Vec2[] = [];
  for (const fx of [1 / 3, 2 / 3]) for (const fy of [1 / 3, 2 / 3]) pts.push([b.min[0] + fx * w, b.min[1] + fy * d]);
  const c = polygonCentroid(poly);
  return pts.filter((p) => pointInConvexPolygon(poly, p[0], p[1])).sort((p, q) => Math.hypot(p[0] - c[0], p[1] - c[1]) - Math.hypot(q[0] - c[0], q[1] - c[1]));
}

/**
 * Scatter assets over a footprint. Returns placements without heights; call
 * `settle` with the heightfield to drop them onto the ground.
 */
export function scatter(poly: Polygon2, assets: ScatterAsset[], rules: ScatterRules): Placement[] {
  if (assets.length === 0 || poly.length < 3) return [];
  const rand = rng(rules.seed ^ 0x5bd1e995);
  const area = polygonArea(poly);
  const b = polygonBounds(poly);
  const minSide = Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]);
  const target = Math.max(0, Math.round((area / 100) * rules.density * areaDensityFactor(area)));
  const keep: Circle[] = [...rules.footZones, ...(rules.keepOut ?? [])];
  const out: Placement[] = [];

  // pick weights
  const totalW = assets.reduce((a, x) => a + (x.weight ?? 1), 0);
  const pick = (): ScatterAsset => {
    let t = rand() * totalW;
    for (const a of assets) { t -= a.weight ?? 1; if (t <= 0) return a; }
    return assets[assets.length - 1];
  };
  const capScale = (a: ScatterAsset, s: number): number =>
    // the height cap is a hard rule: shrink the prop rather than break it
    (a.height && a.height * s > rules.heightCap ? rules.heightCap / a.height : s);
  const scaleFor = (a: ScatterAsset): number => {
    const [lo, hi] = a.scale ?? [0.8, 1.25];
    return capScale(a, lo + rand() * (hi - lo));
  };

  // hero prop: the largest asset, up-scaled, at a rule-of-thirds point
  if (rules.heroMinSize > 0 && minSide >= rules.heroMinSize) {
    const hero = assets.slice().sort((p, q) => q.footprintRadius - p.footprintRadius)[0];
    const s = Math.min(scaleFor(hero) * 1.4, hero.height ? rules.heightCap / hero.height : 3);
    const r = hero.footprintRadius * s;
    for (const p of heroPoints(insetConvex(poly, rules.rimInset + r))) {
      if (insideAll(p, poly, rules.rimInset, keep, r)) {
        out.push({ assetId: hero.id, x: p[0], y: p[1], rotDeg: rand() * 360, scale: s, hero: true });
        keep.push({ x: p[0], y: p[1], r });
        break;
      }
    }
  }

  const want = Math.max(0, target - out.length);
  if (want === 0) return out;

  // The spacing, not a point cap, decides how many props a board holds: derive
  // it from the target count and the area a prop centre may actually land in
  // (the footprint minus the rim inset, the average prop's own radius and the
  // keep-outs), then correct it once or twice from what the sampler returned.
  const meanR = assets.reduce((a, x) => {
    const [lo, hi] = x.scale ?? [0.8, 1.25];
    return a + (x.weight ?? 1) * x.footprintRadius * capScale(x, (lo + hi) / 2);
  }, 0) / (totalW || 1);
  const inner = insetConvex(poly, rules.rimInset + meanR);
  const innerArea = inner.length >= 3 ? polygonArea(inner) : Math.max(area * 0.25, 1);
  let usable = innerArea;
  for (const c of keep) usable -= Math.PI * (c.r + meanR) ** 2;
  usable = Math.max(usable, innerArea * 0.15, 1);

  // each attempt picks an asset and a scale, and the accepted point keeps that pick as its tag
  const radiusFor = () => {
    const a = pick();
    const s = scaleFor(a);
    return { r: a.footprintRadius * s, tag: { a, s } };
  };
  // ceiling only: high enough that growth is never what stops the sampler
  const cap = Math.max(64, Math.ceil(want * 3 + 32));
  let spacing = spacingForCount(usable, want);
  // too many points can be thinned back to the target, too few cannot: score a
  // pass by its distance from `want`, counting a shortfall double
  const score = (n: number) => (n === 0 ? Infinity : n >= want ? n - want : (want - n) * 2 + 0.5);
  let best: { p: Vec2; r: number; tag: { a: ScatterAsset; s: number } }[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const pts = poissonInPolygon<{ a: ScatterAsset; s: number }>(
      poly, rules.seed, radiusFor, rules.rimInset, keep, cap, { minSpacing: spacing },
    );
    if (pass === 0 || score(pts.length) < score(best.length)) best = pts;
    if (pts.length === 0) break;
    if (pts.length >= want && pts.length <= want * 1.2) break; // thin the few extra away
    const adjust = Math.sqrt(pts.length / want);
    if (Math.abs(adjust - 1) < 0.02) break;
    spacing *= Math.min(1.8, Math.max(0.55, adjust));
  }
  for (const pt of thinTo(best, want, rand)) {
    out.push({ assetId: pt.tag.a.id, x: pt.p[0], y: pt.p[1], rotDeg: rand() * 360, scale: pt.tag.s, hero: false });
  }
  return out;
}

/** Drop placements onto the terrain: height from the field, sunk a little, with the ground normal. */
export function settle(hf: Heightfield, placements: Placement[], sink: number): SettledPlacement[] {
  return placements.map((p) => ({ ...p, z: sampleHeight(hf, p.x, p.y) - sink, normal: sampleNormal(hf, p.x, p.y) }));
}
