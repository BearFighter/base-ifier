import { describe, expect, it } from 'vitest';
import { chainFor, magnetRequestFor, sizingRequestFor } from '@/state/chain';
import { addPiece } from '@/model/tree';
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
