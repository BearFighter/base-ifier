import { describe, expect, it } from 'vitest';
import { chainFor, magnetRequestFor, sizingRequestFor, trayRequestFor, traySettingsFor } from '@/state/chain';
import { trayPiecesFor, trayShapeFor } from '@/state/derive';
import { placementError, usesFrames } from '@/model/rules';
import { formatMm } from '@/ui/util/format';
import { addPiece, leaves, pieceSize } from '@/model/tree';
import { defaultEdges, defaultExportSettings, defaultMagnetSettings, newProject } from '@/model/defaults';
import type { Piece, Project } from '@/model/types';
import type { SourceSummary } from '@/worker/api';

function makePiece(overrides: Partial<Piece>): Piece {
  const shape = overrides.shape ?? { kind: 'rect' as const, w: 10, d: 10 };
  return {
    id: 'unset',
    sourceId: 'src1',
    parentId: null,
    name: 'Piece',
    shape,
    xy: [0, 0],
    rotDeg: 0,
    edges: defaultEdges(shape),
    magnets: { mode: 'auto', slots: [] },
    children: [],
    ...overrides,
  };
}

function buildProject(): Project {
  const root = makePiece({ id: 'root1', parentId: null, xy: [0, 0], shape: { kind: 'rect', w: 100, d: 100 } });
  const a1 = makePiece({ id: 'a1', parentId: 'root1', xy: [10, 5], rotDeg: 90, shape: { kind: 'rect', w: 40, d: 30 } });
  const b1 = makePiece({ id: 'b1', parentId: 'a1', xy: [-3, 2], shape: { kind: 'ellipse', w: 20, d: 20 } });

  let p = newProject('Chain Test');
  p = addPiece(p, root);
  p = addPiece(p, a1);
  p = addPiece(p, b1);
  return p;
}

function fakeSourceSummary(overrides: Partial<SourceSummary> = {}): SourceSummary {
  return {
    id: 'src1',
    name: 'test.stl',
    nominal: { kind: 'rect', w: 100, d: 100 },
    measuredScale: 1,
    mode: 'twoShell',
    outline: {
      bottom: [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
      ],
      top: [
        [-45, -45],
        [45, -45],
        [45, 45],
        [-45, 45],
      ],
      plateTop: 3,
      topScale: [0.9, 0.9],
    },
    stats: {
      tris: 1000,
      bodyTris: 400,
      sculptTris: 600,
      components: 2,
      nonManifoldEdges: 0,
      boundaryEdges: 0,
      bounds: { min: [-50, -50, 0], max: [50, 50, 4] },
    },
    warnings: [],
    timings: {},
    ...overrides,
  };
}

describe('state/chain: chainFor', () => {
  it('returns [] for an unknown piece id', () => {
    const p = buildProject();
    expect(chainFor(p, 'nope')).toEqual([]);
  });

  it('returns a single-node chain for the root piece', () => {
    const p = buildProject();
    const chain = chainFor(p, 'root1');
    expect(chain.length).toBe(1);
    expect(chain[0]).toMatchObject({ id: 'root1', shape: { kind: 'rect', w: 100, d: 100 }, xy: [0, 0], rotDeg: 0, edges: p.pieces.root1.edges, role: 'base', cut: 'full' });
    expect(chain[0].plugDepth).toBe(4);
    expect(chain[0].plugClearance).toBe(0.2);
  });

  it('returns the ancestor chain root-first, ending with the piece itself', () => {
    const p = buildProject();
    const chain = chainFor(p, 'b1');
    expect(chain.map((n) => n.id)).toEqual(['root1', 'a1', 'b1']);
    expect(chain[1]).toMatchObject({
      id: 'a1',
      shape: { kind: 'rect', w: 40, d: 30 },
      xy: [10, 5],
      rotDeg: 90,
      edges: p.pieces.a1.edges,
      role: 'base',
      profile: p.pieces.a1.profile ?? p.defaultProfile,
    });
    expect(chain[2]).toMatchObject({
      id: 'b1',
      shape: { kind: 'ellipse', w: 20, d: 20 },
      xy: [-3, 2],
      rotDeg: 0,
      edges: p.pieces.b1.edges,
      role: 'base',
      profile: p.pieces.b1.profile ?? p.defaultProfile,
    });
  });
});

