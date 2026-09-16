import { describe, it, expect } from 'vitest';
import { newStudioDocument } from '@/kernel/studio/document';
import type { StudioDocument, StudioLibraryItem } from '@/kernel/studio/document';
import { bakeStudio, buildGround, effectiveHeightCap, scatterScene, NO_ASSETS, PROP_SCALE_RANGE } from '@/kernel/studio/bake';
import type { PropSource } from '@/kernel/studio/bake';
import type { Prop } from '@/kernel/props/prop';
import { computePiece, sourceFrame, rootPieceParams } from '@/kernel/pipeline/computePiece';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { addBox, DEFAULT_HOLLOW } from '@/kernel/body/hollow';
import { presupport } from '@/kernel/pipeline/presupport';
import { isWatertight } from '@/kernel/mesh/validate';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { sampleHeight } from '@/kernel/terrain/heightfield';
import { minEdgeDistance } from '@/kernel/geom2d/polygon';
import { rectPolygon } from '@/kernel/geom2d/shapes';
import { SoupBuilder } from '@/kernel/types';
import type { EdgeTreatment } from '@/kernel/types';

const PLATE = 2.984;

/** A closed box prop standing on z = 0, like a (very plain) user STL. */
function boxProp(w: number, h: number): Prop {
  const b = new SoupBuilder();
  addBox(b, -w / 2, -w / 2, 0, w / 2, w / 2, h);
  return { soup: b.buildCopy(), footprintRadius: Math.hypot(w / 2, w / 2), height: h, underground: 0 };
}

/** Two library items, as if the user had imported two STLs. */
const LIBRARY: StudioLibraryItem[] = [
  { id: 'lib-rock', name: 'My rock', fileName: 'rock.stl', fileSize: 1234, family: 'rock', licence: 'own-rights', weight: 1 },
  { id: 'lib-debris', name: 'My debris', fileName: 'debris.stl', fileSize: 2345, family: 'debris', licence: 'cc0', weight: 1 },
];

const GEOMETRY: Record<string, Prop> = {
  'lib-rock': boxProp(4, 4),
  'lib-debris': boxProp(3, 2.5),
};

/** The worker's side of the library: geometry only, keyed by library item id. */
const SOURCE: PropSource = { get: (id) => GEOMETRY[id] ?? null };

function deckDoc(): StudioDocument {
  const d = newStudioDocument('Deck test', { kind: 'rect', w: 125, d: 50 }, 'scifi-deck');
  d.id = 'st-test-deck';
  d.ground.seed = 5;
  d.scatterSeed = 9;
  d.library = LIBRARY.map((it) => ({ ...it }));
  d.rules.footZones = [{ x: -50, y: 0, r: 7 }, { x: 0, y: 0, r: 7 }, { x: 50, y: 0, r: 7 }];
  return d;
}

