/**
 * Turn a Base Studio document into geometry: the ground heightfield, the
 * scattered props, and finally a `PreparedSource` the cutter consumes. Pure
 * kernel code; the worker calls it and the UI never touches the meshes.
 */
import type { Polygon2, Soup, Vec2, Vec3 } from '../types';
import { SoupBuilder } from '../types';
import { shapePolygon } from '../geom2d/shapes';
import { insetConvex } from '../geom2d/offset';
import { pointInConvexPolygon, polygonArea, polygonBounds, polygonCentroid, scalePolygonAbout } from '../geom2d/polygon';
import { boundsOfSoup } from '../mesh/bbox';
import { isWatertight } from '../mesh/validate';
import type { Heightfield } from '../terrain/heightfield';
import { addNoise, applyStamp, brush, createHeightfield, flattenDisc, rimTaper, rng, sampleHeight, sampleNormal, settleFloor, clampHeights } from '../terrain/heightfield';
import { proceduralStamp } from '../terrain/stamps';
import type { StampId } from '../terrain/stamps';
import { heightfieldToSlab, suggestedCell } from '../terrain/mesh';
import { genrePreset } from '../terrain/presets';
import { DENSITY_PRESETS, defaultHeightCap, scatter } from '../props/scatter';
import type { ScatterAsset } from '../props/scatter';
import type { Prop } from '../props/prop';
import { buildPreparedSourceFromMesh } from '../source/fromMesh';
import type { PreparedSource } from '../source/prepareSource';
import { boardShape } from './document';
import type { StudioDocument, StudioLibraryItem, StudioProp } from './document';

/** The sculpt (and its slab) must sit inside the plate top like the OPR sets do. */
const RIM_TAPER = 1.5;
/** Ground lip above the plate top at the rim, mm. */
const RIM_LIP = 0.05;

/**
 * Geometry for the scene's library items, held by the worker. Only geometry:
 * a prop's family, licence and pick weight live on the document
 * (`StudioDocument.library`), which travels to the worker with every call.
 */
export interface PropSource {
  /** the user's STL for a library item id: closed soup in local frame (bottom at z = 0) + footprint */
  get(assetId: string): Prop | null;
}

/** A source with nothing in it: an empty library scatters nothing. */
export const NO_ASSETS: PropSource = { get: () => null };

/** The scale range a user's own STL is scattered at: they are already at the size they sculpted. */
export const PROP_SCALE_RANGE: [number, number] = [0.85, 1.15];

/** A prop scaled below this by the height cap is too tall for the board, and the user is told. */
export const TOO_TALL_SCALE = 0.7;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Footprint polygons of the board: bottom (plate) and top (where the sculpt lives). */
export function boardPolygons(doc: StudioDocument): { bottom: Polygon2; top: Polygon2 } {
  const bottom = shapePolygon(boardShape(doc.board), 0, 0, 0);
  const c = polygonCentroid(bottom);
  const top = scalePolygonAbout(bottom, doc.board.topScale[0], doc.board.topScale[1], c[0], c[1]);
  return { bottom, top };
}

/**
 * The outline the ground is cut to. A rectangular board already IS the grid, so
 * it needs no cut; a round or oval board must be cut to its own outline or the
 * whole square grid shows (the live view and the finished scene MUST use the
 * same one, which is why both call this).
 */
export function groundClip(doc: StudioDocument): Polygon2 | undefined {
  if (doc.board.shape.kind === 'rect') return undefined;
  return insetConvex(boardPolygons(doc).top, 0.3);
}

/**
 * How far from the board's edge a prop's centre is kept: the gap the user asked
 * for plus the spare ground that gets cut away again. Never more than a third of
 * the smaller side, so a small board still has somewhere to put things.
 */
export function propClearance(doc: StudioDocument): number {
  const { w, d } = boardShape(doc.board);
  const asked = Math.max(0, doc.rules.rimInset) + Math.max(0, doc.board.margin ?? 0);
  return Math.min(asked, Math.min(w, d) / 3);
}

