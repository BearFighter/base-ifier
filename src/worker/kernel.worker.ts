/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { MAKER_MARK, MAKER_MARK_HEIGHT } from '../kernel/body/hollow';
import type { HollowSpec } from '../kernel/body/hollow';
import { bakeStudio as bakeStudioScene, buildGround, groundClip, heightCapWarnings, placeProp, previewCell, scatterScene } from '../kernel/studio/bake';
import type { PropSource } from '../kernel/studio/bake';
import { heightfieldToSlab } from '../kernel/terrain/mesh';
import type { Prop } from '../kernel/props/prop';
import { groundSoup } from '../kernel/mesh/ground';
import { weld } from '../kernel/mesh/weld';
import { manifoldReport } from '../kernel/mesh/validate';
import { concatSoups } from '../kernel/types';
import type { StudioDocument } from '../kernel/studio/document';
import type { StudioAssetInfo, StudioAssetTransfer, StudioPlacement, StudioPreviewTransfer, StudioPropRange } from './api';
import { presupport, autoTiltDeg, densitySpacing } from '../kernel/pipeline/presupport';
import type { ExportablePiece } from '../kernel/pipeline/exportPiece';
import { zipSync } from 'fflate';
import type { Soup, Vec2 } from '@/kernel/types';
import { tightSoup } from '@/kernel/types';
import { readStl } from '@/kernel/stl/read';
import { prepareSource, type PreparedSource } from '@/kernel/source/prepareSource';
import { computePiece, meshToSoup, rootPieceParams, sourceFrame, type ParentFrame, type PieceResult, type TrayParams } from '@/kernel/pipeline/computePiece';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { materialThickness, socketFor } from '@/kernel/pipeline/plug';
import type { SocketSpec } from '@/kernel/pipeline/plug';
import { shapePolygon } from '@/kernel/geom2d/shapes';
import { trayPocket, TRAY_MIN_WALL } from '@/kernel/tray/cells';
import { MIN_CEILING } from '@/kernel/body/hollow';
import { autoMagnetPositions } from '@/kernel/pipeline/autoMagnets';
import { pieceToStl, plateToStl } from '@/kernel/pipeline/exportPiece';
import { decimateForDisplay, decimateSoup } from '@/kernel/mesh/decimate';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import type { ColumnInfo, ComputeRequest, ExportItem, KernelApi, MeshTransfer, PieceChainNode, PieceGeometryTransfer, SocketRequest, SourceSummary, TrayRequest } from './api';

interface SourceEntry {
  prepared: PreparedSource;
  /** cached simplified preview of the whole sculpt */
  preview?: { positions: Float32Array; indices: Uint32Array; triCount: number; fullTriCount: number };
  /** cached outline-only results per chain hash (frames for children) */
  cache: Map<string, { result: PieceResult; sizingKey: string }>;
  /** small LRU of full results (with sculpt) keyed by chain + magnets + sizing */
  full: Map<string, PieceResult>;
  stamp: { arr: Uint32Array; id: number };
}

const FULL_CACHE_SIZE = 6;

const sources = new Map<string, SourceEntry>();

/**
 * Cache key of a chain. `n.tray` MUST be in here: moving one base inside a frame
 * changes nothing about the frame's or the scene's node, but it does change the
 * tray's slots, and without it the LRU would hand back a stale tray that looks
 * exactly like a geometry bug.
 */
function chainKey(chain: PieceChainNode[], upto: number): string {
  return JSON.stringify(chain.slice(0, upto + 1).map((n) => [n.shape, n.xy, n.rotDeg, n.edges, n.profile ?? null, n.role ?? 'base', n.cut ?? 'full', n.plugDepth ?? null, n.plugClearance ?? null, n.sockets ?? null, n.tray ?? null]));
}

function sizingKey(req: ComputeRequest): string {
  return JSON.stringify([req.sizing?.scale ?? 1, req.sizing?.clearance ?? 0]);
}

