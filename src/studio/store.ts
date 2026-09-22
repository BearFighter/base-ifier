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
import type { MeshTransfer, StudioAssetInfo, StudioAssetTransfer, StudioPlacement, StudioPropRange } from '@/worker/api';
import { normalizeStudioDocument, studioId } from '@/kernel/studio/document';
import type { StudioDocument, StudioLibraryItem } from '@/kernel/studio/document';
import { clampPropToBoard } from '@/kernel/studio/bake';
import { useAppStore } from '@/state/project';
import { newId } from '@/model/defaults';

export type StudioTab = 'board' | 'ground' | 'props' | 'rules';

/** What the drag handle on the selected prop does: slide it, turn it, or resize it. */
export type TransformMode = 'move' | 'turn' | 'size';

export interface StudioPreview {
  ground: MeshTransfer;
  props: MeshTransfer;
  /** which triangles of `props` belong to which placed prop (for clicking and highlighting) */
  propRanges: StudioPropRange[];
  /** where each placed prop ended up, including the height the drop worked out */
  placements: StudioPlacement[];
  bounds: Bounds3;
  propCount: number;
  warnings: string[];
  ms: number;
}

/** What one prop's numbers can be set to directly (the Props tab's fields). */
export interface PropEdit {
  x?: number;
  y?: number;
  rotDeg?: number;
  scale?: number;
  sink?: number;
}

/** What a finished drag of the handle in the view changes. */
export interface PropTransform {
  x?: number;
  y?: number;
  rotDegDelta?: number;
  scaleFactor?: number;
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
  /**
   * Short "this just happened" line for the studio bar, cleared after a few
   * seconds. Used when an edit re-places the scattered props, so the user is
   * never surprised by the app rearranging their scene; `undoable` puts an
   * Undo button inline in the message.
   */
  notice: { text: string; undoable: boolean } | null;
  error: string | null;
  history: StudioDocument[];
  future: StudioDocument[];
  /** the prop the user clicked in the view, if any; cleared when it stops existing */
  selectedPropId: string | null;
  /** what the drag handle on the selected prop does */
  transformMode: TransformMode;

