/**
 * Base Studio state: the document being edited, its live preview meshes and
 * the actions that talk to the worker. Meshes stay in this store and reach
 * three.js through refs (never through React props).
 */
import { create } from 'zustand';
import { produce } from 'immer';
import { kernel, withTimeout } from '@/worker/client';
import * as Comlink from 'comlink';
import type { Bounds3 } from '@/kernel/types';
import type { MeshTransfer, StudioAssetInfo } from '@/worker/api';
import type { StudioDocument } from '@/kernel/studio/document';
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
  assets: StudioAssetInfo[];
  assetsState: 'idle' | 'loading' | 'ready' | 'error';
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
  ensureAssets(): Promise<void>;
  scatter(reroll?: boolean): Promise<void>;
  clearScatter(): void;
  refreshPreview(): Promise<void>;
  /** bake and hand the scene to the cutter; resolves with the source id */
  useScene(): Promise<string | null>;
}

const PREVIEW_TIMEOUT = 60_000;
const BAKE_TIMEOUT = 180_000;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSerial = 0;

async function loadPack(): Promise<{ id: string; family: string; glb: ArrayBuffer }[]> {
  const base = new URL('assets/packs/core/', document.baseURI);
  const manifest = (await (await fetch(new URL('manifest.json', base))).json()) as { assets: { id: string; family: string; file: string }[] };
  const out: { id: string; family: string; glb: ArrayBuffer }[] = [];
  await Promise.all(
    manifest.assets.map(async (a) => {
      try {
        const r = await fetch(new URL(a.file, base));
        if (r.ok) out.push({ id: a.id, family: a.family, glb: await r.arrayBuffer() });
      } catch {
        /* a missing asset only means fewer rocks */
      }
    }),
  );
  return out;
}

export const useStudioStore = create<StudioState>()((set, get) => ({
  doc: null,
  tab: 'board',
  viewMode: 'orbit',
  preview: null,
  previewing: false,
  baking: false,
  dirty: false,
  assets: [],
  assetsState: 'idle',
  error: null,
  history: [],
  future: [],

  open(doc) {
    set({ doc, tab: 'board', preview: null, dirty: true, error: null, history: [], future: [] });
    void get().ensureAssets().then(async () => {
      // a fresh scene starts populated (the user can re-roll or clear it); a saved one keeps its props
      if (get().doc?.id === doc.id && doc.props.length === 0) await get().scatter(false);
      await get().refreshPreview();
    });
  },

  close() {
    if (previewTimer) clearTimeout(previewTimer);
    set({ doc: null, preview: null, previewing: false, dirty: false });
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
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { void get().refreshPreview(); }, 250);
  },

  undo() {
    const { history, doc } = get();
    if (!doc || history.length === 0) return;
    const prev = history[history.length - 1];
    set({ doc: prev, history: history.slice(0, -1), future: [doc, ...get().future].slice(0, 50), dirty: true });
    useAppStore.getState().saveStudioDocument(prev);
    void get().refreshPreview();
  },

  redo() {
    const { future, doc } = get();
    if (!doc || future.length === 0) return;
    const next = future[0];
    set({ doc: next, future: future.slice(1), history: [...get().history, doc], dirty: true });
    useAppStore.getState().saveStudioDocument(next);
    void get().refreshPreview();
  },

  async ensureAssets() {
    if (get().assetsState !== 'idle') return;
    set({ assetsState: 'loading' });
    try {
      const pack = await loadPack();
      const infos = await withTimeout(
        kernel().registerStudioAssets(Comlink.transfer(pack, pack.map((a) => a.glb))),
        PREVIEW_TIMEOUT,
        'Loading the prop pack',
      );
      set({ assets: infos.filter((a) => a.tris > 0 && a.closed), assetsState: 'ready' });
    } catch (err) {
      set({ assetsState: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  async scatter(reroll = true) {
    const doc = get().doc;
    if (!doc) return;
    await get().ensureAssets();
    const seeded = reroll ? produce(doc, (d) => { d.scatterSeed = (d.scatterSeed * 1103515245 + 12345) >>> 0; }) : doc;
    try {
      const props = await withTimeout(kernel().scatterStudio(seeded), PREVIEW_TIMEOUT, 'Scattering props');
      get().update((d) => { d.scatterSeed = seeded.scatterSeed; d.props = props; });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
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
      await get().ensureAssets();
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
