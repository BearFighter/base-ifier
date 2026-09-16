/**
 * Base Studio state: the document being edited, its live preview meshes and
 * the actions that talk to the worker. Meshes stay in this store and reach
 * three.js through refs (never through React props).
 *
 * Props are ONLY the user's own STLs. The scene's library (`doc.library`) holds
 * the metadata and saves with the project; the bytes do not, so the `File`
 * objects are kept here (like the cutter's sources) and the worker holds the
 * geometry. A library item with no geometry is shown as "file needed".
 */
import { create } from 'zustand';
import { produce } from 'immer';
import * as Comlink from 'comlink';
import { kernel, withTimeout } from '@/worker/client';
import type { Bounds3 } from '@/kernel/types';
import type { MeshTransfer, StudioAssetInfo, StudioAssetTransfer } from '@/worker/api';
import { normalizeStudioDocument, studioId } from '@/kernel/studio/document';
import type { StudioDocument, StudioLibraryItem } from '@/kernel/studio/document';
import { useAppStore } from '@/state/project';
import { newId } from '@/model/defaults';

export type StudioTab = 'board' | 'ground' | 'props' | 'rules';

export interface StudioPreview {
  ground: MeshTransfer;
  props: MeshTransfer;
  bounds: Bounds3;
  propCount: number;
  warnings: string[];
  ms: number;
}

interface StudioState {
  doc: StudioDocument | null;
  tab: StudioTab;
  viewMode: 'top' | 'orbit';
  preview: StudioPreview | null;
  previewing: boolean;
  baking: boolean;
  /** edits since the last preview */
  dirty: boolean;
  /** what the worker knows about each library item's geometry, by item id */
  assetInfo: Record<string, StudioAssetInfo>;
  /** the STL files behind the library items; not saved with the project */
  libraryFiles: Map<string, File>;
  /** reading STLs into the worker */
  libraryBusy: boolean;
  /** library item the user asked to remove (in-app confirm; never window.confirm) */
  confirmRemove: string | null;
  error: string | null;
  history: StudioDocument[];
  future: StudioDocument[];

  open(doc: StudioDocument): void;
  close(): void;
  setTab(tab: StudioTab): void;
  setViewMode(mode: 'top' | 'orbit'): void;
  /** edit the document (immer recipe); previews refresh after a short pause */
  update(recipe: (d: StudioDocument) => void, options?: { history?: boolean }): void;
  undo(): void;
  redo(): void;
  /** make sure the worker holds geometry for every library item whose file we have */
  syncLibrary(): Promise<void>;
  /** add STL files to the scene's prop library (new items, or files for "file needed" items) */
  registerLibraryFiles(files: File[]): Promise<void>;
  requestRemoveLibraryItem(id: string): void;
  cancelRemoveLibraryItem(): void;
  /** remove a library item and every prop placed from it */
  removeLibraryItem(id: string): Promise<void>;
  updateLibraryItem(id: string, patch: Partial<Pick<StudioLibraryItem, 'name' | 'family' | 'licence' | 'weight'>>): void;
  scatter(reroll?: boolean, options?: { history?: boolean }): Promise<void>;
  clearScatter(): void;
  refreshPreview(): Promise<void>;
  /** bake and hand the scene to the cutter; resolves with the source id */
  useScene(): Promise<string | null>;
}

const PREVIEW_TIMEOUT = 60_000;
const BAKE_TIMEOUT = 180_000;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSerial = 0;
/** an edit changed something the scatter depends on: re-roll it with the same seed */
let pendingRescatter = false;
/** the re-scatter's own edit must not schedule another one */
let rescattering = false;

/**
 * Everything the scatter depends on. When this changes (board size, preset,
 * density, foot zones, the library…) the scatter is re-rolled with the SAME seed,
 * so the scene follows the edit instead of going stale.
 */
function scatterKey(d: StudioDocument): string {
  return JSON.stringify([
    d.board.shape,
    d.board.margin ?? 0,
    d.ground.presetId,
    d.rules.rimInset,
    d.rules.footZones,
    d.rules.density,
    d.rules.heroProps,
    d.rules.heightCap,
    d.rules.sink,
    (d.library ?? []).map((it) => [it.id, it.family, it.weight ?? 1]),
  ]);
}

