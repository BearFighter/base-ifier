import { newStudioDocument, normalizeStudioDocument } from '@/kernel/studio/document';
import type { StudioDocument } from '@/kernel/studio/document';
import { useStudioStore } from '@/studio/store';
/**
 * The application's zustand store: implements `AppStore` from ./types by
 * wiring the project/tree model (src/model/*) to the geometry worker
 * (src/worker/*) via the pure request-builders in ./chain.
 */
import * as Comlink from 'comlink';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { defaultEdges, newId, newProject, defaultExportSettings, defaultUndersideSettings, defaultPlugSettings, defaultTraySettings } from '@/model/defaults';
import { placementError } from '@/model/rules';
import { descendants, leaves, pieceSize } from '@/model/tree';
import type { MagnetSlot, Piece, Project, Source, SourceNormalization, SourceStats, PieceRole, UndersideSettings } from '@/model/types';
import { downloadBlob } from '@/ui/util/download';
import { formatMm } from '@/ui/util/format';
import type { ComputeRequest, ExportItem } from '@/worker/api';
import { kernel, progressProxy, resetKernel, withTimeout } from '@/worker/client';
import { PROFILE_GW } from '@/kernel/types';
import { largestEmptyRect } from '@/kernel/geom2d/maxEmptyRect';
import { USABLE_INSET } from '@/kernel/pipeline/computePiece';

/** Worker calls slower than this are treated as hung. */
const COMPUTE_TIMEOUT_MS = 120_000;
const LOAD_TIMEOUT_MS = 300_000;
import { chainFor, magnetRequestFor, sizingRequestFor, presupportRequestFor, undersideRequestFor } from './chain';
import { trayPiecesFor, trayShapeFor } from './derive';
import type { AppStore, SourceState } from './types';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Strips a trailing `.ext` from a file name. */
function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Studio scenes from an older build have no prop library; bring them all up to date on load. */
function normalizeStudioLibrary(studio: Record<string, StudioDocument> | undefined): Record<string, StudioDocument> {
  const out: Record<string, StudioDocument> = {};
  for (const [id, doc] of Object.entries(studio ?? {})) out[id] = normalizeStudioDocument(doc);
  return out;
}

/** In-flight compute promise per piece id, so a second request for the same
 * piece waits for the first instead of firing a duplicate worker call. */
const inFlight = new Map<string, Promise<void>>();

/** Older project files stored a watermark text and height; they are not settings any more. */
function withoutMark(u: UndersideSettings & { watermark?: unknown; watermarkHeight?: unknown }): UndersideSettings {
  const { watermark: _w, watermarkHeight: _h, ...rest } = u;
  void _w; void _h;
  return rest;
}