/** Resolve the parent frame of the last node by walking the chain (cached). */
function resolveParentFrame(entry: SourceEntry, chain: PieceChainNode[]): ParentFrame {
  const src = entry.prepared;
  let frame = sourceFrame(src);
  for (let i = 0; i < chain.length - 1; i++) {
    const key = chainKey(chain, i);
    let cached = entry.cache.get(key);
    if (!cached) {
      const node = chain[i];
      const params = i === 0 ? rootPieceParams(src) : paramsFor(src, frame, node);
      const result = computePiece(frame, params, { source: src, skipSculpt: true, stamp: entry.stamp });
      cached = { result, sizingKey: '' };
      entry.cache.set(key, cached);
    }
    frame = cached.result.frame;
  }
  return frame;
}

/** Piece params for a chain node, with plug sockets and tray slots resolved to source-frame polygons. */
function paramsFor(src: PreparedSource, frame: ParentFrame, node: PieceChainNode, hollow?: ComputeRequest['underside']) {
  const sockets: SocketSpec[] = [];
  for (const sk of node.sockets ?? []) sockets.push(resolveSocket(src, frame, sk, hollow));
  return { shape: node.shape, xy: node.xy, rotDeg: node.rotDeg, edges: node.edges, profile: node.profile, role: node.role, cut: node.cut, plugDepth: node.plugDepth, plugClearance: node.plugClearance, sockets, tray: node.tray ? resolveTray(frame, node.tray) : undefined };
}

/** A TrayRequest as the kernel wants it: slot openings and magnet holes in the source frame. */
function resolveTray(frame: ParentFrame, req: TrayRequest): TrayParams {
  const pockets = req.slots.map((s) => trayPocket(s.shape, frame.origin[0] + s.xy[0], frame.origin[1] + s.xy[1], s.rotDeg, req.gap));
  const magnets = req.magnets
    ? magnetSlotSpecs(req.magnets.sizing, req.magnets.at.map(([x, y]) => ({ x: frame.origin[0] + x, y: frame.origin[1] + y })))
    : undefined;
  return {
    floor: req.floor,
    plateHeight: req.plateHeight,
    pockets,
    magnets,
    magnetFloorMin: req.magnets?.floorMin,
    gap: req.gap,
    minWall: TRAY_MIN_WALL,
    watermark: MAKER_MARK,
    watermarkHeight: MAKER_MARK_HEIGHT,
    underside: req.underside,
    mixedHeights: req.mixedHeights,
  };
}

function resolveSocket(src: PreparedSource, frame: ParentFrame, sk: SocketRequest, hollow?: ComputeRequest['underside']): SocketSpec {
  const poly = shapePolygon(sk.shape, frame.origin[0] + sk.xy[0], frame.origin[1] + sk.xy[1], sk.rotDeg);
  const depth = Math.max(hollow ? hollow.depth + MIN_CEILING : 1, sk.plugDepth);
  const bottomZ = src.mode === 'generic' ? 0 : src.sculptTrimZ;
  const d = socketFor(src.sculpt, src.bins, poly, { plug: sk.plug, depth, clearance: sk.clearance, bottomZ });
  return { poly: d.poly, floorZ: d.floorZ, backing: d.backing };
}

function toMesh(soup: Soup): MeshTransfer {
  const t = tightSoup(soup);
  return { positions: t.positions, triCount: t.triCount };
}

/** Soup for export: materialise the root's indexed sculpt on demand. */
function exportSculpt(r: PieceResult): Soup {
  return r.sculptMesh ? meshToSoup(r.sculptMesh) : r.sculpt;
}