/**
 * The nearest spot on the board for a prop the user dragged or typed out of
 * bounds: inside the board outline, `propClearance` in from the edge. Returns
 * the point unchanged when it is already inside.
 */
export function clampPropToBoard(doc: StudioDocument, x: number, y: number): Vec2 {
  const top = boardPolygons(doc).top;
  const inset = propClearance(doc);
  const poly = inset > 0 ? (insetConvex(top, inset).length >= 3 ? insetConvex(top, inset) : top) : top;
  if (pointInConvexPolygon(poly, x, y, 1e-9)) return [x, y];
  let best: Vec2 = [poly[0][0], poly[0][1]];
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len2 = ex * ex + ey * ey;
    const t = len2 < 1e-15 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / len2));
    const px = a[0] + ex * t, py = a[1] + ey * t;
    const dd = (px - x) * (px - x) + (py - y) * (py - y);
    if (dd < bestD) { bestD = dd; best = [px, py]; }
  }
  return best;
}

/** Build the ground from the document's recipe (deterministic). `cell` overrides the sample spacing (coarser for previews). */
export function buildGround(doc: StudioDocument, cell?: number): Heightfield {
  const preset = genrePreset(doc.ground.presetId);
  const { w, d } = boardShape(doc.board);
  const { top } = boardPolygons(doc);
  const plate = doc.board.plateTop;
  cell = cell ?? suggestedCell(w, d);
  const hf = createHeightfield(w, d, cell, plate + RIM_LIP);
  const g = preset.ground;
  const rough = Math.max(0, doc.ground.roughness);
  if (g.noise.amplitude > 0 && rough > 0) addNoise(hf, { ...g.noise, seed: doc.ground.seed, amplitude: g.noise.amplitude * rough });
  const tex = Math.max(0, doc.ground.texture);
  for (const t of g.tiles ?? []) {
    const st = proceduralStamp(t.stamp, doc.ground.seed);
    const step = t.size;
    // tile the stamp across the board with a little overlap so seams vanish under the falloff
    for (let y = -d / 2 - step / 2; y < d / 2 + step; y += step * 0.9) {
      for (let x = -w / 2 - step / 2; x < w / 2 + step; x += step * 0.9) {
        applyStamp(hf, st, { x, y, size: step, strength: t.strength * tex, rotDeg: t.rotDeg ?? 0, falloff: 0.12 });
      }
    }
  }
  const r = rng(doc.ground.seed ^ 0x1234567);
  const area = polygonArea(top);
  for (const s of g.scatterStamps ?? []) {
    const count = Math.round((area / 10000) * s.per100cm2) + (r() < ((area / 10000) * s.per100cm2) % 1 ? 1 : 0);
    const st = proceduralStamp(s.stamp, doc.ground.seed + 17);
    const b = polygonBounds(top);
    for (let i = 0; i < count; i++) {
      const size = s.size[0] + r() * (s.size[1] - s.size[0]);
      applyStamp(hf, st, { x: b.min[0] + r() * (b.max[0] - b.min[0]), y: b.min[1] + r() * (b.max[1] - b.min[1]), size, strength: s.strength * tex, rotDeg: r() * 360, falloff: 0.35, mode: s.mode ?? 'add' });
    }
  }
  for (const s of doc.ground.stamps) applyStamp(hf, proceduralStamp(s.stamp as StampId, doc.ground.seed), { x: s.x, y: s.y, size: s.size, strength: s.strength, rotDeg: s.rotDeg, falloff: 0.3 });
  for (const s of doc.ground.strokes) brush(hf, s);
  // the ground sits on the plate: lowest point at the lip, relief capped, foot zones flat, edge tapered
  settleFloor(hf, plate + RIM_LIP);
  clampHeights(hf, plate + RIM_LIP, plate + RIM_LIP + preset.ground.reliefCap * Math.max(1, rough) + 6);
  for (const fz of doc.rules.footZones) flattenDisc(hf, fz.x, fz.y, fz.r, plate + RIM_LIP + 0.15, 1.5);
  rimTaper(hf, insetConvex(top, 0.3), RIM_TAPER, plate + RIM_LIP);
  return hf;
}