  open(doc: StudioDocument): void;
  close(): void;
  setTab(tab: StudioTab): void;
  setViewMode(mode: 'top' | 'orbit'): void;
  /** pick a prop in the view (null clears the selection) */
  select(id: string | null): void;
  setTransformMode(mode: TransformMode): void;
  /**
   * Set one prop's numbers directly; the prop becomes hand-placed, in one undo
   * step. `coalesce` names the box being typed in, so a burst of keystrokes in
   * the same box stays ONE undo step.
   */
  editProp(id: string, patch: PropEdit, options?: { coalesce?: string }): void;
  /** finish a drag of the handle in the view: same effect as typing the numbers */
  commitPropTransform(id: string, t: PropTransform): void;
  /** take one prop off the board */
  removeProp(id: string): void;
  /** edit the document (immer recipe); previews refresh after a short pause */
  update(recipe: (d: StudioDocument) => void, options?: { history?: boolean; coalesce?: string }): void;
  undo(): void;
  redo(): void;
  /** make sure the worker holds geometry for every library item whose file we have */
  syncLibrary(): Promise<void>;
  /** add STL files to the scene's prop library (new items, or files for "file needed" items) */
  registerLibraryFiles(files: File[]): Promise<void>;
  requestRemoveLibraryItem(id: string): void;
  cancelRemoveLibraryItem(): void;
  /** say in the studio bar that the props were just placed again, and why */
  showRescatterNotice(reason: string): void;
  /** hide the studio bar's "this just happened" line */
  dismissNotice(): void;
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
/** how long the studio bar keeps a "this just happened" line */
const NOTICE_MS = 4200;
/** reason marker for the very first scatter of a scene (nothing was rearranged) */
const FIRST_SCATTER = 'first-scatter';
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSerial = 0;
/** an edit changed something the scatter depends on: re-roll it with the same seed */
let pendingRescatter = false;
/** which setting caused it, in plain words, for the message the user sees */
let pendingReason: string | null = null;
/** the re-scatter's own edit must not schedule another one */
let rescattering = false;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let noticeSerial = 0;
/**
 * Typing a number is one change, not one change per key. Edits that name the
 * same box (`coalesce`) and follow one another this closely share a single
 * history entry, so one Undo takes back "-35" rather than the "5" of it.
 */
const COALESCE_MS = 1500;
let coalesceKey: string | null = null;
let coalesceAt = 0;

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

/**
 * The board itself. Change it and every prop has to be put back on it: a prop
 * left at its old spot after the board shrank hangs in mid air beside it, which
 * is the "floating parts I can't move" the user hit.
 */
function boardKey(d: StudioDocument): string {
  return JSON.stringify([d.board.shape, d.board.margin ?? 0]);
}

/** Put every prop back on the board after a board change (no-op when they all already are). */
function keepPropsOnBoard(doc: StudioDocument): StudioDocument {
  if (doc.props.length === 0) return doc;
  const at = doc.props.map((p) => clampPropToBoard(doc, p.x, p.y));
  if (at.every(([x, y], i) => x === doc.props[i].x && y === doc.props[i].y)) return doc;
  return produce(doc, (d) => {
    d.props.forEach((p, i) => {
      p.x = Math.round(at[i][0] * 1000) / 1000;
      p.y = Math.round(at[i][1] * 1000) / 1000;
    });
  });
}

/**
 * Which edit moved the scatter, said the way the user would say it. Feeds the
 * studio bar's message so an automatic re-place always names its cause.
 */
function scatterReason(prev: StudioDocument, next: StudioDocument): string {
  const s = (d: StudioDocument) => JSON.stringify(d.board.shape) + '|' + (d.board.margin ?? 0);
  if (s(prev) !== s(next)) return 'the new board size';
  if (prev.ground.presetId !== next.ground.presetId) return 'the new ground style';
  if (prev.rules.density !== next.rules.density) return 'how much you asked for';
  if (prev.rules.heroProps !== next.rules.heroProps) return 'the centrepiece setting';
  if (JSON.stringify(prev.rules.footZones) !== JSON.stringify(next.rules.footZones)) return 'the flat spots you changed';
  if (prev.rules.rimInset !== next.rules.rimInset) return 'the gap you left round the edge';
  if (prev.rules.heightCap !== next.rules.heightCap || prev.rules.sink !== next.rules.sink) return 'the new prop rules';
  const before = (prev.library ?? []).length, after = (next.library ?? []).length;
  if (after > before) return 'the props you just added';
  if (after < before) return 'the props you have left';
  return 'the prop settings you changed';
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
  notice: null,
  error: null,
  history: [],
  future: [],
  selectedPropId: null,
  transformMode: 'move',

  open(rawDoc) {
    const doc = normalizeStudioDocument(rawDoc);
    coalesceKey = null;
    set({ doc, tab: 'board', preview: null, dirty: true, error: null, confirmRemove: null, notice: null, history: [], future: [], selectedPropId: null });
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
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    noticeSerial++;
    pendingRescatter = false;
    pendingReason = null;
    coalesceKey = null;
    set({ doc: null, preview: null, previewing: false, dirty: false, confirmRemove: null, notice: null, selectedPropId: null });
  },

  setTab(tab) { set({ tab }); },
  setViewMode(viewMode) { set({ viewMode }); },

  select(id) {
    if (id !== null && !get().doc?.props.some((p) => p.id === id)) return;
    set({ selectedPropId: id });
  },

  setTransformMode(transformMode) { set({ transformMode }); },

  editProp(id, patch, options) {
    const doc = get().doc;
    if (!doc) return;
    const prop = doc.props.find((p) => p.id === id);
    if (!prop) return;
    const wantX = patch.x ?? prop.x;
    const wantY = patch.y ?? prop.y;
    const [x, y] = clampPropToBoard(doc, wantX, wantY);
    get().update((d) => {
      const t = d.props.find((p) => p.id === id);
      if (!t) return;
      t.x = Math.round(x * 1000) / 1000;
      t.y = Math.round(y * 1000) / 1000;
      if (patch.rotDeg !== undefined) t.rotDeg = Math.round((((patch.rotDeg % 360) + 360) % 360) * 10) / 10;
      if (patch.scale !== undefined) t.scale = Math.max(0.1, Math.min(10, patch.scale));
      if (patch.sink !== undefined) t.sink = Math.max(0, Math.min(20, patch.sink));
      // a prop the user has touched is theirs: placing the others again never moves it
      t.scattered = false;
    }, { coalesce: options?.coalesce });
    set({ selectedPropId: id });
  },

  commitPropTransform(id, t) {
    const prop = get().doc?.props.find((p) => p.id === id);
    if (!prop) return;
    get().editProp(id, {
      x: t.x ?? prop.x,
      y: t.y ?? prop.y,
      rotDeg: t.rotDegDelta !== undefined ? prop.rotDeg + t.rotDegDelta : undefined,
      scale: t.scaleFactor !== undefined ? prop.scale * t.scaleFactor : undefined,
    });
  },

  removeProp(id) {
    if (get().selectedPropId === id) set({ selectedPropId: null });
    get().update((d) => { d.props = d.props.filter((p) => p.id !== id); });
  },

  update(recipe, options) {
    const doc = get().doc;
    if (!doc) return;
    let next = produce(doc, recipe);
    if (next === doc) return;
    // a new board size or shape drags every prop back onto it, in the SAME edit,
    // so one undo takes back the resize and the props it moved together
    if (boardKey(doc) !== boardKey(next)) next = keepPropsOnBoard(next);
    // one box being typed in keeps adding to the same undo step for a moment
    const key = options?.coalesce ?? null;
    const merge = key !== null && key === coalesceKey && Date.now() - coalesceAt < COALESCE_MS && get().history.length > 0;
    const history = options?.history === false || merge ? get().history : [...get().history.slice(-49), doc];
    if (options?.history !== false) { coalesceKey = key; coalesceAt = Date.now(); }
    const selectedPropId = next.props.some((p) => p.id === get().selectedPropId) ? get().selectedPropId : null;
    set({ doc: next, dirty: true, history, future: [], selectedPropId });
    // keep the project's copy current so it saves with the file
    useAppStore.getState().saveStudioDocument(next);
    // an edit that moves the scatter's ground rules re-rolls it (same seed, hand-placed props kept);
    // the re-scatter lands in THIS history entry, so one undo takes back the edit and the scatter
    if (!rescattering && scatterKey(doc) !== scatterKey(next) && (doc.props.some((p) => p.scattered) || next.props.some((p) => p.scattered))) {
      // several quick edits batch into one re-place and one message (the preview debounce below)
      if (!pendingRescatter) pendingReason = scatterReason(doc, next);
      pendingRescatter = true;
    }
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      void (async () => {
        if (pendingRescatter) {
          pendingRescatter = false;
          const reason = pendingReason ?? 'your change';
          pendingReason = null;
          await get().scatter(false, { history: false });
          // announce it: an automatic re-place must never look like the app losing the user's work
          if (get().doc) get().showRescatterNotice(reason);
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
    pendingReason = null;
    coalesceKey = null;
    get().dismissNotice();
    set({ doc: prev, history: history.slice(0, -1), future: [doc, ...get().future].slice(0, 50), dirty: true });
    useAppStore.getState().saveStudioDocument(prev);
    void get().refreshPreview();
  },

  redo() {
    const { future, doc } = get();
    if (!doc || future.length === 0) return;
    const next = future[0];
    pendingRescatter = false;
    pendingReason = null;
    coalesceKey = null;
    get().dismissNotice();
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
        if (doc.library.length === 0 && !doc.props.some((p) => p.scattered)) { pendingRescatter = true; pendingReason = FIRST_SCATTER; }
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

  showRescatterNotice(reason) {
    const serial = ++noticeSerial;
    if (noticeTimer) clearTimeout(noticeTimer);
    const text = reason === FIRST_SCATTER
      ? 'Your props were scattered over the ground — Undo takes them off again.'
      : `Props were placed again to fit ${reason} — Undo puts them back.`;
    set({ notice: { text, undoable: get().history.length > 0 } });
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (serial === noticeSerial) set({ notice: null });
    }, NOTICE_MS);
  },

  dismissNotice() {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    noticeSerial++;
    set({ notice: null });
  },

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
      set({ preview: { ground: res.ground, props: res.props, propRanges: res.propRanges, placements: res.placements, bounds: res.bounds, propCount: res.propCount, warnings: res.warnings, ms: Math.round(performance.now() - t0) }, previewing: false, error: null });
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