function compute(req: ComputeRequest): PieceResult {
  const entry = sources.get(req.sourceId);
  if (!entry) throw new Error('Unknown source ' + req.sourceId);
  const src = entry.prepared;
  const chain = req.chain;
  if (chain.length === 0) throw new Error('Empty piece chain');
  const fullKey = req.skipSculpt ? null : chainKey(chain, chain.length - 1) + '|' + JSON.stringify(req.magnets ?? null) + '|' + sizingKey(req) + '|' + JSON.stringify(req.underside ?? null);
  if (fullKey) {
    const hit = entry.full.get(fullKey);
    if (hit) {
      // refresh LRU order
      entry.full.delete(fullKey);
      entry.full.set(fullKey, hit);
      return hit;
    }
  }
  const frame = resolveParentFrame(entry, chain);
  const last = chain[chain.length - 1];
  const params = chain.length === 1 ? rootPieceParams(src) : paramsFor(src, frame, last, req.underside);
  const magnetSlots = req.magnets ? magnetSlotSpecs(req.magnets.sizing, req.magnets.slots) : [];
  entry.stamp.id++;
  const result = computePiece(frame, params, {
    source: src,
    magnetSlots,
    magnetCheck: req.magnets?.check,
    scale: req.sizing?.scale ?? 1,
    clearance: req.sizing?.clearance ?? 0,
    skipSculpt: req.skipSculpt,
    stamp: entry.stamp,
    hollow: withMakerMark(req.underside),
    mark: MAKER_MARK,
  });
  if (fullKey) {
    entry.full.set(fullKey, result);
    while (entry.full.size > FULL_CACHE_SIZE) {
      const oldest = entry.full.keys().next().value;
      if (oldest === undefined) break;
      entry.full.delete(oldest);
    }
  }
  return result;
}

/** The renderer-side description of a prepared source (also used for studio bakes). */
function summarize(id: string, name: string, prepared: PreparedSource): SourceSummary {
    const summary: SourceSummary = {
      id,
      name,
      nominal: prepared.nominal,
      measuredScale: prepared.measuredScale,
      mode: prepared.mode,
      outline: {
        bottom: prepared.outline.bottom,
        top: prepared.outline.top,
        plateTop: prepared.outline.plateTop,
        topScale: prepared.outline.topScale,
      },
      stats: {
        tris: prepared.stats.tris,
        bodyTris: prepared.stats.bodyTris,
        sculptTris: prepared.stats.sculptTris,
        components: prepared.stats.components,
        nonManifoldEdges: prepared.stats.nonManifoldEdges,
        boundaryEdges: prepared.stats.boundaryEdges,
        bounds: prepared.stats.bounds,
      },
      warnings: prepared.warnings,
      timings: prepared.timings,
    };
    return summary;
}

/**
 * Base Studio prop geometry: the user's own STLs, parsed once per worker and
 * keyed by library item id. Metadata (family, licence, weight) is NOT here — it
 * lives on the document, which travels with every studio call.
 */
const studioAssets = new Map<string, { prop: Prop; preview: Prop }>();
const propSource: PropSource = { get: (id) => studioAssets.get(id)?.prop ?? null };
/** Same pool, but heavy props simplified: the studio viewport redraws on every edit. */
const previewSource: PropSource = { get: (id) => studioAssets.get(id)?.preview ?? null };

/** Props over this many triangles are simplified for the live preview (exports use the full mesh). */
const PROP_PREVIEW_LIMIT = 150_000;

/** A display-only copy of a heavy prop, simplified on a grid fine enough to keep its silhouette. */
function previewProp(prop: Prop): Prop {
  if (prop.soup.triCount <= PROP_PREVIEW_LIMIT) return prop;
  const size = Math.max(prop.height, prop.footprintRadius * 2, 1);
  const cell = Math.max(0.05, size / 150);
  const simplified = meshToSoup(decimateSoup(prop.soup, cell).mesh);
  return { ...prop, soup: simplified };
}

/** The hollow underside to build, always with the maker mark (never taken from the request). */
function withMakerMark(u: ComputeRequest['underside']): HollowSpec | undefined {
  return u ? { depth: u.depth, rim: u.rim, ringHeight: u.ringHeight, ringWidth: u.ringWidth, watermark: MAKER_MARK, watermarkHeight: MAKER_MARK_HEIGHT } : undefined;
}

