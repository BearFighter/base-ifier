import { describe, expect, it } from 'vitest';
import {
  allPresets,
  findPreset,
  magnetPresets,
  matchPresetsBySize,
  presetLabel,
  presetsForSystem,
  SYSTEMS,
} from '@/model/presets';
import { defaultEdges, defaultExportSettings, defaultMagnetSettings, defaultUndersideSettings, newId, newProject } from '@/model/defaults';
import {
  addPiece,
  ancestors,
  descendants,
  leaves,
  pieceDepth,
  pieceOriginInSource,
  pieceSize,
  removeSubtree,
  siblings,
} from '@/model/tree';
import type { Piece } from '@/model/types';

describe('bases.json preset catalog', () => {
  const systemIds = new Set(SYSTEMS.map((s) => s.id));

  it('defines the four expected systems', () => {
    expect(systemIds).toEqual(new Set(['opr', '40k', 'old-world', 'kow']));
  });

  it('gives every base and footprint positive w/d', () => {
    for (const p of allPresets()) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.d).toBeGreaterThan(0);
    }
  });

  it('references only systems that exist', () => {
    for (const p of allPresets()) {
      expect(systemIds.has(p.system)).toBe(true);
    }
  });

  it('has the expected counts per system', () => {
    const bases = allPresets().filter((p) => p.kind === 'base');
    const footprints = allPresets().filter((p) => p.kind === 'footprint');

    expect(presetsForSystem('opr').filter((p) => p.kind === 'base')).toHaveLength(22);
    expect(presetsForSystem('40k').filter((p) => p.kind === 'base')).toHaveLength(18);
    expect(presetsForSystem('old-world').filter((p) => p.kind === 'base')).toHaveLength(12);
    expect(presetsForSystem('old-world').filter((p) => p.kind === 'footprint')).toHaveLength(10);
    expect(presetsForSystem('kow').filter((p) => p.kind === 'base')).toHaveLength(11);
    expect(presetsForSystem('kow').filter((p) => p.kind === 'footprint')).toHaveLength(18);

    expect(bases.filter((p) => p.system === 'opr')).toHaveLength(22);
    expect(footprints).toHaveLength(28);
    expect(magnetPresets()).toHaveLength(12);
  });

  it('finds a known preset by system+name', () => {
    const p = findPreset('40k', '32mm round');
    expect(p).toBeDefined();
    expect(p?.shape).toEqual({ kind: 'ellipse', w: 32, d: 32 });
  });

  it('builds a readable label for base and footprint presets', () => {
    const base = findPreset('40k', '32mm round')!;
    expect(presetLabel(base)).toBe('32 x 32 mm — 32mm round (standard infantry)');

    const footprint = findPreset('kow', 'Heavy Infantry Troop')!;
    expect(presetLabel(footprint)).toBe('125 x 50 mm — Heavy Infantry Troop (10)');
  });

  it('matches 125x50 to the KoW Troop bases and the Old World Light Cavalry rank', () => {
    const matches = matchPresetsBySize(125, 50);
    const names = matches.map((p) => `${p.system}:${p.name}`);
    expect(names).toContain('kow:Heavy Infantry Troop');
    expect(names).toContain('kow:Cavalry Troop');
    expect(names).toContain('old-world:Light Cavalry rank (5 wide, 25x50mm)');
    expect(matches).toHaveLength(3);
  });

  it('matches the swapped orientation 50x125 identically', () => {
    const straight = matchPresetsBySize(125, 50);
    const swapped = matchPresetsBySize(50, 125);
    expect(swapped).toHaveLength(straight.length);
    expect(new Set(swapped.map((p) => p.name))).toEqual(new Set(straight.map((p) => p.name)));
  });
});