export const useAppStore = create<AppStore>()(
  immer((set, get) => {
    /** Compute (or re-compute) geometry for exactly one piece. */
    function computeOne(id: string): Promise<void> {
      const task = async () => {
        set((s) => {
          const g = s.geometry[id];
          if (g) g.status = 'pending';
          else s.geometry[id] = { status: 'pending' };
        });
        try {
          let state = get();
          let piece: Piece | undefined = state.project.pieces[id];
          if (!piece) return;

          if (piece.magnets.mode === 'auto' && piece.magnets.slots.length === 0) {
            const chain = chainFor(state.project, id);
            const positions = await withTimeout(
              kernel().autoMagnets({
                sourceId: piece.sourceId,
                chain,
                radius: state.project.magnet.dia / 2 + state.project.magnet.radialTol,
                minWall: state.project.underside?.hollow ? Math.max(state.project.magnet.minWall, state.project.underside.rimWidth + state.project.underside.ringWidth + 0.5) : state.project.magnet.minWall,
              }),
              COMPUTE_TIMEOUT_MS,
              `Placing magnets on ${piece.name}`,
            );
            if (positions.length > 0) {
              const slots: MagnetSlot[] = positions.map((xy) => ({ id: newId('mg'), xy }));
              set((s) => {
                const p = s.project.pieces[id];
                if (p) p.magnets.slots = slots;
              });
            }
          }

          state = get();
          piece = state.project.pieces[id];
          if (!piece) return;
          const chain = chainFor(state.project, id);
          const magnets = magnetRequestFor(state.project, piece);
          // Only the selected piece carries its (possibly huge) sculpt mesh on the main thread.
          const isRoot = piece.parentId === null;
          const req: ComputeRequest = { sourceId: piece.sourceId, chain, magnets, sizing: { scale: 1 }, underside: undersideRequestFor(state.project), skipSculpt: !isRoot && state.project.selectedId !== id };
          const data = await withTimeout(kernel().computePiece(req), COMPUTE_TIMEOUT_MS, `Cutting ${piece.name}`);
          set((s) => {
            s.geometry[id] = { status: 'ready', data };
          });
        } catch (err) {
          const message = errorMessage(err);
          set((s) => {
            s.geometry[id] = { status: 'error', error: message };
            s.lastError = message;
          });
          if (/was cancelled$/.test(message)) void get().restartKernel(message);
        }
      };
      return task();
    }

    /** Serialise compute calls per piece id. */
    function runSerialized(id: string): Promise<void> {
      const prev = inFlight.get(id) ?? Promise.resolve();
      set((s) => { s.busy += 1; });
      const next = prev.then(() => computeOne(id), () => computeOne(id));
      inFlight.set(id, next);
      void next.finally(() => {
        set((s) => { s.busy = Math.max(0, s.busy - 1); });
        if (inFlight.get(id) === next) inFlight.delete(id);
      });
      return next;
    }

    return {
      // ---------------------------------------------------------------- state
      project: newProject(),
      sources: {},
      geometry: {},
      terrain: {},
      view: { mode: 'top', showSculpt: true, tool: 'layout', drafts: [], activeDraftId: null, showHelp: true, confirmDelete: null, confirmRemoveSource: null, leftTab: 'base' },
      busy: 0,
      baseified: false,
      previewIds: [],
      lastError: null,

      // --------------------------------------------------------------- sources
      async loadSourceFile(file) {
        const id = newId('src');
        set((s) => {
          s.sources[id] = { status: 'loading', fileName: file.name, fileSize: file.size, summary: null, file };
        });
        try {
          const buffer = await file.arrayBuffer();
          const summary = await withTimeout(
            kernel().loadSource(
              id,
              file.name,
              Comlink.transfer(buffer, [buffer]),
              {},
              progressProxy((stage, fraction) => {
                set((s) => {
                  const src = s.sources[id];
                  if (src) src.progress = { stage, fraction };
                });
              }),
            ),
            LOAD_TIMEOUT_MS,
            `Loading ${file.name}`,
          );

          await get().registerPreparedSource(id, file.name, summary, { origin: 'file', file });
          return id;
        } catch (err) {
          const message = errorMessage(err);
          set((s) => {
            const src = s.sources[id];
            if (src) {
              src.status = 'error';
              src.error = message;
            }
            s.lastError = message;
          });
          return null;
        }
      },

      async registerPreparedSource(id, name, summary, opts) {
        const normalization: SourceNormalization = {
          mode: summary.mode,
          plateTop: summary.outline.plateTop,
          topScale: summary.outline.topScale,
          sculptMargin: 0.1,
          measuredScale: summary.measuredScale,
        };
        const stats: SourceStats = {
          tris: summary.stats.tris,
          components: summary.stats.components,
          nonManifoldEdges: summary.stats.nonManifoldEdges,
          boundaryEdges: summary.stats.boundaryEdges,
          bounds: summary.stats.bounds,
        };
        const existing = get().project.sources[id];
        const rootId = existing?.rootPieceId ?? newId('pc');
        const fileKey = opts.file ? { hash: `${opts.file.name}:${opts.file.size}`, size: opts.file.size } : { hash: `${opts.origin}:${opts.studioId ?? id}:${summary.stats.tris}`, size: 0 };
        set((s) => {
          s.sources[id] = { status: 'ready', fileName: name, fileSize: opts.file?.size ?? 0, summary, file: opts.file, origin: opts.origin, studioId: opts.studioId };
          const source: Source = { id, name, fileKey, nominal: summary.nominal, normalization, stats, rootPieceId: rootId, origin: opts.origin, studioId: opts.studioId };
          s.project.sources[id] = source;
          const root = s.project.pieces[rootId];
          if (root) {
            root.shape = summary.nominal;
            root.name = stripExt(name);
          } else {
            s.project.pieces[rootId] = { id: rootId, sourceId: id, parentId: null, name: stripExt(name), shape: summary.nominal, xy: [0, 0], rotDeg: 0, edges: [], magnets: { mode: 'auto', slots: [] }, children: [] };
          }
          s.project.selectedId = rootId;
          s.view.drafts = [];
          s.view.activeDraftId = null;
          s.baseified = false;
          s.previewIds = [];
          for (const gid of Object.keys(s.geometry)) if (s.project.pieces[gid]?.sourceId === id) delete s.geometry[gid];
        });
        await get().recomputeSubtree(rootId);
      },

      saveStudioDocument(doc) {
        set((s) => {
          if (!s.project.studio) s.project.studio = {};
          s.project.studio[doc.id] = doc;
        });
      },

      openStudio(opts) {
        const state = get();
        let doc: StudioDocument | undefined;
        if (opts?.docId) doc = state.project.studio?.[opts.docId];
        else if (opts?.sourceId) {
          const sid = state.project.sources[opts.sourceId]?.studioId;
          doc = sid ? state.project.studio?.[sid] : undefined;
        }
        if (!doc) doc = newStudioDocument();
        get().saveStudioDocument(doc);
        set((s) => { s.view.surface = 'studio'; });
        useStudioStore.getState().open(doc);
      },

      closeStudio() {
        useStudioStore.getState().close();
        set((s) => { s.view.surface = 'cutter'; });
      },

      removeSource(id) {
        set((s) => {
          delete s.sources[id];
          delete s.project.sources[id];
          const toRemove: string[] = [];
          for (const pid in s.project.pieces) {
            if (s.project.pieces[pid].sourceId === id) toRemove.push(pid);
          }
          for (const pid of toRemove) {
            delete s.project.pieces[pid];
            delete s.geometry[pid];
          }
          if (s.project.selectedId && toRemove.includes(s.project.selectedId)) {
            s.project.selectedId = null;
          }
        });
        void kernel().unloadSource(id);
      },

      // ---------------------------------------------------------------- pieces
      selectPiece(id) {
        const prev = get().project.selectedId;
        set((s) => {
          s.project.selectedId = id;
          s.view.drafts = [];
          s.view.activeDraftId = null;
          // release the previously selected piece's sculpt mesh (the big base keeps its preview)
          if (prev && prev !== id && s.project.pieces[prev]?.parentId !== null) {
            const g = s.geometry[prev];
            if (g?.data?.hasSculpt) {
              g.data.sculpt = { positions: new Float32Array(0), triCount: 0 };
              g.data.hasSculpt = false;
            }
          }
        });
        if (id && (get().baseified || get().project.pieces[id]?.parentId === null)) void get().ensureGeometry(id);
      },

      requestDeletePiece(id) {
        const piece = get().project.pieces[id];
        if (!piece || piece.parentId === null) return;
        set((s) => { s.view.confirmDelete = id; });
      },

      confirmDeletePiece() {
        const id = get().view.confirmDelete;
        set((s) => { s.view.confirmDelete = null; });
        if (id) get().removePiece(id);
      },

      cancelDelete() {
        set((s) => { s.view.confirmDelete = null; s.view.confirmRemoveSource = null; });
      },

      requestRemoveSource(id) {
        if (!get().project.sources[id] && !get().sources[id]) return;
        set((s) => { s.view.confirmRemoveSource = id; });
      },

      confirmRemoveSource() {
        const id = get().view.confirmRemoveSource;
        set((s) => { s.view.confirmRemoveSource = null; });
        if (id) get().removeSource(id);
      },

      async restartKernel(reason) {
        resetKernel();
        inFlight.clear();
        set((s) => {
          s.busy = 0;
          s.lastError = (reason ? reason + '. ' : '') + 'The geometry engine was restarted; reloading your bases…';
          for (const id of Object.keys(s.geometry)) delete s.geometry[id];
        });
        const sources = get().sources;
        for (const [id, src] of Object.entries(sources)) {
          const file = src.file;
          if (!file) {
            set((s) => { const x = s.sources[id]; if (x) { x.status = 'error'; x.error = 'Open the STL file again to restore this base.'; } });
            continue;
          }
          try {
            set((s) => { const x = s.sources[id]; if (x) { x.status = 'loading'; x.error = undefined; } });
            const buffer = await file.arrayBuffer();
            const summary = await withTimeout(kernel().loadSource(id, file.name, Comlink.transfer(buffer, [buffer]), {}), LOAD_TIMEOUT_MS, `Reloading ${file.name}`);
            set((s) => { const x = s.sources[id]; if (x) { x.status = 'ready'; x.summary = summary; x.progress = undefined; } });
          } catch (err) {
            const message = errorMessage(err);
            set((s) => { const x = s.sources[id]; if (x) { x.status = 'error'; x.error = message; } });
          }
        }
        const root = Object.values(get().project.sources).map((s) => s.rootPieceId);
        for (const r of root) await get().recomputeSubtree(r);
        const sel = get().project.selectedId;
        if (sel) await get().ensureGeometry(sel);
      },

      goToParent() {
        const id = get().project.selectedId;
        if (!id) return;
        const parentId = get().project.pieces[id]?.parentId ?? null;
        if (parentId) get().selectPiece(parentId);
      },

      addPiece(parentId, draft) {
        const state = get();
        const parent = state.project.pieces[parentId];
        if (!parent) throw new Error(`Unknown parent piece: ${parentId}`);
        const role: PieceRole = draft.role ?? 'base';
        const parentIsRoot = parent.parentId === null;
        // a tray is not a sibling of the bases it holds: it must not count against "one base only"
        const siblingCount = parent.children.filter((cid) => state.project.pieces[cid]?.role !== 'tray').length;
        const problem = placementError(state.project.mode, role, { parentIsRoot, parentRole: parent.role ?? 'base', siblingCount });
        if (problem) { set((s) => { s.lastError = problem; }); return null; }
        const id = newId('pc');
        const base: Piece = {
          id,
          sourceId: parent.sourceId,
          parentId,
          name: '',
          shape: draft.shape,
          xy: draft.xy,
          rotDeg: draft.rotDeg,
          edges: defaultEdges(draft.shape),
          profile: draft.profile ?? state.project.defaultProfile,
          role,
          magnets: { mode: 'auto', slots: [] },
          children: [],
        };
        const size = pieceSize(base);
        const kindWord = role === 'frame' ? 'Frame' : 'Base';
        const nth = Object.values(state.project.pieces).filter((p) => p.parentId !== null && p.sourceId === parent.sourceId && (p.role ?? 'base') === role).length + 1;
        void size;
        const piece: Piece = { ...base, name: draft.name ?? `${kindWord} ${nth}` };
        set((s) => {
          s.project.pieces[id] = get().project.pieces[id] ?? piece;
          const p = s.project.pieces[parentId];
          if (p && !p.children.includes(id)) p.children.push(id);
          s.baseified = false;
          s.previewIds = [];
        });
        return id;
      },

      addPieces(parentId, drafts) {
        const ids: string[] = [];
        for (const d of drafts) { const id = get().addPiece(parentId, d); if (id) ids.push(id); }
        return ids;
      },

      setMode(mode) {
        set((s) => { s.project.mode = mode; s.baseified = false; s.previewIds = []; });
      },

      previewStep(delta) {
        const ids = get().previewIds;
        if (ids.length === 0) return;
        const cur = ids.indexOf(get().project.selectedId ?? '');
        const next = ids[((cur < 0 ? 0 : cur + delta) + ids.length * 4) % ids.length];
        get().selectPiece(next);
      },

      async baseify() {
        const state = get();
        const sources = Object.values(state.project.sources);
        if (sources.length === 0) { set((s) => { s.lastError = 'Load a base first.'; }); return; }
        for (const src of sources) {
          const root = get().project.pieces[src.rootPieceId];
          if (!root) continue;
          if (get().project.mode === 'tray') {
            // one movement tray per frame, regenerated from scratch so it always matches the layout
            for (const cid of root.children.slice()) {
              if (get().project.pieces[cid]?.role === 'tray') get().removePiece(cid);
            }
            const trays = trayPiecesFor(get().project, src.rootPieceId);
            set((s) => {
              for (const tray of trays) {
                s.project.pieces[tray.id] = tray;
                s.project.pieces[src.rootPieceId]?.children.push(tray.id);
              }
            });
          }
          if (get().project.mode === 'diorama') {
            // regenerate the leftover material as bases
            for (const cid of root.children.slice()) {
              if (get().project.pieces[cid]?.role === 'leftover') get().removePiece(cid);
            }
            if (src.normalization.mode === 'generic') {
              // an object scene: the remainder is the whole object with the bases' pockets and holes cut into it
              const id = newId('pc');
              const lp: Piece = { id, sourceId: root.sourceId, parentId: root.id, name: `Rest of ${root.name}`, shape: { ...root.shape }, xy: [0, 0], rotDeg: 0, edges: defaultEdges(root.shape), profile: { kind: 'inset', inset: 0, height: 3 }, role: 'leftover', magnets: { mode: 'manual', slots: [] }, children: [] };
              set((s) => { s.project.pieces[id] = lp; s.project.pieces[root.id]?.children.push(id); });
              continue;
            }
            const rw = root.shape.w * src.normalization.topScale[0] - 2 * USABLE_INSET;
            const rd = root.shape.d * src.normalization.topScale[1] - 2 * USABLE_INSET;
            const occupied = get().project.pieces[src.rootPieceId]!.children.filter((cid) => get().project.pieces[cid]?.cut !== 'plug').map((cid) => {
              const c = get().project.pieces[cid]!;
              const sz = pieceSize(c);
              return { x: c.xy[0] - sz.w / 2 + rw / 2, y: c.xy[1] - sz.d / 2 + rd / 2, w: sz.w, h: sz.d };
            });
            let n = 0;
            for (let i = 0; i < 12; i++) {
              const free = largestEmptyRect({ w: rw, h: rd }, occupied, 0.5);
              if (!free || free.w < 8 || free.h < 8) break;
              n++;
              const w = Math.round(free.w * 100) / 100, d = Math.round(free.h * 100) / 100;
              const xy: [number, number] = [Math.round((free.x + free.w / 2 - rw / 2) * 100) / 100, Math.round((free.y + free.h / 2 - rd / 2) * 100) / 100];
              const id = newId('pc');
              const lp: Piece = { id, sourceId: root.sourceId, parentId: root.id, name: `Leftover ${n}`, shape: { kind: 'rect', w, d }, xy, rotDeg: 0, edges: defaultEdges({ kind: 'rect', w, d }), profile: get().project.defaultProfile, role: 'leftover', magnets: { mode: 'auto', slots: [] }, children: [] };
              set((s) => { s.project.pieces[id] = lp; s.project.pieces[root.id]?.children.push(id); });
              occupied.push({ x: free.x, y: free.y, w: free.w, h: free.h });
            }
          }
        }
        // compute every base, then preview the first finished one
        set((s) => { s.baseified = true; });
        for (const src of sources) await get().recomputeSubtree(src.rootPieceId);
        const order: string[] = [];
        for (const src of sources) {
          const walk = (id: string) => {
            const p = get().project.pieces[id];
            if (!p) return;
            if (p.children.length === 0 && p.parentId !== null) order.push(id);
            for (const c of p.children) walk(c);
          };
          walk(src.rootPieceId);
        }
        set((s) => { s.previewIds = order; s.view.mode = order.length ? 'orbit' : s.view.mode; s.view.leftTab = 'export'; });
        if (order.length) get().selectPiece(order[0]);
        else set((s) => { s.lastError = 'Nothing to base-ify yet: place at least one base on the big base.'; });
      },

      updatePiece(id, patch) {
        if (patch.shape && !(patch.shape.w >= 1 && patch.shape.d >= 1 && Number.isFinite(patch.shape.w) && Number.isFinite(patch.shape.d))) {
          set((s) => { s.lastError = 'Bases must be at least 1 mm wide and deep.'; });
          return;
        }
        set((s) => {
          const piece = s.project.pieces[id];
          if (!piece) return;
          if (patch.name !== undefined) piece.name = patch.name;
          if (patch.shape !== undefined) piece.shape = patch.shape;
          if (patch.xy !== undefined) piece.xy = patch.xy;
          if (patch.rotDeg !== undefined) piece.rotDeg = patch.rotDeg;
          if (patch.edges !== undefined) piece.edges = patch.edges;
          if (patch.profile !== undefined) piece.profile = patch.profile;
          if (patch.cut !== undefined) piece.cut = patch.cut;
          if (patch.plugDepth !== undefined) piece.plugDepth = patch.plugDepth;
          if (patch.plugClearance !== undefined) piece.plugClearance = patch.plugClearance;
        });
        // a rename does not change geometry; anything else makes the last Base-ify stale
        if (patch.shape !== undefined || patch.xy !== undefined || patch.rotDeg !== undefined || patch.edges !== undefined || patch.profile !== undefined || patch.cut !== undefined || patch.plugDepth !== undefined || patch.plugClearance !== undefined) {
          set((s) => { s.baseified = false; s.previewIds = []; });
        }
      },

      setDefaultProfile(profile) {
        set((s) => { s.project.defaultProfile = profile; });
      },

      removePiece(id) {
        set((s) => {
          const piece = s.project.pieces[id];
          if (!piece) return;
          const removedIds = [id, ...descendants(s.project, id)];
          // a frame's tray is not inside it (it hangs off the scene), so the cascade misses it
          const gone = new Set(removedIds);
          for (const [pid, p] of Object.entries(s.project.pieces)) {
            if (p.role === 'tray' && p.trayOf && gone.has(p.trayOf) && !gone.has(pid)) { removedIds.push(pid); gone.add(pid); }
          }
          const wasSelected = s.project.selectedId === id;
          const parentId = piece.parentId;
          const parents = new Map<string, string>();
          for (const rid of removedIds) {
            const p = s.project.pieces[rid]?.parentId;
            if (p) parents.set(rid, p);
          }
          for (const rid of removedIds) {
            delete s.project.pieces[rid];
            delete s.geometry[rid];
            delete s.terrain[rid];
          }
          for (const [rid, pid] of parents) {
            const parent = s.project.pieces[pid];
            if (parent) parent.children = parent.children.filter((c) => c !== rid);
          }
          // Whatever was selected inside the removed subtree, land on the parent so the
          // dock and the outlines never vanish (a null selection hides the whole work area).
          if (wasSelected || (s.project.selectedId !== null && removedIds.includes(s.project.selectedId))) {
            s.project.selectedId = parentId;
          }
        });
        set((s) => { s.baseified = false; s.previewIds = []; });
      },

      setPieceMagnets(id, magnets) {
        set((s) => {
          const piece = s.project.pieces[id];
          if (!piece) return;
          piece.magnets = magnets;
        });
        void get().recomputeSubtree(id).then(() => {
          // the tray's holes are lined up with the base's magnets, so it has to follow
          const state = get();
          const parentId = state.project.pieces[id]?.parentId;
          for (const p of Object.values(state.project.pieces)) {
            if (p.role === 'tray' && p.trayOf && (p.trayOf === parentId || p.trayOf === id)) void get().recomputeSubtree(p.id);
          }
        });
      },

      setTraySettings(patch, frameId) {
        set((s) => {
          if (frameId) {
            const frame = s.project.pieces[frameId];
            if (frame) frame.tray = { ...(frame.tray ?? {}), ...patch };
          } else {
            Object.assign(s.project.tray, patch);
          }
        });
        // keep any tray already made in step with the setting instead of making the user re-forge
        const trays = Object.values(get().project.pieces).filter((p) => p.role === 'tray' && (!frameId || p.trayOf === frameId));
        if (trays.length === 0) {
          set((s) => { s.baseified = false; s.previewIds = []; });
          return;
        }
        set((s) => {
          for (const tray of trays) {
            const frame = tray.trayOf ? s.project.pieces[tray.trayOf] : undefined;
            const piece = s.project.pieces[tray.id];
            if (frame && piece) piece.shape = trayShapeFor(s.project, frame);
          }
        });
        for (const tray of trays) void get().recomputeSubtree(tray.id);
      },

      // -------------------------------------------------------------- settings
      setMagnetSettings(patch) {
        set((s) => {
          Object.assign(s.project.magnet, patch);
        });
        const state = get();
        for (const piece of Object.values(state.project.pieces)) {
          if (piece.magnets.slots.length > 0 && get().baseified) void get().recomputeSubtree(piece.id);
        }
      },

      setExportSettings(patch) {
        set((s) => {
          Object.assign(s.project.export, patch);
        });
      },

      setPlugSettings(patch) {
        set((s) => {
          Object.assign(s.project.plug, patch);
          s.baseified = false;
          s.previewIds = [];
        });
      },

      async fetchTerrainInfo(id) {
        const state = get();
        const piece = state.project.pieces[id];
        if (!piece || piece.parentId === null || piece.role === 'frame' || piece.role === 'tray') return;
        try {
          const info = await kernel().columnInfo({ sourceId: piece.sourceId, chain: chainFor(state.project, id) });
          set((s) => { if (info) s.terrain[id] = info; else delete s.terrain[id]; });
        } catch {
          /* not loaded yet */
        }
      },

      setUndersideSettings(patch) {
        set((s) => {
          Object.assign(s.project.underside, patch);
        });
        if (get().baseified) {
          for (const src of Object.values(get().project.sources)) void get().recomputeSubtree(src.rootPieceId);
        }
      },

      // ------------------------------------------------------------- view/tool
      setView(patch) {
        set((s) => {
          Object.assign(s.view, patch);
        });
      },

      setDrafts(drafts, activeId) {
        set((s) => {
          s.view.drafts = drafts;
          if (activeId !== undefined) s.view.activeDraftId = activeId;
        });
      },

      updateDraft(id, patch) {
        set((s) => {
          const draft = s.view.drafts.find((d) => d.id === id);
          if (draft) Object.assign(draft, patch);
        });
      },

      // -------------------------------------------------------------- geometry
      async recomputeSubtree(id) {
        const state = get();
        const piece = state.project.pieces[id];
        if (!piece) return;
        const ids = [id, ...descendants(state.project, id)];
        // A tray's magnet holes are lined up with the bases' own magnets, which are placed
        // while each base is computed, so every tray has to be computed after the bases.
        // Array#sort is stable, so everything else keeps its order.
        ids.sort((a, b) => (state.project.pieces[a]?.role === 'tray' ? 1 : 0) - (state.project.pieces[b]?.role === 'tray' ? 1 : 0));
        for (const pid of ids) {
          await runSerialized(pid);
        }
      },

      async ensureGeometry(id) {
        const g = get().geometry[id];
        const needsSculpt = get().project.selectedId === id || get().project.pieces[id]?.parentId === null;
        if (g && g.status === 'ready' && (!needsSculpt || g.data?.hasSculpt)) return;
        await runSerialized(id);
      },

      // ---------------------------------------------------------------- export
      async exportPieceStl(id) {
        const state = get();
        const piece = state.project.pieces[id];
        if (!piece) return;
        const source = state.project.sources[piece.sourceId];
        const summary = state.sources[piece.sourceId]?.summary ?? null;
        const item: ExportItem = {
          sourceId: piece.sourceId,
          chain: chainFor(state.project, id),
          magnets: magnetRequestFor(state.project, piece),
          sizing: sizingRequestFor(state.project, summary),
          presupport: presupportRequestFor(state.project),
          underside: undersideRequestFor(state.project),
          name: piece.name,
        };
        try {
          const buffer = await kernel().exportPiece(item);
          const size = pieceSize(piece);
          const prefix = source ? stripExt(source.name) : piece.sourceId;
          const suffix = state.project.export.presupport?.enabled ? '_supported' : '';
          const fileName = `${prefix}_${piece.name}_${formatMm(size.w)}x${formatMm(size.d)}${suffix}.stl`;
          downloadBlob(fileName, new Blob([buffer], { type: 'model/stl' }));
        } catch (err) {
          set((s) => {
            s.lastError = errorMessage(err);
          });
        }
      },

      async exportLeavesZip(sourceId) {
        const state = get();
        const source = state.project.sources[sourceId];
        const summary = state.sources[sourceId]?.summary ?? null;
        const pieces = leaves(state.project, sourceId);
        if (pieces.length === 0) return;
        const items: ExportItem[] = pieces.map((p) => ({
          sourceId,
          chain: chainFor(state.project, p.id),
          magnets: magnetRequestFor(state.project, p),
          sizing: sizingRequestFor(state.project, summary),
          presupport: presupportRequestFor(state.project),
          underside: undersideRequestFor(state.project),
          name: p.name,
        }));
        try {
          const buffer = await kernel().exportZip(items);
          const prefix = source ? stripExt(source.name) : sourceId;
          downloadBlob(`${prefix}_bases${state.project.export.presupport?.enabled ? '_supported' : ''}.zip`, new Blob([buffer], { type: 'application/zip' }));
        } catch (err) {
          set((s) => {
            s.lastError = errorMessage(err);
          });
        }
      },

      async exportPlateStl(sourceId) {
        const state = get();
        const source = state.project.sources[sourceId];
        const summary = state.sources[sourceId]?.summary ?? null;
        const pieces = leaves(state.project, sourceId);
        if (pieces.length === 0) return;
        const items: ExportItem[] = pieces.map((p) => ({
          sourceId,
          chain: chainFor(state.project, p.id),
          magnets: magnetRequestFor(state.project, p),
          sizing: sizingRequestFor(state.project, summary),
          presupport: presupportRequestFor(state.project),
          underside: undersideRequestFor(state.project),
          name: p.name,
        }));
        try {
          const buffer = await kernel().exportPlate(items, state.project.export.plateGap);
          const prefix = source ? stripExt(source.name) : sourceId;
          downloadBlob(`${prefix}_plate${state.project.export.presupport?.enabled ? '_supported' : ''}.stl`, new Blob([buffer], { type: 'model/stl' }));
        } catch (err) {
          set((s) => {
            s.lastError = errorMessage(err);
          });
        }
      },

      // ----------------------------------------------------------- persistence
      saveProjectFile() {
        const project = get().project;
        const json = JSON.stringify(project, null, 2);
        downloadBlob(`${project.name}.baseifier.json`, new Blob([json], { type: 'application/json' }));
      },

      async loadProjectFile(file) {
        let parsed: unknown;
        try {
          const text = await file.text();
          parsed = JSON.parse(text);
        } catch {
          set((s) => {
            s.lastError = 'Could not read or parse the project file.';
          });
          return;
        }
        const project = parsed as Project;
        if (!project || typeof project !== 'object' || project.version !== 1) {
          set((s) => {
            s.lastError = 'Unsupported project file (expected version 1).';
          });
          return;
        }
        const prevSources = get().sources;
        set((s) => {
          s.project = { ...project, export: { ...defaultExportSettings(), ...project.export, presupport: { ...defaultExportSettings().presupport, ...(project.export?.presupport ?? {}) } }, underside: withoutMark({ ...defaultUndersideSettings(), ...(project.underside ?? {}) }), plug: { ...defaultPlugSettings(), ...(project.plug ?? {}) }, tray: { ...defaultTraySettings(), ...(project.tray ?? {}) }, studio: normalizeStudioLibrary(project.studio) };
          s.geometry = {};
          s.view = { mode: 'top', showSculpt: true, tool: 'layout', drafts: [], activeDraftId: null, showHelp: s.view.showHelp, confirmDelete: null, confirmRemoveSource: null, leftTab: 'bases' };
          if (!s.project.mode) s.project.mode = 'multibase';
          s.baseified = false;
          s.previewIds = [];
          if (!s.project.defaultProfile) s.project.defaultProfile = PROFILE_GW;
          const nextSources: Record<string, SourceState> = {};
          for (const src of Object.values(project.sources)) {
            const existing = prevSources[src.id];
            const existingHash = existing ? `${existing.fileName}:${existing.fileSize}` : null;
            if (existing && existing.status === 'ready' && existingHash === src.fileKey.hash) {
              nextSources[src.id] = existing;
            } else {
              nextSources[src.id] = {
                status: 'error',
                error: 'Re-open the STL file to restore geometry',
                fileName: src.name,
                fileSize: src.fileKey.size,
                summary: null,
              };
            }
          }
          s.sources = nextSources;
        });
      },

      clearError() {
        set((s) => {
          s.lastError = null;
        });
      },
    };
  }),
);

// Dev aid: inspect the store from the browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __appStore?: unknown }).__appStore = useAppStore;
}