describe('state/chain: magnetRequestFor', () => {
  it('returns undefined when the piece has no slots', () => {
    const p = buildProject();
    expect(magnetRequestFor(p, p.pieces.root1)).toBeUndefined();
  });

  it('builds a MagnetRequest from project.magnet settings and the piece slots', () => {
    let p = buildProject();
    p = {
      ...p,
      pieces: {
        ...p.pieces,
        b1: {
          ...p.pieces.b1,
          magnets: {
            mode: 'manual',
            slots: [
              { id: 'mg1', xy: [1, 2], dia: 4 },
              { id: 'mg2', xy: [-1, -2], thick: 1.5 },
            ],
          },
        },
      },
    };
    const req = magnetRequestFor(p, p.pieces.b1);
    expect(req).toEqual({
      slots: [
        { x: 1, y: 2, dia: 4, thick: undefined },
        { x: -1, y: -2, dia: undefined, thick: 1.5 },
      ],
      sizing: { dia: p.magnet.dia, thick: p.magnet.thick, radialTol: p.magnet.radialTol, depthTol: p.magnet.depthTol, sides: p.magnet.sides },
      check: { floorMin: p.magnet.floorMin, minWall: p.magnet.minWall },
    });
  });

  it('reflects custom project magnet settings', () => {
    let p = buildProject();
    p = { ...p, magnet: { ...defaultMagnetSettings('fdm') } };
    p = {
      ...p,
      pieces: {
        ...p.pieces,
        root1: { ...p.pieces.root1, magnets: { mode: 'auto', slots: [{ id: 'mg1', xy: [0, 0] }] } },
      },
    };
    const req = magnetRequestFor(p, p.pieces.root1);
    expect(req?.sizing).toEqual({ dia: 3, thick: 2, radialTol: 0.2, depthTol: 0.15, sides: 48 });
    expect(req?.check).toEqual({ floorMin: 0.8, minWall: 1.2 });
  });
});

describe('state/chain: sizingRequestFor', () => {
  function projectWithSizing(sizing: 'source' | 'nominal' | 'clearance', clearanceMm = 0.25): Project {
    const p = buildProject();
    return { ...p, export: { ...defaultExportSettings(), sizing, clearanceMm } };
  }

  it("'source' uses the source's measured scale", () => {
    const p = projectWithSizing('source');
    const summary = fakeSourceSummary({ measuredScale: 0.9947 });
    expect(sizingRequestFor(p, summary)).toEqual({ scale: 0.9947 });
  });

  it("'source' with no source falls back to scale 1", () => {
    const p = projectWithSizing('source');
    expect(sizingRequestFor(p, null)).toEqual({ scale: 1 });
  });

  it("'nominal' always uses scale 1, regardless of the source", () => {
    const p = projectWithSizing('nominal');
    const summary = fakeSourceSummary({ measuredScale: 0.9 });
    expect(sizingRequestFor(p, summary)).toEqual({ scale: 1 });
    expect(sizingRequestFor(p, null)).toEqual({ scale: 1 });
  });

  it("'clearance' uses scale 1 plus the configured clearance", () => {
    const p = projectWithSizing('clearance', 0.3);
    const summary = fakeSourceSummary({ measuredScale: 0.9 });
    expect(sizingRequestFor(p, summary)).toEqual({ scale: 1, clearance: 0.3 });
    expect(sizingRequestFor(p, null)).toEqual({ scale: 1, clearance: 0.3 });
  });
});

// ---------------------------------------------------------------------------
// Movement tray mode
// ---------------------------------------------------------------------------

describe('model/rules: placementError', () => {
  const onRoot = { parentIsRoot: true, parentRole: 'base' as const, siblingCount: 0 };
  const inFrame = { parentIsRoot: false, parentRole: 'frame' as const, siblingCount: 0 };

  it('movement tray mode wants a frame first, then bases inside it', () => {
    expect(placementError('tray', 'frame', onRoot)).toBeNull();
    expect(placementError('tray', 'base', inFrame)).toBeNull();
    expect(placementError('tray', 'base', onRoot)).toMatch(/place a unit frame first/i);
    expect(placementError('tray', 'tray', onRoot)).toMatch(/made for you/i);
  });

  it('leaves the other modes exactly as they were', () => {
    expect(placementError('multibase', 'frame', onRoot)).toBeNull();
    expect(placementError('multibase', 'base', inFrame)).toBeNull();
    expect(placementError('multibase', 'base', onRoot)).toMatch(/Multibase mode/);
    expect(placementError('diorama', 'base', onRoot)).toBeNull();
    expect(placementError('diorama', 'frame', onRoot)).toMatch(/Diorama mode/);
    expect(placementError('single', 'base', onRoot)).toBeNull();
    expect(placementError('single', 'base', { ...onRoot, siblingCount: 1 })).toMatch(/holds one base/);
    expect(placementError('diorama', 'base', { parentIsRoot: false, parentRole: 'base', siblingCount: 0 })).toMatch(/cannot be cut from another base/);
  });

  it('knows which modes use a frame', () => {
    expect(usesFrames('tray')).toBe(true);
    expect(usesFrames('multibase')).toBe(true);
    expect(usesFrames('diorama')).toBe(false);
    expect(usesFrames('single')).toBe(false);
  });
});