/** Sample spacing for a live preview: at most ~300 samples along the longer side. */
export function previewCell(doc: StudioDocument): number {
  const { w, d } = boardShape(doc.board);
  return Math.max(suggestedCell(w, d), Math.max(w, d) / 300);
}

/** Height cap for the board: the user's override, else the preset's, limited by board size. */
export function effectiveHeightCap(doc: StudioDocument): number {
  const preset = genrePreset(doc.ground.presetId);
  const { w, d } = doc.board.shape;
  return doc.rules.heightCap ?? Math.min(preset.heightCap, defaultHeightCap(Math.min(w, d)));
}

/**
 * The library items the preset would scatter, with their pick weights: the
 * preset's weight for a family is shared among the items of that family, and the
 * item's own `weight` multiplies it. Items tagged 'any' are picked by every
 * preset (they get the average family weight). If no item matches the preset, the
 * whole library is used rather than scattering nothing.
 */
export function scatterPool(doc: StudioDocument, source: PropSource): (ScatterAsset & { item: StudioLibraryItem })[] {
  const preset = genrePreset(doc.ground.presetId);
  const usable = (doc.library ?? []).filter((it) => source.get(it.id) !== null);
  const weightOf = new Map(preset.families.map((f) => [f.family as string, f.weight]));
  const mean = preset.families.length ? preset.families.reduce((a, f) => a + f.weight, 0) / preset.families.length : 1;
  const matches = (it: StudioLibraryItem) => it.family === 'any' || weightOf.has(it.family);
  let pool = usable.filter(matches);
  if (pool.length === 0) pool = usable;
  const perFamily = new Map<string, number>();
  for (const it of pool) perFamily.set(it.family, (perFamily.get(it.family) ?? 0) + 1);
  const out: (ScatterAsset & { item: StudioLibraryItem })[] = [];
  for (const it of pool) {
    const prop = source.get(it.id);
    if (!prop || prop.footprintRadius <= 0) continue;
    const share = (weightOf.get(it.family) ?? mean) / (perFamily.get(it.family) ?? 1);
    out.push({
      id: it.id,
      footprintRadius: prop.footprintRadius,
      height: prop.height,
      weight: Math.max(0.001, share * (it.weight ?? 1)),
      scale: PROP_SCALE_RANGE,
      item: it,
    });
  }
  return out;
}

/**
 * Re-roll the scattered props from the scene's own STL library (hand-placed
 * props are kept and act as keep-outs). An empty library scatters nothing: the
 * ground is generated, the props are the user's.
 */
export function scatterScene(doc: StudioDocument, source: PropSource): StudioProp[] {
  const { top } = boardPolygons(doc);
  const kept = doc.props.filter((p) => !p.scattered);
  const assets = scatterPool(doc, source);
  if (assets.length === 0) return kept;
  const keepOut = kept.map((p) => {
    const a = source.get(p.assetId);
    return { x: p.x, y: p.y, r: (a?.footprintRadius ?? 3) * p.scale };
  });
  const placements = scatter(top, assets, {
    rimInset: doc.rules.rimInset + (doc.board.margin ?? 0),
    footZones: doc.rules.footZones,
    keepOut,
    density: DENSITY_PRESETS[doc.rules.density] ?? DENSITY_PRESETS.medium,
    heightCap: effectiveHeightCap(doc),
    sink: doc.rules.sink,
    heroMinSize: doc.rules.heroProps ? 40 : 0,
    seed: doc.scatterSeed,
  });
  const r = rng(doc.scatterSeed ^ 0x77);
  const out: StudioProp[] = [...kept];
  for (const pl of placements) {
    const asset = assets.find((a) => a.id === pl.assetId);
    out.push({
      id: 'sp' + Math.floor(r() * 1e9).toString(36) + out.length.toString(36),
      assetId: pl.assetId,
      x: pl.x,
      y: pl.y,
      rotDeg: pl.rotDeg,
      scale: pl.scale,
      sink: 0,
      seed: Math.floor(r() * 1e9),
      // the licence is the user's own tag on the library item: only the commercial export cares
      licence: asset?.item.licence ?? 'unknown',
      scattered: true,
      hero: pl.hero,
    });
  }
  return out;
}