describe('model/defaults', () => {
  it('gives resin and fdm distinct tolerances, custom equal to resin', () => {
    const resin = defaultMagnetSettings('resin');
    const fdm = defaultMagnetSettings('fdm');
    const custom = defaultMagnetSettings('custom');
    expect(resin).toEqual({ dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, floorMin: 0.6, minWall: 1.0, sides: 48, printer: 'resin' });
    expect(fdm).toEqual({ dia: 3, thick: 2, radialTol: 0.2, depthTol: 0.15, floorMin: 0.8, minWall: 1.2, sides: 48, printer: 'fdm' });
    expect(custom).toEqual({ ...resin, printer: 'custom' });
  });

  it('defaultUndersideSettings is a hollow 2 mm void in a 2 mm brim with the watermark', () => {
    expect(defaultUndersideSettings()).toEqual({ hollow: true, voidDepth: 2, rimWidth: 2, ringHeight: 0.5, ringWidth: 0.4, watermark: 'BITDEATHLABS', watermarkHeight: 0.3 });
    expect(newProject().underside).toEqual(defaultUndersideSettings());
  });

  it('defaultExportSettings matches spec', () => {
    expect(defaultExportSettings()).toEqual({ sizing: 'source', clearanceMm: 0.25, plateGap: 3, presupport: { enabled: true, tiltDeg: null, standoff: 6, tipDiameter: 0.4, density: 'medium', bracing: 'light' } });
  });

  it('defaultEdges gives 4 bevels for rect and 1 for ellipse', () => {
    expect(defaultEdges({ kind: 'rect', w: 32, d: 32 })).toEqual([
      { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' },
    ]);
    expect(defaultEdges({ kind: 'ellipse', w: 32, d: 32 })).toEqual([{ kind: 'bevel' }]);
  });

  it('newProject produces an empty, well-formed project', () => {
    const p = newProject('My Project');
    expect(p.version).toBe(1);
    expect(p.name).toBe('My Project');
    expect(p.sources).toEqual({});
    expect(p.pieces).toEqual({});
    expect(p.selectedId).toBeNull();
  });

  it('newId produces unique, prefixed ids', () => {
    const a = newId('pc_');
    const b = newId('pc_');
    expect(a).not.toBe(b);
    expect(a.startsWith('pc_')).toBe(true);
  });
});

describe('model/tree', () => {
  function makePiece(overrides: Partial<Piece>): Piece {
    return {
      id: 'unset',
      sourceId: 'src1',
      parentId: null,
      name: 'Piece',
      shape: { kind: 'rect', w: 10, d: 10 },
      xy: [0, 0],
      rotDeg: 0,
      edges: defaultEdges({ kind: 'rect', w: 10, d: 10 }),
      magnets: { mode: 'auto', slots: [] },
      children: [],
      ...overrides,
    };
  }

  function buildProject() {
    const root: Piece = makePiece({ id: 'root1', parentId: null, xy: [0, 0], shape: { kind: 'rect', w: 100, d: 100 } });
    const a1: Piece = makePiece({ id: 'a1', parentId: 'root1', xy: [10, 5], shape: { kind: 'rect', w: 40, d: 40 } });
    const b1: Piece = makePiece({ id: 'b1', parentId: 'a1', xy: [-3, 2], shape: { kind: 'ellipse', w: 20, d: 20 } });
    const a2: Piece = makePiece({ id: 'a2', parentId: 'root1', xy: [-10, -5], shape: { kind: 'rect', w: 30, d: 30 } });

    let p = newProject('Tree Test');
    p = addPiece(p, root);
    p = addPiece(p, a1);
    p = addPiece(p, b1);
    p = addPiece(p, a2);
    return p;
  }

  it('addPiece registers pieces and links them into their parent children', () => {
    const p = buildProject();
    expect(Object.keys(p.pieces).sort()).toEqual(['a1', 'a2', 'b1', 'root1']);
    expect(p.pieces['root1'].children.sort()).toEqual(['a1', 'a2']);
    expect(p.pieces['a1'].children).toEqual(['b1']);
    expect(p.pieces['a2'].children).toEqual([]);
  });

  it('ancestors returns the chain root-first, excluding the piece itself', () => {
    const p = buildProject();
    expect(ancestors(p, 'b1').map((x) => x.id)).toEqual(['root1', 'a1']);
    expect(ancestors(p, 'root1')).toEqual([]);
  });

  it('descendants returns every descendant id, excluding the piece itself', () => {
    const p = buildProject();
    expect(new Set(descendants(p, 'root1'))).toEqual(new Set(['a1', 'a2', 'b1']));
    expect(descendants(p, 'a1')).toEqual(['b1']);
    expect(descendants(p, 'b1')).toEqual([]);
  });

  it('leaves returns pieces of a source with no children', () => {
    const p = buildProject();
    expect(new Set(leaves(p, 'src1').map((x) => x.id))).toEqual(new Set(['b1', 'a2']));
  });

  it('pieceDepth counts ancestors', () => {
    const p = buildProject();
    expect(pieceDepth(p, 'root1')).toBe(0);
    expect(pieceDepth(p, 'a1')).toBe(1);
    expect(pieceDepth(p, 'b1')).toBe(2);
  });

  it('siblings excludes self and only matches same parent', () => {
    const p = buildProject();
    expect(siblings(p, 'a1').map((x) => x.id)).toEqual(['a2']);
    expect(siblings(p, 'a2').map((x) => x.id)).toEqual(['a1']);
    expect(siblings(p, 'b1')).toEqual([]);
  });

  it('pieceOriginInSource sums xy up the ancestor chain', () => {
    const p = buildProject();
    expect(pieceOriginInSource(p, 'root1')).toEqual([0, 0]);
    expect(pieceOriginInSource(p, 'a1')).toEqual([10, 5]);
    expect(pieceOriginInSource(p, 'b1')).toEqual([7, 7]);
    expect(pieceOriginInSource(p, 'a2')).toEqual([-10, -5]);
  });

  it('pieceSize swaps w/d for a 90/270 degree rotation', () => {
    const piece = makePiece({ id: 'r', shape: { kind: 'rect', w: 100, d: 50 }, rotDeg: 90 });
    expect(pieceSize(piece)).toEqual({ w: 50, d: 100 });
    expect(pieceSize({ ...piece, rotDeg: 0 })).toEqual({ w: 100, d: 50 });
    expect(pieceSize({ ...piece, rotDeg: 270 })).toEqual({ w: 50, d: 100 });
    expect(pieceSize({ ...piece, rotDeg: 180 })).toEqual({ w: 100, d: 50 });
  });

  it('removeSubtree removes a piece and all its descendants, unlinking from its parent', () => {
    const p = buildProject();
    const p2 = removeSubtree(p, 'a1');
    expect(Object.keys(p2.pieces).sort()).toEqual(['a2', 'root1']);
    expect(p2.pieces['root1'].children).toEqual(['a2']);
  });

  it('removeSubtree clears selectedId if it was removed', () => {
    const p = { ...buildProject(), selectedId: 'b1' };
    const p2 = removeSubtree(p, 'a1');
    expect(p2.selectedId).toBeNull();
  });

  it('does not mutate the input project', () => {
    const p = buildProject();
    const before = JSON.stringify(p);
    removeSubtree(p, 'a1');
    expect(JSON.stringify(p)).toBe(before);
  });
});
