/**
 * Turn a Base Studio document into geometry: the ground heightfield, the
 * scattered props, and finally a `PreparedSource` the cutter consumes. Pure
 * kernel code; the worker calls it and the UI never touches the meshes.
 */
import type { Polygon2, Soup, Vec3 } from '../types';
import { SoupBuilder } from '../types';
import { shapePolygon } from '../geom2d/shapes';
import { insetConvex } from '../geom2d/offset';
import { polygonArea, polygonBounds, polygonCentroid, scalePolygonAbout } from '../geom2d/polygon';
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
import { buildParametric, PARAMETRIC_CATALOG } from '../props/parametric';
import type { ParametricKind, Prop } from '../props/parametric';
import { buildPreparedSourceFromMesh } from '../source/fromMesh';
import type { PreparedSource } from '../source/prepareSource';
import { boardShape } from './document';
import type { StudioDocument, StudioProp } from './document';

/** The sculpt (and its slab) must sit inside the plate top like the OPR sets do. */
const RIM_TAPER = 1.5;
/** Ground lip above the plate top at the rim, mm. */
const RIM_LIP = 0.05;

export interface PropSource {
  /** bundled or imported assets by id: closed soup in local frame (bottom at z = 0) + footprint */
  get(assetId: string): Prop | null;
  /** asset ids of a family ('rock', 'debris', ...), for the scatter pool */
  byFamily(family: string): string[];
}

/** A source with nothing in it: parametric props only. */
export const NO_ASSETS: PropSource = { get: () => null, byFamily: () => [] };

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Footprint polygons of the board: bottom (plate) and top (where the sculpt lives). */
export function boardPolygons(doc: StudioDocument): { bottom: Polygon2; top: Polygon2 } {
  const bottom = shapePolygon(boardShape(doc.board), 0, 0, 0);
  const c = polygonCentroid(bottom);
  const top = scalePolygonAbout(bottom, doc.board.topScale[0], doc.board.topScale[1], c[0], c[1]);
  return { bottom, top };
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

function paramAsset(kind: string, params: Record<string, number> | undefined, seed: number): ScatterAsset | null {
  const entry = PARAMETRIC_CATALOG.find((c) => c.kind === kind);
  if (!entry) return null;
  const prop = buildParametric({ kind: kind as ParametricKind, params: { ...entry.defaults, ...(params ?? {}) }, seed });
  return { id: 'param:' + kind, footprintRadius: prop.footprintRadius, height: prop.height };
}

/**
 * Re-roll the scattered props from the preset (hand-placed props are kept and
 * act as keep-outs). Returns the new prop list.
 */
export function scatterScene(doc: StudioDocument, source: PropSource): StudioProp[] {
  const preset = genrePreset(doc.ground.presetId);
  const { top } = boardPolygons(doc);
  const kept = doc.props.filter((p) => !p.scattered);
  const assets: (ScatterAsset & { params?: Record<string, number> })[] = [];
  for (const p of preset.parametric) {
    const a = paramAsset(p.kind, p.params, doc.scatterSeed);
    if (a) assets.push({ ...a, weight: p.weight, params: p.params });
  }
  // bundled pack assets of the preset's families join the pool, sharing the family's weight
  for (const fam of preset.families) {
    const ids = source.byFamily(fam.family);
    for (const id of ids) {
      const a = source.get(id);
      if (a) assets.push({ id, footprintRadius: a.footprintRadius, height: a.height, weight: fam.weight / ids.length, scale: [0.7, 1.3] });
    }
  }
  if (assets.length === 0) return kept;
  const keepOut = kept.map((p) => {
    const a = p.assetId.startsWith('param:') ? paramAsset(p.assetId.slice(6), p.params, p.seed) : source.get(p.assetId);
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
      params: asset?.params,
      x: pl.x,
      y: pl.y,
      rotDeg: pl.rotDeg,
      scale: pl.scale,
      sink: 0,
      seed: Math.floor(r() * 1e9),
      licence: pl.assetId.startsWith('param:') ? 'own-rights' : 'cc0',
      // pack assets are CC0 by construction of the core pack; imports set their own tag when placed by hand
      scattered: true,
      hero: pl.hero,
    });
  }
  return out;
}