const api: KernelApi = {
  async loadSource(id, name, buffer, opts, onProgress) {
    const t0 = performance.now();
    const raw = readStl(buffer);
    const tRead = performance.now() - t0;
    const prepared = prepareSource(raw, name, { nominal: opts?.nominal, onProgress: onProgress ? (stage, fraction) => { void onProgress(stage, fraction); } : undefined });
    prepared.timings.read = tRead;
    sources.set(id, { prepared, cache: new Map(), full: new Map(), stamp: { arr: new Uint32Array(prepared.sculpt.triCount), id: 0 } });
    return summarize(id, name, prepared);
  },

  async registerStudioAssets(assets) {
    const out: StudioAssetInfo[] = [];
    for (const a of assets) {
      try {
        const soup = readStl(a.stl);
        const g = groundSoup(soup);
        // an open shell slices unpredictably, so it is reported but never placed
        const closed = manifoldReport(weld(soup)).boundaryEdges === 0;
        const prop: Prop = { soup, footprintRadius: g.footprintRadius, height: g.height, underground: 0 };
        if (closed) studioAssets.set(a.id, { prop, preview: previewProp(prop) });
        out.push({ id: a.id, name: a.name, footprintRadius: g.footprintRadius, height: g.height, tris: soup.triCount, closed, heavy: soup.triCount > PROP_PREVIEW_LIMIT });
      } catch (err) {
        out.push({ id: a.id, name: a.name, footprintRadius: 0, height: 0, tris: 0, closed: false, heavy: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  },

  async unregisterStudioAssets(ids) {
    for (const id of ids) studioAssets.delete(id);
  },

  async scatterStudio(doc) {
    return scatterScene(doc, propSource);
  },

  async previewStudio(doc) {
    const t0 = performance.now();
    const hf = buildGround(doc, previewCell(doc));
    const tGround = performance.now() - t0;
    // the same cut as the finished scene, or a round board would show as a square (groundClip)
    const clip = groundClip(doc);
    const slab = heightfieldToSlab(hf, { zBase: doc.board.plateTop - 0.1, clipTo: clip });
    const warnings: string[] = [...heightCapWarnings(doc)];
    const missing = new Set<string>();
    const propSoups = [];
    const propRanges: StudioPropRange[] = [];
    const placements: StudioPlacement[] = [];
    let tri = 0;
    for (const p of doc.props) {
      const prop = previewSource.get(p.assetId);
      if (!prop) {
        if (!missing.has(p.assetId)) {
          missing.add(p.assetId);
          const item = doc.library?.find((it) => it.id === p.assetId);
          warnings.push(item ? `${item.name}: the STL is not loaded, so it is not shown (add ${item.fileName} again)` : 'a prop that is no longer in the library is not shown');
        }
        continue;
      }
      const placed = placeProp(prop, p, hf, doc.rules.sink, doc.board.plateTop, clip);
      propSoups.push(placed.soup);
      propRanges.push({ id: p.id, start: tri, count: placed.soup.triCount });
      placements.push({ id: p.id, x: placed.x, y: placed.y, z: placed.z, rotDeg: p.rotDeg, scale: p.scale });
      tri += placed.soup.triCount;
    }
    const props = propSoups.length ? concatSoups(propSoups) : { positions: new Float32Array(0), triCount: 0 };
    const all = concatSoups([slab, props]);
    const bounds = boundsOfSoup(all);
    const ground: MeshTransfer = { positions: slab.positions.slice(0, slab.triCount * 9), triCount: slab.triCount };
    const propsT: MeshTransfer = { positions: props.positions.slice(0, props.triCount * 9), triCount: props.triCount };
    const out: StudioPreviewTransfer = { ground, props: propsT, propRanges, placements, bounds, propCount: propSoups.length, warnings, timings: { ground: tGround, total: performance.now() - t0 } };
    return Comlink.transfer(out, [ground.positions.buffer as ArrayBuffer, propsT.positions.buffer as ArrayBuffer]);
  },

  async bakeStudio(id, doc) {
    const res = bakeStudioScene(doc, propSource, doc.name);
    const prepared = res.prepared;
    prepared.warnings.push(...res.warnings.filter((w) => !prepared.warnings.includes(w)));
    prepared.timings.bake = res.timings.ground + res.timings.slab + res.timings.props;
    sources.set(id, { prepared, cache: new Map(), full: new Map(), stamp: { arr: new Uint32Array(prepared.sculpt.triCount), id: 0 } });
    return summarize(id, doc.name, prepared);
  },



  async unloadSource(id) {
    sources.delete(id);
  },

  async computePiece(req) {
    const r = compute(req);
    const last = req.chain[req.chain.length - 1];
    // results may be served again from the cache, so always hand out copies
    const body: MeshTransfer = { positions: r.body.positions.slice(0, r.body.triCount * 9), triCount: r.body.triCount };
    const transfers: ArrayBuffer[] = [body.positions.buffer as ArrayBuffer];
    let sculpt: MeshTransfer;
    const limit = req.previewLimit ?? 600_000;
    const entry = sources.get(req.sourceId)!;
    if (r.sculptMesh) {
      if (limit > 0 && r.sculptMesh.triCount > limit) {
        // whole-base preview: simplify once and cache
        if (!entry.preview) {
          const d = decimateForDisplay(r.sculptMesh, Math.round(limit * 0.6));
          entry.preview = { positions: d.mesh.vertices, indices: d.mesh.indices, triCount: d.mesh.triCount, fullTriCount: r.sculptMesh.triCount };
        }
        const pv = entry.preview;
        const positions = pv.positions.slice(), indices = pv.indices.slice();
        sculpt = { positions, indices, triCount: pv.triCount, simplified: true, fullTriCount: pv.fullTriCount };
        transfers.push(positions.buffer as ArrayBuffer, indices.buffer as ArrayBuffer);
      } else {
        // copy: the worker keeps its own indexed sculpt
        const positions = r.sculptMesh.vertices.slice(0, r.sculptMesh.vertexCount * 3);
        const indices = r.sculptMesh.indices.slice(0, r.sculptMesh.triCount * 3);
        sculpt = { positions, indices, triCount: r.sculptMesh.triCount };
        transfers.push(positions.buffer as ArrayBuffer, indices.buffer as ArrayBuffer);
      }
    } else if (limit > 0 && r.sculpt.triCount > limit) {
      const d = decimateForDisplay(r.sculpt, Math.round(limit * 0.6));
      sculpt = { positions: d.mesh.vertices, indices: d.mesh.indices, triCount: d.mesh.triCount, simplified: true, fullTriCount: r.sculpt.triCount };
      transfers.push(d.mesh.vertices.buffer as ArrayBuffer, d.mesh.indices.buffer as ArrayBuffer);
    } else {
      sculpt = { positions: r.sculpt.positions.slice(0, r.sculpt.triCount * 9), triCount: r.sculpt.triCount };
      transfers.push(sculpt.positions.buffer as ArrayBuffer);
    }
    const out: PieceGeometryTransfer = {
      pieceId: last.id,
      origin: r.origin,
      size: r.size,
      outline: r.outline,
      frameOutline: r.frame.outline,
      body,
      sculpt,
      hasSculpt: !req.skipSculpt,
      carved: r.carved,
      tray: r.tray
        ? { floor: r.tray.floor, floorAsked: r.tray.floorAsked, plateHeight: r.tray.plateHeight, magnetMode: r.tray.magnetMode, magnetFloorWanted: r.tray.magnetFloorWanted, thinSpan: r.tray.thinSpan, cells: r.tray.cells, watermark: r.tray.watermark }
        : undefined,
      warnings: r.warnings,
      bodyVolume: r.bodyVolume,
      bounds: r.bounds,
      timings: r.timings,
    };
    return Comlink.transfer(out, transfers);
  },

  async columnInfo(req): Promise<ColumnInfo | null> {
    const entry = sources.get(req.sourceId);
    if (!entry || req.chain.length < 2) return null;
    const src = entry.prepared;
    const frame = resolveParentFrame(entry, req.chain);
    const last = req.chain[req.chain.length - 1];
    const poly = shapePolygon(last.shape, frame.origin[0] + last.xy[0], frame.origin[1] + last.xy[1], last.rotDeg);
    const bottomZ = src.mode === 'generic' ? 0 : src.sculptTrimZ;
    const mt = materialThickness(src.sculpt, src.bins, poly, bottomZ);
    if (!mt.stats) return null;
    return { minTop: mt.stats.minTop, maxTop: mt.stats.maxTop, maxBottom: mt.stats.maxBottom, thickness: mt.thickness, misses: mt.stats.misses, carved: src.mode === 'generic' && mt.flatBottom, covered: mt.stats.misses === 0, hollow: mt.stats.misses === 0 && mt.stats.maxBottom - bottomZ > 0.3 };
  },

  async autoMagnets(req) {
    const r = compute({ sourceId: req.sourceId, chain: req.chain, skipSculpt: true });
    return autoMagnetPositions(r.outline, { radius: req.radius, minWall: req.minWall }) as Vec2[];
  },

  async exportPiece(item: ExportItem) {
    const buf = pieceToStl(exportable(item));
    return Comlink.transfer(buf, [buf]);
  },

  async exportPlate(items, gap) {
    const pieces = items.map((it) => exportable(it));
    const buf = plateToStl(pieces, { gap });
    return Comlink.transfer(buf, [buf]);
  },

  async exportZip(items) {
    const files: Record<string, Uint8Array> = {};
    for (const it of items) {
      const buf = pieceToStl(exportable(it));
      files[safeName(it.name) + '.stl'] = new Uint8Array(buf);
    }
    const zipped = zipSync(files, { level: 1 });
    const out = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    return Comlink.transfer(out, [out]);
  },
};

/** The piece as it should be written: plain, or tilted + supported for a print-ready export. */
function exportable(item: ExportItem): ExportablePiece {
  const r = compute(item);
  const body = r.body, sculpt = exportSculpt(r);
  const ps = item.presupport;
  if (!ps) return { name: item.name, body, sculpt };
  const scale = item.sizing?.scale ?? 1;
  const last = item.chain[item.chain.length - 1];
  const maxDim = Math.max(r.size.w, r.size.d);
  if (r.tray) {
    // A tray is a broad flat panel, not a base. Small ones print flat on their supports;
    // bigger ones get a shallow tilt so the peel is progressive without a long thin
    // cantilever (docs/research/resin-printing-bases.md Q1 warns against both extremes —
    // 25 deg is a judgement call to confirm with a test print). The middle spacing is
    // clamped so an unstiffened 1 mm floor is actually carried, and the magnet holes
    // keep the support tips out.
    const tiltDeg = ps.tiltDeg ?? (maxDim <= 80 ? 0 : 25);
    const d = densitySpacing(maxDim, ps.density);
    const res = presupport(
      { body, sculpt, bottom: r.outline.bottom, slots: r.tray.magnets },
      { tiltDeg, standoff: ps.standoff, tipDiameter: ps.tipDiameter, spacing: Math.min(d.spacing, 6), edgeSpacing: d.edgeSpacing, bracing: ps.bracing },
    );
    return { name: item.name, body: res.body, sculpt: res.sculpt, supports: res.supports };
  }
  const slots = item.magnets ? magnetSlotSpecs(item.magnets.sizing, item.magnets.slots).map((sl) => ({ ...sl, x: sl.x * scale, y: sl.y * scale })) : [];
  const shape = { kind: last.shape.kind, w: r.size.w, d: r.size.d };
  const tiltDeg = ps.tiltDeg ?? autoTiltDeg(shape, last.profile);
  const { edgeSpacing, spacing } = densitySpacing(maxDim, ps.density);
  const res = presupport({ body, sculpt, bottom: r.outline.bottom, slots, underside: r.underside }, { tiltDeg, standoff: ps.standoff, tipDiameter: ps.tipDiameter, spacing, edgeSpacing, bracing: ps.bracing });
  return { name: item.name, body: res.body, sculpt: res.sculpt, supports: res.supports };
}

function safeName(n: string): string {
  return n.replace(/[^A-Za-z0-9._ -]+/g, '_').trim() || 'piece';
}

Comlink.expose(api);