describe('Base Studio scenes', () => {
  it('scatters the same scene twice for a seed and keeps the rules', () => {
    const d = deckDoc();
    const a = scatterScene(d, SOURCE);
    const b = scatterScene(d, SOURCE);
    expect(a.length).toBeGreaterThan(5);
    expect(a).toEqual(b);
    const ids = new Set(LIBRARY.map((it) => it.id));
    const poly = rectPolygon(125, 50);
    for (const p of a) {
      expect(p.scattered).toBe(true);
      expect(ids.has(p.assetId)).toBe(true); // only the user's own props are ever placed
      expect(p.scale).toBeGreaterThanOrEqual(PROP_SCALE_RANGE[0] - 1e-6);
      // the user's props are already at the size they sculpted; only the centrepiece is grown
      expect(p.scale).toBeLessThanOrEqual((p.hero ? 1.4 : 1) * PROP_SCALE_RANGE[1] + 1e-6);
      expect(minEdgeDistance(poly, p.x, p.y)).toBeGreaterThanOrEqual(d.rules.rimInset - 1e-6);
      for (const z of d.rules.footZones) expect(Math.hypot(p.x - z.x, p.y - z.y)).toBeGreaterThanOrEqual(z.r - 1e-6);
    }
    // the sci-fi deck asks for scifi and debris, so the rock is left out of the pool
    expect(a.every((p) => p.assetId === 'lib-debris')).toBe(true);
    expect(a[0].licence).toBe('cc0'); // the licence comes from the library item
    const other = { ...d, scatterSeed: 10 };
    expect(scatterScene(other, SOURCE)).not.toEqual(a);
    // hand-placed props survive a scatter and are kept clear of
    const withHand: StudioDocument = { ...d, props: [{ id: 'hand', assetId: 'lib-rock', x: 20, y: 5, rotDeg: 0, scale: 1, sink: 0, seed: 1, licence: 'own-rights', scattered: false }] };
    const c = scatterScene(withHand, SOURCE);
    expect(c.find((p) => p.id === 'hand')).toBeTruthy();
    expect(c.filter((p) => !p.scattered).length).toBe(1);
    for (const p of c.filter((q) => q.scattered)) expect(Math.hypot(p.x - 20, p.y - 5)).toBeGreaterThan(1);
  });

  it('scatters nothing at all without the user’s own STLs', () => {
    const empty = { ...deckDoc(), library: [] };
    expect(scatterScene(empty, SOURCE)).toEqual([]);
    // a library whose files are not loaded (no geometry in the worker) is the same case
    expect(scatterScene(deckDoc(), NO_ASSETS)).toEqual([]);
    // hand-placed props are still kept
    const hand: StudioDocument = { ...deckDoc(), library: [], props: [{ id: 'hand', assetId: 'lib-rock', x: 0, y: 0, rotDeg: 0, scale: 1, sink: 0, seed: 1, licence: 'own-rights', scattered: false }] };
    expect(scatterScene(hand, SOURCE).map((p) => p.id)).toEqual(['hand']);
  });

  it('uses every library item a preset asks for, weighted by the item', () => {
    const d = deckDoc();
    // 'any' is picked by every preset, so both props are in the pool
    d.library = [{ ...LIBRARY[0], family: 'any' }, { ...LIBRARY[1] }];
    const props = scatterScene(d, SOURCE);
    const used = new Set(props.map((p) => p.assetId));
    expect(used.has('lib-rock')).toBe(true);
    expect(used.has('lib-debris')).toBe(true);
    // weight 0 on an item keeps it out of the draw
    d.library = [{ ...LIBRARY[0], family: 'any', weight: 0 }, { ...LIBRARY[1], weight: 5 }];
    const only = scatterScene(d, SOURCE);
    expect(only.filter((p) => p.assetId === 'lib-rock').length).toBeLessThan(only.length / 4);
  });

  it('levels the ground in foot zones and caps prop heights by board size', () => {
    const d = deckDoc();
    const hf = buildGround(d);
    for (const z of d.rules.footZones) {
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 12; a++) for (let r = 0; r <= z.r - 0.5; r += 1.5) {
        const h = sampleHeight(hf, z.x + Math.cos(a) * r, z.y + Math.sin(a) * r);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      expect(hi - lo).toBeLessThan(0.31);
      expect(lo).toBeGreaterThanOrEqual(PLATE - 1e-6);
    }
    expect(effectiveHeightCap(d)).toBeGreaterThan(0);
    expect(effectiveHeightCap({ ...d, rules: { ...d.rules, heightCap: 4 } })).toBe(4);
    const small = newStudioDocument('small', { kind: 'ellipse', w: 25, d: 25 }, 'forest-floor');
    expect(effectiveHeightCap(small)).toBeLessThanOrEqual(6);
  });

  it('bakes a sci-fi deck into a two-shell source the cutter turns into a supported 25 mm base', () => {
    const d = deckDoc();
    d.props = scatterScene(d, SOURCE);
    const res = bakeStudio(d, SOURCE);
    expect(res.warnings).toEqual([]);
    expect(res.propCount).toBe(d.props.length);
    expect(res.propCount).toBeGreaterThan(5);
    const src = res.prepared;
    expect(src.mode).toBe('twoShell');
    expect(src.nominal).toEqual({ kind: 'rect', w: 125, d: 50 });
    expect(src.outline.plateTop).toBeCloseTo(PLATE, 6);
    expect(src.sculpt.triCount).toBeGreaterThan(5000);
    expect(src.warnings).toEqual([]);

    const root = computePiece(sourceFrame(src), rootPieceParams(src), { source: src, skipSculpt: true, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(root.body)).toBe(true);
    const edges: EdgeTreatment[] = [{ kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];
    const slots = magnetSlotSpecs({ dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 24 }, [{ x: 0, y: 0 }]);
    const base = computePiece(root.frame, { shape: { kind: 'rect', w: 25, d: 25 }, xy: [-50, 0], rotDeg: 0, edges, profile: { kind: 'inset', inset: 0, height: 3 } }, { source: src, magnetSlots: slots, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(base.body)).toBe(true);
    expect(base.underside?.depth).toBeCloseTo(2, 6);
    const sculpt = base.sculptMesh ? { positions: new Float32Array(0), triCount: 0 } : base.sculpt;
    expect(sculpt.triCount).toBeGreaterThan(100);
    const sb = boundsOfSoup(sculpt);
    expect(sb.min[0]).toBeGreaterThanOrEqual(-12.5 - 0.15);
    expect(sb.max[0]).toBeLessThanOrEqual(12.5 + 0.15);
    expect(sb.max[2]).toBeGreaterThan(PLATE + 0.3);
    const sup = presupport({ body: base.body, sculpt, bottom: base.outline.bottom, slots, underside: base.underside });
    expect(sup.warnings).toEqual([]);
    expect(isWatertight(sup.supports)).toBe(true);
  });

  it('bakes a round fantasy board clipped to its footprint', () => {
    const d = newStudioDocument('round', { kind: 'ellipse', w: 40, d: 40 }, 'forest-floor');
    d.id = 'st-test-round';
    d.ground.seed = 3;
    d.scatterSeed = 4;
    d.library = LIBRARY.map((it) => ({ ...it }));
    d.props = scatterScene(d, SOURCE);
    const res = bakeStudio(d, SOURCE);
    expect(res.warnings).toEqual([]);
    const v = res.prepared.sculpt.vertices;
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < res.prepared.sculpt.vertexCount * 3; i += 3) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], v[i + k]); b.max[k] = Math.max(b.max[k], v[i + k]); }
    expect(b.max[0]).toBeLessThanOrEqual(20 + 0.2);
    expect(b.min[1]).toBeGreaterThanOrEqual(-20 - 0.2);
    expect(b.min[2]).toBeGreaterThanOrEqual(PLATE - 0.1 - 1e-3);
    expect(b.max[2] - PLATE).toBeLessThanOrEqual(effectiveHeightCap(d) + 3);
    const src = res.prepared;
    const root = computePiece(sourceFrame(src), rootPieceParams(src), { source: src, skipSculpt: true, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(root.body)).toBe(true);
    const base = computePiece(root.frame, { shape: { kind: 'ellipse', w: 25, d: 25 }, xy: [0, 0], rotDeg: 0, edges: [{ kind: 'bevel' }], profile: { kind: 'inset', inset: 0, height: 3 } }, { source: src, hollow: DEFAULT_HOLLOW });
    expect(isWatertight(base.body)).toBe(true);
    const sculpt = base.sculptMesh ? { positions: new Float32Array(0), triCount: 0 } : base.sculpt;
    expect(sculpt.triCount).toBeGreaterThan(100);
    const sb = boundsOfSoup(sculpt);
    expect(Math.max(sb.max[0], -sb.min[0], sb.max[1], -sb.min[1])).toBeLessThanOrEqual(12.5 + 0.15);
  });
});