export const useStudioStore = create<StudioState>()((set, get) => ({
  doc: null,
  tab: 'board',
  viewMode: 'orbit',
  preview: null,
  previewing: false,
  baking: false,
  dirty: false,
  assetInfo: {},
  libraryFiles: new Map(),
  libraryBusy: false,
  confirmRemove: null,
  error: null,
  history: [],
  future: [],

  open(rawDoc) {
    const doc = normalizeStudioDocument(rawDoc);
    set({ doc, tab: 'board', preview: null, dirty: true, error: null, confirmRemove: null, history: [], future: [] });
    void (async () => {
      // files added earlier in this session are still here; a re-opened scene asks for the rest
      await get().syncLibrary();
      if (get().doc?.id !== doc.id) return;
      const d = get().doc!;
      if (d.library.length > 0 && !d.props.some((p) => p.scattered)) await get().scatter(false, { history: false });
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = null;
      await get().refreshPreview();
    })();
  },

  close() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    pendingRescatter = false;
    set({ doc: null, preview: null, previewing: false, dirty: false, confirmRemove: null });
  },

  setTab(tab) { set({ tab }); },
  setViewMode(viewMode) { set({ viewMode }); },

  update(recipe, options) {
    const doc = get().doc;
    if (!doc) return;
    const next = produce(doc, recipe);
    if (next === doc) return;
    const history = options?.history === false ? get().history : [...get().history.slice(-49), doc];
    set({ doc: next, dirty: true, history, future: [] });
    // keep the project's copy current so it saves with the file
    useAppStore.getState().saveStudioDocument(next);
    // an edit that moves the scatter's ground rules re-rolls it (same seed, hand-placed props kept);
    // the re-scatter lands in THIS history entry, so one undo takes back the edit and the scatter
    if (!rescattering && scatterKey(doc) !== scatterKey(next) && (doc.props.some((p) => p.scattered) || next.props.some((p) => p.scattered))) {
      pendingRescatter = true;
    }
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      void (async () => {
        if (pendingRescatter) {
          pendingRescatter = false;
          await get().scatter(false, { history: false });
          if (previewTimer) clearTimeout(previewTimer);
          previewTimer = null;
        }
        await get().refreshPreview();
      })();
    }, 250);
  },

  undo() {
    const { history, doc } = get();
    if (!doc || history.length === 0) return;
    const prev = history[history.length - 1];
    pendingRescatter = false;
    set({ doc: prev, history: history.slice(0, -1), future: [doc, ...get().future].slice(0, 50), dirty: true });
    useAppStore.getState().saveStudioDocument(prev);
    void get().refreshPreview();
  },

  redo() {
    const { future, doc } = get();
    if (!doc || future.length === 0) return;
    const next = future[0];
    pendingRescatter = false;
    set({ doc: next, future: future.slice(1), history: [...get().history, doc], dirty: true });
    useAppStore.getState().saveStudioDocument(next);
    void get().refreshPreview();
  },

  async syncLibrary() {
    const doc = get().doc;
    if (!doc) return;
    const files = get().libraryFiles;
    const info = get().assetInfo;
    const todo = doc.library.filter((it) => !info[it.id] && files.has(it.id));
    if (todo.length === 0) return;
    set({ libraryBusy: true });
    try {
      const transfers: StudioAssetTransfer[] = [];
      for (const it of todo) transfers.push({ id: it.id, name: it.name, family: it.family, stl: await files.get(it.id)!.arrayBuffer() });
      const infos = await withTimeout(
        kernel().registerStudioAssets(Comlink.transfer(transfers, transfers.map((t) => t.stl))),
        PREVIEW_TIMEOUT,
        'Reading your prop STLs',
      );
      set({ assetInfo: { ...get().assetInfo, ...Object.fromEntries(infos.map((i) => [i.id, i])) }, libraryBusy: false });
    } catch (err) {
      set({ libraryBusy: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async registerLibraryFiles(files) {
    const doc = get().doc;
    if (!doc) return;
    const stls = files.filter((f) => /\.stl$/i.test(f.name));
    if (stls.length === 0) return;
    set({ libraryBusy: true, error: null });
    const info = get().assetInfo;
    // a saved scene comes back with its items but no bytes: match those by file name + size first
    const needFile = doc.library.filter((it) => !info[it.id]);
    const claimed = new Set<string>();
    const added: StudioLibraryItem[] = [];
    const nextFiles = new Map(get().libraryFiles);
    const transfers: StudioAssetTransfer[] = [];
    try {
      for (const f of stls) {
        const hit = needFile.find((it) => !claimed.has(it.id) && it.fileName === f.name && it.fileSize === f.size);
        const item: StudioLibraryItem = hit ?? {
          id: studioId('lib'),
          name: f.name.replace(/\.stl$/i, ''),
          fileName: f.name,
          fileSize: f.size,
          family: 'any',
          licence: 'own-rights',
          weight: 1,
        };
        if (hit) claimed.add(hit.id); else added.push(item);
        nextFiles.set(item.id, f);
        transfers.push({ id: item.id, name: item.name, family: item.family, stl: await f.arrayBuffer() });
      }
      const infos = await withTimeout(
        kernel().registerStudioAssets(Comlink.transfer(transfers, transfers.map((t) => t.stl))),
        PREVIEW_TIMEOUT,
        'Reading your prop STLs',
      );
      set({ libraryFiles: nextFiles, assetInfo: { ...get().assetInfo, ...Object.fromEntries(infos.map((i) => [i.id, i])) }, libraryBusy: false });
      const bad = infos.filter((i) => !i.closed);
      if (bad.length > 0) set({ error: `${bad.map((b) => b.name).join(', ')}: ${bad.length === 1 ? 'this STL is not a closed mesh, so it cannot be placed' : 'these STLs are not closed meshes, so they cannot be placed'}. Repair them in your sculpting tool first.` });
      if (added.length > 0) {
        // the first props on an empty board are scattered straight away; later ones re-roll (scatterKey)
        if (doc.library.length === 0 && !doc.props.some((p) => p.scattered)) pendingRescatter = true;
        get().update((d) => { d.library.push(...added); });
      } else {
        await get().refreshPreview();
      }
    } catch (err) {
      set({ libraryBusy: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  requestRemoveLibraryItem(id) { set({ confirmRemove: id }); },
  cancelRemoveLibraryItem() { set({ confirmRemove: null }); },

  async removeLibraryItem(id) {
    set({ confirmRemove: null });
    const nextFiles = new Map(get().libraryFiles);
    nextFiles.delete(id);
    const info = { ...get().assetInfo };
    delete info[id];
    set({ libraryFiles: nextFiles, assetInfo: info });
    get().update((d) => {
      d.library = d.library.filter((it) => it.id !== id);
      d.props = d.props.filter((p) => p.assetId !== id);
    });
    try {
      await kernel().unregisterStudioAssets([id]);
    } catch {
      /* the worker forgetting geometry is housekeeping; the document is already right */
    }
  },

  updateLibraryItem(id, patch) {
    get().update((d) => {
      const it = d.library.find((x) => x.id === id);
      if (!it) return;
      Object.assign(it, patch);
    });
  },

  async scatter(reroll = true, options) {
    const doc = get().doc;
    if (!doc) return;
    await get().syncLibrary();
    const seeded = reroll ? produce(doc, (d) => { d.scatterSeed = (d.scatterSeed * 1103515245 + 12345) >>> 0; }) : doc;
    try {
      const props = await withTimeout(kernel().scatterStudio(seeded), PREVIEW_TIMEOUT, 'Scattering props');
      rescattering = true;
      get().update((d) => { d.scatterSeed = seeded.scatterSeed; d.props = props; }, options);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      rescattering = false;
    }
  },

  clearScatter() {
    get().update((d) => { d.props = d.props.filter((p) => !p.scattered); });
  },

  async refreshPreview() {
    const doc = get().doc;
    if (!doc) return;
    const serial = ++previewSerial;
    set({ previewing: true, dirty: false });
    try {
      const t0 = performance.now();
      const res = await withTimeout(kernel().previewStudio(doc), PREVIEW_TIMEOUT, 'Building the preview');
      if (serial !== previewSerial) return; // a newer preview superseded this one
      set({ preview: { ground: res.ground, props: res.props, bounds: res.bounds, propCount: res.propCount, warnings: res.warnings, ms: Math.round(performance.now() - t0) }, previewing: false, error: null });
    } catch (err) {
      if (serial === previewSerial) set({ previewing: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async useScene() {
    const doc = get().doc;
    if (!doc) return null;
    set({ baking: true, error: null });
    try {
      await get().syncLibrary();
      const app = useAppStore.getState();
      const id = doc.sourceId && app.project.sources[doc.sourceId] ? doc.sourceId : newId('src');
      const summary = await withTimeout(kernel().bakeStudio(id, doc), BAKE_TIMEOUT, 'Building the scene');
      const withSource = produce(doc, (d) => { d.sourceId = id; });
      set({ doc: withSource });
      app.saveStudioDocument(withSource);
      await app.registerPreparedSource(id, doc.name, summary, { origin: 'studio', studioId: doc.id });
      set({ baking: false });
      app.setView({ surface: 'cutter', leftTab: 'bases', mode: 'top' });
      return id;
    } catch (err) {
      set({ baking: false, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },
}));

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __studioStore?: unknown }).__studioStore = useStudioStore;
}
