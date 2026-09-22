/**
 * Base Studio's store, the part the user touches when they pick a prop up in
 * the view: selecting, dragging (committed as one change), typing the numbers,
 * staying on the board, and surviving the next re-roll.
 *
 * The geometry worker is stubbed with the very kernel functions the real worker
 * calls, so the numbers here are the numbers the app sees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { newStudioDocument, studioId } from '@/kernel/studio/document';
import type { StudioDocument, StudioLibraryItem } from '@/kernel/studio/document';
import { buildGround, placeProp, previewCell, propClearance, scatterScene, groundClip } from '@/kernel/studio/bake';
import type { PropSource } from '@/kernel/studio/bake';
import { heightfieldToSlab } from '@/kernel/terrain/mesh';
import type { Prop } from '@/kernel/props/prop';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { addBox } from '@/kernel/body/hollow';
import { SoupBuilder } from '@/kernel/types';
import type { StudioPlacement, StudioPropRange } from '@/worker/api';

/** A closed box prop standing on z = 0, like a (very plain) user STL. */
function boxProp(w: number, h: number): Prop {
  const b = new SoupBuilder();
  addBox(b, -w / 2, -w / 2, 0, w / 2, w / 2, h);
  return { soup: b.buildCopy(), footprintRadius: Math.hypot(w / 2, w / 2), height: h, underground: 0 };
}

const GEOMETRY: Record<string, Prop> = { 'lib-rock': boxProp(6, 6), 'lib-plank': boxProp(12, 3) };
const SOURCE: PropSource = { get: (id) => GEOMETRY[id] ?? null };
const LIBRARY: StudioLibraryItem[] = [
  { id: 'lib-rock', name: 'My rock', fileName: 'rock.stl', fileSize: 1, family: 'any', licence: 'own-rights', weight: 1 },
  { id: 'lib-plank', name: 'My plank', fileName: 'plank.stl', fileSize: 2, family: 'any', licence: 'own-rights', weight: 1 },
];

/** The worker's two studio calls, done with the same kernel code the worker uses. */
vi.mock('@/worker/client', () => ({
  withTimeout: <T,>(p: Promise<T>) => p,
  resetKernel: () => {},
  progressProxy: (c: unknown) => c,
  kernelGeneration: () => 1,
  kernel: () => ({
    registerStudioAssets: async () => [],
    unregisterStudioAssets: async () => {},
    scatterStudio: async (doc: StudioDocument) => scatterScene(doc, SOURCE),
    previewStudio: async (doc: StudioDocument) => {
      const hf = buildGround(doc, previewCell(doc));
      const clip = groundClip(doc);
      const slab = heightfieldToSlab(hf, { zBase: doc.board.plateTop - 0.1, clipTo: clip });
      const propRanges: StudioPropRange[] = [];
      const placements: StudioPlacement[] = [];
      const soups: { positions: Float32Array; triCount: number }[] = [];
      let tri = 0;
      for (const p of doc.props) {
        const prop = SOURCE.get(p.assetId);
        if (!prop) continue;
        const placed = placeProp(prop, p, hf, doc.rules.sink, doc.board.plateTop, clip);
        soups.push(placed.soup);
        propRanges.push({ id: p.id, start: tri, count: placed.soup.triCount });
        placements.push({ id: p.id, x: placed.x, y: placed.y, z: placed.z, rotDeg: p.rotDeg, scale: p.scale });
        tri += placed.soup.triCount;
      }
      const positions = new Float32Array(tri * 9);
      let at = 0;
      for (const s of soups) { positions.set(s.positions.subarray(0, s.triCount * 9), at); at += s.triCount * 9; }
      return {
        ground: { positions: slab.positions.slice(0, slab.triCount * 9), triCount: slab.triCount },
        props: { positions, triCount: tri },
        propRanges,
        placements,
        bounds: boundsOfSoup(slab),
        propCount: propRanges.length,
        warnings: [],
        timings: {},
      };
    },
  }),
}));

const { useStudioStore } = await import('@/studio/store');

/** A 60 mm round board with 1.5 mm of spare ground and one prop in the middle, no async open(). */
function loadScene(): { doc: StudioDocument; propId: string } {
  const doc = newStudioDocument('Store test', { kind: 'ellipse', w: 60, d: 60 }, 'forest-floor', 1.5);
  doc.ground.seed = 21;
  doc.scatterSeed = 22;
  doc.library = LIBRARY.map((it) => ({ ...it }));
  const propId = studioId('pr');
  doc.props = [{ id: propId, assetId: 'lib-rock', x: 0, y: 0, rotDeg: 0, scale: 1, sink: 0, seed: 3, licence: 'own-rights', scattered: false }];
  useStudioStore.setState({ doc, history: [], future: [], selectedPropId: null, transformMode: 'move', preview: null, notice: null, error: null });
  return { doc, propId };
}