/** Place a prop's soup on the ground: scale, yaw, tilt to the ground normal, sink. */
export function placeProp(prop: Prop, p: StudioProp, hf: Heightfield, sinkDefault: number, plateTop: number): Soup {
  const z0 = sampleHeight(hf, p.x, p.y);
  const n = sampleNormal(hf, p.x, p.y);
  const sink = Math.min(sinkDefault + p.sink, prop.height * p.scale * 0.4);
  const zBottom = z0 - sink; // the prop's ground line; its bedded part goes below this
  const yaw = (p.rotDeg * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // tilt: rotate z-up onto the ground normal (limited to 25° so tall props do not topple)
  const tilt = Math.min(Math.acos(Math.max(-1, Math.min(1, n[2]))), (25 * Math.PI) / 180);
  const ax = n[1], ay = -n[0]; // rotation axis = z × n
  const al = Math.hypot(ax, ay) || 1;
  const kx = ax / al, ky = ay / al;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const src = prop.soup.positions;
  const n9 = prop.soup.triCount * 9;
  const out = new Float32Array(n9);
  let minZ = Infinity;
  for (let i = 0; i < n9; i += 3) {
    let x = src[i] * p.scale, y = src[i + 1] * p.scale, z = src[i + 2] * p.scale;
    // yaw
    const rx = x * cy - y * sy, ry = x * sy + y * cy;
    x = rx; y = ry;
    // tilt about (kx, ky, 0) by Rodrigues
    const dot = kx * x + ky * y;
    const cxv = ky * z, cyv = -kx * z, czv = kx * y - ky * x; // k × v
    const tx = x * ct + cxv * st + kx * dot * (1 - ct);
    const ty = y * ct + cyv * st + ky * dot * (1 - ct);
    const tz = z * ct + czv * st;
    out[i] = tx + p.x;
    out[i + 1] = ty + p.y;
    out[i + 2] = tz + zBottom;
    if (out[i + 2] < minZ) minZ = out[i + 2];
  }
  // nothing may reach below the slab's underside (plateTop - 0.1), whatever the bedding or tilt did
  const floor = plateTop - 0.1 + 0.02;
  if (minZ < floor) {
    const lift = floor - minZ;
    for (let i = 2; i < n9; i += 3) out[i] += lift;
  }
  return { positions: out, triCount: prop.soup.triCount };
}

export interface BakeResult {
  prepared: PreparedSource;
  heightfield: Heightfield;
  /** props that could not be built (unknown asset) or were dropped as unprintable */
  warnings: string[];
  propCount: number;
  timings: Record<string, number>;
}

/** The whole scene as a two-shell source. */
export function bakeStudio(doc: StudioDocument, source: PropSource, name = doc.name): BakeResult {
  const t0 = now();
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const { bottom, top } = boardPolygons(doc);
  const plate = doc.board.plateTop;
  const hf = buildGround(doc);
  timings.ground = now() - t0;
  let t1 = now();
  const clip = doc.board.shape.kind === 'rect' ? undefined : insetConvex(top, 0.3);
  const slab = heightfieldToSlab(hf, { zBase: plate - 0.1, clipTo: clip });
  timings.slab = now() - t1;
  t1 = now();
  const shells: Soup[] = [slab];
  let placed = 0;
  for (const p of doc.props) {
    let prop: Prop | null = null;
    if (p.assetId.startsWith('param:')) {
      const kind = p.assetId.slice(6) as ParametricKind;
      const entry = PARAMETRIC_CATALOG.find((c) => c.kind === kind);
      if (entry) prop = buildParametric({ kind, params: { ...entry.defaults, ...(p.params ?? {}) }, seed: p.seed });
    } else prop = source.get(p.assetId);
    if (!prop) { warnings.push(`unknown prop ${p.assetId} skipped`); continue; }
    const soup = placeProp(prop, p, hf, doc.rules.sink, plate);
    shells.push(soup);
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