/**
 * Props the height cap had to shrink a long way: the user's STL is too tall for
 * this board, and they should know rather than wonder why it came out small.
 */
export function heightCapWarnings(doc: StudioDocument): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of doc.props) {
    // only the scatter's own scaling is the height cap's doing; a hand-placed size is the user's
    if (!p.scattered || p.scale >= TOO_TALL_SCALE || seen.has(p.assetId)) continue;
    seen.add(p.assetId);
    const item = (doc.library ?? []).find((it) => it.id === p.assetId);
    const name = item?.name ?? 'A prop';
    out.push(`${name} is too tall for this board: it was shrunk to ${Math.round(p.scale * 100)}% to stay under ${Math.round(effectiveHeightCap(doc) * 10) / 10} mm. Use a shorter prop or raise "Tallest prop".`);
  }
  return out;
}

/**
 * A prop after it has been dropped onto the ground: the moved triangles, and
 * where the prop's own origin ended up. The UI needs that origin to draw a
 * selected prop and hang a drag handle on it.
 */
export interface PlacedProp {
  soup: Soup;
  /** the prop's origin in scene mm: x and y are the user's, z is whatever the drop worked out */
  x: number;
  y: number;
  z: number;
}

/**
 * Put a prop on the ground: scale it, turn it, lean it with the slope, then
 * DROP it until it touches.
 *
 * The old version read the ground height under the prop's centre only, which
 * left a wide prop, a prop on a slope and a prop with an uneven underside
 * hanging in the air on one side. Here every point of the prop is measured
 * against the ground under it and the whole prop is lowered until its closest
 * point is `sink` mm inside the ground — so something always touches, and
 * nothing floats. Off the board the ground counts as the plate top (lower than
 * any ground), so a prop hanging over the edge still rests on the part that is
 * over the board instead of being pushed up by thin air.
 */