/** A scene with one frame holding two bases (plus a leftover that must be ignored) and its tray. */
function trayProject(): Project {
  const root = makePiece({ id: 'root1', parentId: null, shape: { kind: 'rect', w: 150, d: 100 } });
  const frame = makePiece({ id: 'fr1', parentId: 'root1', name: 'Regiment', xy: [10, -5], shape: { kind: 'rect', w: 125, d: 50 }, role: 'frame' });
  const b1 = makePiece({ id: 'b1', parentId: 'fr1', xy: [-50, 0], shape: { kind: 'rect', w: 25, d: 25 }, magnets: { mode: 'auto', slots: [{ id: 'm1', xy: [1, 2] }] } });
  const b2 = makePiece({ id: 'b2', parentId: 'fr1', xy: [-25, 0], shape: { kind: 'rect', w: 25, d: 25 } });
  const junk = makePiece({ id: 'lo1', parentId: 'fr1', xy: [40, 0], shape: { kind: 'rect', w: 20, d: 20 }, role: 'leftover' });
  const tray = makePiece({ id: 'tr1', parentId: 'root1', name: 'Regiment tray', xy: [10, -5], shape: { kind: 'rect', w: 131, d: 56 }, role: 'tray', trayOf: 'fr1', magnets: { mode: 'manual', slots: [] } });
  let p = newProject('Tray Test');
  p = { ...p, mode: 'tray' };
  for (const piece of [root, frame, b1, b2, junk, tray]) p = addPiece(p, piece);
  p.sources.src1 = { id: 'src1', name: 'scene.stl', fileKey: { hash: 'x', size: 1 }, nominal: { kind: 'rect', w: 150, d: 100 }, normalization: { mode: 'twoShell', plateTop: 3, topScale: [0.92, 0.92], sculptMargin: 0.1, measuredScale: 1 }, stats: { tris: 1, components: 2, nonManifoldEdges: 0, boundaryEdges: 0, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }, rootPieceId: 'root1' };
  return p;
}

describe('state/chain: trayRequestFor', () => {
  it('puts every base in the frame into the scene frame, and skips anything that is not a base', () => {
    const p = trayProject();
    const req = trayRequestFor(p, p.pieces.tr1)!;
    expect(req).toBeDefined();
    expect(req.slots.map((s) => s.xy)).toEqual([[-40, -5], [-15, -5]]);
    expect(req.slots.length).toBe(2);
    expect(req.plateHeight).toBe(3);
    expect(req.floor).toBe(1);
    expect(req.gap).toBe(0.2);
    expect(req.mixedHeights).toBe(false);
    expect(req.magnets!.at).toEqual([[-39, -3], [-15, -5]]);
    expect(req.magnets!.floorMin).toBe(p.magnet.floorMin);
  });

  it('lets a frame override the project settings, and turns the magnets off', () => {
    const p = trayProject();
    p.tray = { ...p.tray, floor: 1.5, edge: 4 };
    p.pieces.fr1.tray = { floor: 2.5, magnets: false };
    const req = trayRequestFor(p, p.pieces.tr1)!;
    expect(req.floor).toBe(2.5);
    expect(req.magnets).toBeUndefined();
    expect(traySettingsFor(p, p.pieces.fr1).edge).toBe(4);
    expect(traySettingsFor(p, undefined).floor).toBe(1.5);
  });

  it('notices bases that cannot all sit level, and is undefined for anything but a tray', () => {
    const p = trayProject();
    p.pieces.b2.profile = { kind: 'inset', inset: 0, height: 4 };
    expect(trayRequestFor(p, p.pieces.tr1)!.mixedHeights).toBe(true);
    expect(trayRequestFor(p, p.pieces.fr1)).toBeUndefined();
    expect(trayRequestFor(p, p.pieces.b1)).toBeUndefined();
  });

  it('is part of the chain, so moving one base cannot serve a stale tray from the cache', () => {
    const p = trayProject();
    const before = chainFor(p, 'tr1');
    p.pieces.b2.xy = [0, 0];
    const after = chainFor(p, 'tr1');
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
  });
});

describe('state/derive: trayPiecesFor', () => {
  it('makes one tray per frame, grown by the rim, hanging off the scene', () => {
    const p = trayProject();
    delete p.pieces.tr1;
    p.pieces.root1.children = p.pieces.root1.children.filter((c) => c !== 'tr1');
    const trays = trayPiecesFor(p, 'root1');
    expect(trays.length).toBe(1);
    const t = trays[0];
    expect(t.name).toBe('Regiment tray');
    expect(t.role).toBe('tray');
    expect(t.trayOf).toBe('fr1');
    expect(t.parentId).toBe('root1');
    expect(t.xy).toEqual([10, -5]);
    expect(t.shape).toEqual({ kind: 'rect', w: 131, d: 56 });
    expect(t.magnets).toEqual({ mode: 'manual', slots: [] });
    expect(trayShapeFor(p, p.pieces.fr1)).toEqual({ kind: 'rect', w: 131, d: 56 });
  });

  it('follows the frame when the rim changes', () => {
    const p = trayProject();
    p.pieces.fr1.tray = { edge: 5 };
    expect(trayShapeFor(p, p.pieces.fr1)).toEqual({ kind: 'rect', w: 135, d: 60 });
  });
});

describe('export list with a tray', () => {
  it('downloads the tray but not the frame, and names it after it', () => {
    const p = trayProject();
    const ids = leaves(p, 'src1').map((x) => x.id).sort();
    expect(ids).toEqual(['b1', 'b2', 'lo1', 'tr1']);
    expect(ids).not.toContain('fr1');
    const tray = p.pieces.tr1;
    const size = pieceSize(tray);
    expect(`scene_${tray.name}_${formatMm(size.w)}x${formatMm(size.d)}.stl`).toBe('scene_Regiment tray_131x56.stl');
  });
});