const doc = () => useStudioStore.getState().doc!;
const propOf = (id: string) => doc().props.find((p) => p.id === id)!;

describe('Base Studio: picking a prop up and moving it', () => {
  beforeEach(() => { useStudioStore.setState({ doc: null, history: [], future: [], selectedPropId: null }); });

  it('selects only props that exist and forgets one that goes away', () => {
    const { propId } = loadScene();
    const st = useStudioStore.getState();
    st.select('no-such-prop');
    expect(useStudioStore.getState().selectedPropId).toBeNull();
    st.select(propId);
    expect(useStudioStore.getState().selectedPropId).toBe(propId);
    st.removeProp(propId);
    expect(useStudioStore.getState().selectedPropId).toBeNull();
    expect(doc().props).toHaveLength(0);
  });

  it('commits a drag as one change: new place, turn and size, and the prop becomes the user’s', () => {
    const { propId } = loadScene();
    const st = useStudioStore.getState();
    st.select(propId);
    const before = useStudioStore.getState().history.length;
    st.commitPropTransform(propId, { x: 10, y: -5, rotDegDelta: 45, scaleFactor: 1.2 });
    const p = propOf(propId);
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.y).toBeCloseTo(-5, 6);
    expect(p.rotDeg).toBeCloseTo(45, 6);
    expect(p.scale).toBeCloseTo(1.2, 6);
    expect(p.scattered).toBe(false);
    expect(useStudioStore.getState().history.length).toBe(before + 1); // one undo step for the whole drag
    expect(useStudioStore.getState().selectedPropId).toBe(propId);
    // turning again adds to the turn it already had, and resizing again multiplies
    st.commitPropTransform(propId, { rotDegDelta: 45, scaleFactor: 0.5 });
    expect(propOf(propId).rotDeg).toBeCloseTo(90, 6);
    expect(propOf(propId).scale).toBeCloseTo(0.6, 6);
    // and one undo puts the whole thing back
    useStudioStore.getState().undo();
    expect(propOf(propId).rotDeg).toBeCloseTo(45, 6);
  });

  it('keeps a prop dragged off the board on the board', () => {
    const { propId } = loadScene();
    const st = useStudioStore.getState();
    const clear = propClearance(doc());
    st.commitPropTransform(propId, { x: 200, y: 140 });
    const p = propOf(propId);
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(31.5 - clear + 0.2);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
    // typing an impossible number does the same thing
    st.editProp(propId, { x: -500 });
    expect(propOf(propId).x).toBeGreaterThan(-31.5);
    expect(propOf(propId).x).toBeLessThan(0);
  });

  it('drags every prop back onto a board that changed shape or size, in one undo step', () => {
    const { propId } = loadScene();
    const st = useStudioStore.getState();
    // four props out at the corners of a much bigger board than the one they end up on
    st.update((d) => {
      [[-70, -45], [70, -45], [70, 45], [-70, 45]].forEach((c, i) => {
        d.props.push({ id: 'far' + i, assetId: 'lib-rock', x: c[0], y: c[1], rotDeg: 0, scale: 1, sink: 0, seed: i, licence: 'own-rights', scattered: false });
      });
      d.board.shape = { kind: 'rect', w: 150, d: 100 };
      d.board.margin = 0;
    });
    expect(propOf('far0').x).toBe(-70); // still on the big board, so nothing moved
    const before = useStudioStore.getState().history.length;
    st.update((d) => { d.board.shape = { kind: 'ellipse', w: 60, d: 60 }; d.board.margin = 1.5; });
    // a prop left at its old spot would hang in mid air beside the new board
    const limit = 31.5 - propClearance(doc()) + 1e-6;
    for (const p of doc().props) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(limit);
    expect(propOf(propId).x).toBe(0); // one that was already on the board is untouched
    expect(useStudioStore.getState().history.length).toBe(before + 1);
    // and one undo puts the board AND the props back
    useStudioStore.getState().undo();
    expect(doc().board.shape.w).toBe(150);
    expect(propOf('far0').x).toBe(-70);
  });

  it('folds a number being typed into one undo step, and starts a new one for the next box', () => {
    const { propId } = loadScene();
    const st = useStudioStore.getState();
    const before = useStudioStore.getState().history.length;
    // "-18" arrives one keystroke at a time from the same box
    st.editProp(propId, { x: -1 }, { coalesce: 'x' });
    st.editProp(propId, { x: -18 }, { coalesce: 'x' });
    expect(propOf(propId).x).toBe(-18);
    expect(useStudioStore.getState().history.length).toBe(before + 1);
    // a different box is a change of its own
    useStudioStore.getState().editProp(propId, { y: 7 }, { coalesce: 'y' });
    expect(useStudioStore.getState().history.length).toBe(before + 2);
    // one undo takes back the whole number, not the last key of it
    useStudioStore.getState().undo();
    useStudioStore.getState().undo();
    expect(propOf(propId).x).toBe(0);
  });

  it('names every number, and every number stays in its limits', () => {
    const { propId } = loadScene();
    const st = useStudioStore.getState();
    st.editProp(propId, { scale: 99 });
    expect(propOf(propId).scale).toBe(10);
    st.editProp(propId, { scale: -3 });
    expect(propOf(propId).scale).toBe(0.1);
    st.editProp(propId, { rotDeg: 400 });
    expect(propOf(propId).rotDeg).toBeCloseTo(40, 6);
    st.editProp(propId, { rotDeg: -90 });
    expect(propOf(propId).rotDeg).toBeCloseTo(270, 6);
    st.editProp(propId, { sink: -1 });
    expect(propOf(propId).sink).toBe(0);
    st.editProp(propId, { sink: 1.5 });
    expect(propOf(propId).sink).toBe(1.5);
  });

  it('a prop the user moved survives placing the others again, and a scattered one becomes theirs when touched', async () => {
    const { propId } = loadScene();
    const st = useStudioStore.getState();
    await st.scatter(true, { history: false });
    const scattered = doc().props.filter((p) => p.scattered);
    expect(scattered.length).toBeGreaterThan(2);
    // the hand-placed one is still exactly where it was
    expect(propOf(propId).x).toBe(0);
    // touch a scattered one: it stops being a scattered one
    const victim = scattered[0];
    useStudioStore.getState().commitPropTransform(victim.id, { x: victim.x + 1, y: victim.y });
    expect(propOf(victim.id).scattered).toBe(false);
    const movedTo = { x: propOf(victim.id).x, y: propOf(victim.id).y };
    // re-roll: it must not move
    await useStudioStore.getState().scatter(true, { history: false });
    expect(propOf(victim.id).x).toBeCloseTo(movedTo.x, 6);
    expect(propOf(victim.id).y).toBeCloseTo(movedTo.y, 6);
  });

  it('gives the view a triangle range and a resolved height per prop, and every prop touches the ground', async () => {
    const { propId } = loadScene();
    const st = useStudioStore.getState();
    st.editProp(propId, { x: 8, y: -6, scale: 1.4 });
    await useStudioStore.getState().scatter(true, { history: false });
    await useStudioStore.getState().refreshPreview();
    const preview = useStudioStore.getState().preview!;
    expect(preview.propRanges).toHaveLength(doc().props.length);
    expect(preview.placements).toHaveLength(doc().props.length);
    // the ranges tile the merged mesh exactly, in document order
    let at = 0;
    preview.propRanges.forEach((r, i) => {
      expect(r.id).toBe(doc().props[i].id);
      expect(r.start).toBe(at);
      at += r.count;
    });
    expect(at).toBe(preview.props.triCount);
    // every prop was dropped onto the ground: its lowest point is buried, not floating
    const hf = buildGround(doc(), previewCell(doc()));
    for (const r of preview.propRanges) {
      const at2 = preview.placements.find((p) => p.id === r.id)!;
      const prop = doc().props.find((p) => p.id === r.id)!;
      const placed = placeProp(SOURCE.get(prop.assetId)!, prop, hf, doc().rules.sink, doc().board.plateTop, groundClip(doc()));
      expect(placed.z).toBeCloseTo(at2.z, 6);
      expect(at2.x).toBeCloseTo(prop.x, 6);
      expect(at2.rotDeg).toBeCloseTo(prop.rotDeg, 6);
    }
    // and the picked prop's own slice of the mesh really is where its handle will hang
    const mine = preview.propRanges.find((r) => r.id === propId)!;
    const at3 = preview.placements.find((p) => p.id === propId)!;
    const b = boundsOfSoup({ positions: preview.props.positions.subarray(mine.start * 9, (mine.start + mine.count) * 9), triCount: mine.count });
    expect(at3.x).toBeGreaterThanOrEqual(b.min[0] - 1e-3);
    expect(at3.x).toBeLessThanOrEqual(b.max[0] + 1e-3);
    expect(at3.z).toBeLessThanOrEqual(b.max[2] + 1e-3);
  });
});