export function placeProp(prop: Prop, p: StudioProp, hf: Heightfield, sinkDefault: number, plateTop: number): PlacedProp {
  const n = sampleNormal(hf, p.x, p.y);
  const sink = Math.min(sinkDefault + p.sink, prop.height * p.scale * 0.4);
  const yaw = (p.rotDeg * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // lean: rotate z-up onto the ground normal (limited to 25° so tall props do not topple)
  const tilt = Math.min(Math.acos(Math.max(-1, Math.min(1, n[2]))), (25 * Math.PI) / 180);
  const ax = n[1], ay = -n[0]; // rotation axis = z × n
  const al = Math.hypot(ax, ay) || 1;
  const kx = ax / al, ky = ay / al;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const hw = hf.w / 2 + 1e-9, hd = hf.d / 2 + 1e-9;
  const src = prop.soup.positions;
  const n9 = prop.soup.triCount * 9;
  const out = new Float32Array(n9);
  // pass 1: place x/y and keep z relative to the prop's own origin, measuring the
  // smallest gap to the ground and the lowest point as we go
  let minGap = Infinity, minZ = Infinity;
  for (let i = 0; i < n9; i += 3) {
    let x = src[i] * p.scale, y = src[i + 1] * p.scale;
    const z = src[i + 2] * p.scale;
    // turn
    const rx = x * cy - y * sy, ry = x * sy + y * cy;
    x = rx; y = ry;
    // lean about (kx, ky, 0) by Rodrigues
    const dot = kx * x + ky * y;
    const cxv = ky * z, cyv = -kx * z, czv = kx * y - ky * x; // k × v
    const tx = x * ct + cxv * st + kx * dot * (1 - ct) + p.x;
    const ty = y * ct + cyv * st + ky * dot * (1 - ct) + p.y;
    const tz = z * ct + czv * st;
    out[i] = tx;
    out[i + 1] = ty;
    out[i + 2] = tz;
    const ground = tx >= -hw && tx <= hw && ty >= -hd && ty <= hd ? sampleHeight(hf, tx, ty) : plateTop;
    const gap = tz - ground;
    if (gap < minGap) minGap = gap;
    if (tz < minZ) minZ = tz;
  }
  if (!Number.isFinite(minGap)) return { soup: { positions: out, triCount: prop.soup.triCount }, x: p.x, y: p.y, z: plateTop };
  // drop until the closest point is `sink` inside the ground…
  let z0 = -sink - minGap;
  // …but nothing may reach below the underside of the ground, whatever the bedding or lean did
  const floor = plateTop - 0.1 + 0.02;
  if (minZ + z0 < floor) z0 = floor - minZ;
  for (let i = 2; i < n9; i += 3) out[i] += z0;
  return { soup: { positions: out, triCount: prop.soup.triCount }, x: p.x, y: p.y, z: z0 };
}

export interface BakeResult {
  prepared: PreparedSource;
  heightfield: Heightfield;
  /** props whose STL was missing, props the height cap had to shrink a long way, and source warnings */
  warnings: string[];
  propCount: number;
  timings: Record<string, number>;
}

/** The whole scene as a two-shell source. */
export function bakeStudio(doc: StudioDocument, source: PropSource, name = doc.name): BakeResult {
  const t0 = now();
  const timings: Record<string, number> = {};
  const warnings: string[] = [...heightCapWarnings(doc)];
  const { bottom } = boardPolygons(doc);
  const plate = doc.board.plateTop;
  const hf = buildGround(doc);
  timings.ground = now() - t0;
  let t1 = now();
  const slab = heightfieldToSlab(hf, { zBase: plate - 0.1, clipTo: groundClip(doc) });
  timings.slab = now() - t1;
  t1 = now();
  const shells: Soup[] = [slab];
  let placed = 0;
  for (const p of doc.props) {
    const prop: Prop | null = source.get(p.assetId);
    if (!prop) {
      const item = (doc.library ?? []).find((it) => it.id === p.assetId);
      warnings.push(item ? `${item.name}: the STL is not loaded, so it was left out (add ${item.fileName} again)` : `a prop that is no longer in the library was left out`);
      continue;
    }
    shells.push(placeProp(prop, p, hf, doc.rules.sink, plate).soup);
    placed++;
  }
  timings.props = now() - t1;
  t1 = now();
  const prepared = buildPreparedSourceFromMesh({
    name,
    nominal: boardShape(doc.board),
    bottom,
    topScale: doc.board.topScale,
    plateTop: plate,
    sculpt: shells,
  });
  timings.prepare = now() - t1;
  warnings.push(...prepared.warnings);
  return { prepared, heightfield: hf, warnings, propCount: placed, timings };
}

/** Quick sanity used by tests and the smoke path: every shell we made is closed. */
export function shellsAreClosed(shells: Soup[]): boolean {
  return shells.every((s) => isWatertight(s));
}

/** Lowest/highest point of a placed scene, mm. */
export function sceneHeight(prepared: PreparedSource): Vec3 {
  const b = prepared.stats.bounds;
  return [b.min[2], b.max[2], b.max[2] - b.min[2]];
}

export { boundsOfSoup, SoupBuilder };
