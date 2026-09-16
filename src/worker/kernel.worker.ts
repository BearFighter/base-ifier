/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { presupport, autoTiltDeg, densitySpacing } from '../kernel/pipeline/presupport';
import type { ExportablePiece } from '../kernel/pipeline/exportPiece';
import { zipSync } from 'fflate';
import type { Soup, Vec2 } from '@/kernel/types';
import { tightSoup } from '@/kernel/types';
import { readStl } from '@/kernel/stl/read';
import { prepareSource, type PreparedSource } from '@/kernel/source/prepareSource';
import { computePiece, meshToSoup, rootPieceParams, sourceFrame, type ParentFrame, type PieceResult } from '@/kernel/pipeline/computePiece';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { autoMagnetPositions } from '@/kernel/pipeline/autoMagnets';
import { pieceToStl, plateToStl } from '@/kernel/pipeline/exportPiece';
import { decimateForDisplay } from '@/kernel/mesh/decimate';
import type { ComputeRequest, ExportItem, KernelApi, MeshTransfer, PieceChainNode, PieceGeometryTransfer, SourceSummary } from './api';

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

function chainKey(chain: PieceChainNode[], upto: number): string {
  return JSON.stringify(chain.slice(0, upto + 1).map((n) => [n.shape, n.xy, n.rotDeg, n.edges, n.profile ?? null, n.role ?? 'base']));
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
      const params = i === 0 ? rootPieceParams(src) : { shape: node.shape, xy: node.xy, rotDeg: node.rotDeg, edges: node.edges, profile: node.profile, role: node.role };
      const result = computePiece(frame, params, { source: src, skipSculpt: true, stamp: entry.stamp });
      cached = { result, sizingKey: '' };
      entry.cache.set(key, cached);
    }
    frame = cached.result.frame;
  }
  return frame;
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
  const params = chain.length === 1 ? rootPieceParams(src) : { shape: last.shape, xy: last.xy, rotDeg: last.rotDeg, edges: last.edges, profile: last.profile, role: last.role };
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
    hollow: req.underside,
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

const api: KernelApi = {
  async loadSource(id, name, buffer, opts, onProgress) {
    const t0 = performance.now();
    const raw = readStl(buffer);
    const tRead = performance.now() - t0;
    const prepared = prepareSource(raw, name, { nominal: opts?.nominal, onProgress: onProgress ? (stage, fraction) => { void onProgress(stage, fraction); } : undefined });
    prepared.timings.read = tRead;
    sources.set(id, { prepared, cache: new Map(), full: new Map(), stamp: { arr: new Uint32Array(prepared.sculpt.triCount), id: 0 } });
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
      warnings: r.warnings,
      bodyVolume: r.bodyVolume,
      bounds: r.bounds,
      timings: r.timings,
    };
    return Comlink.transfer(out, transfers);
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
  const slots = item.magnets ? magnetSlotSpecs(item.magnets.sizing, item.magnets.slots).map((sl) => ({ ...sl, x: sl.x * scale, y: sl.y * scale })) : [];
  const last = item.chain[item.chain.length - 1];
  const shape = { kind: last.shape.kind, w: r.size.w, d: r.size.d };
  const tiltDeg = ps.tiltDeg ?? autoTiltDeg(shape);
  const { edgeSpacing, spacing } = densitySpacing(Math.max(r.size.w, r.size.d), ps.density);
  const res = presupport({ body, sculpt, bottom: r.outline.bottom, slots, underside: r.underside }, { tiltDeg, standoff: ps.standoff, tipDiameter: ps.tipDiameter, spacing, edgeSpacing, bracing: ps.bracing });
  return { name: item.name, body: res.body, sculpt: res.sculpt, supports: res.supports };
}

function safeName(n: string): string {
  return n.replace(/[^A-Za-z0-9._ -]+/g, '_').trim() || 'piece';
}

Comlink.expose(api);
