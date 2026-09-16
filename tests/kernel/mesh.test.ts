import * as fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  boxSoup,
  cylinderSoup,
  oprLikeBody,
  syntheticTwoShellBase,
  loadOprSoup,
  oprPath,
  type OprBodyOpts,
} from '../fixtures/synthetic';
import { concatSoups, type Soup } from '@/kernel/types';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { signedVolume, surfaceArea } from '@/kernel/mesh/volume';
import { weld } from '@/kernel/mesh/weld';
import { connectedComponents, extractComponent } from '@/kernel/mesh/components';
import { manifoldReport, isWatertight } from '@/kernel/mesh/validate';
import { readStl } from '@/kernel/stl/read';

describe('bbox / volume / area', () => {
  it('box bounds, volume and area match analytic values', () => {
    const w = 10, d = 20, h = 5;
    const soup = boxSoup(w, d, h, 1, 2, 3);

    const bounds = boundsOfSoup(soup);
    expect(bounds.min).toEqual([1 - w / 2, 2 - d / 2, 3]);
    expect(bounds.max).toEqual([1 + w / 2, 2 + d / 2, 3 + h]);

    expect(signedVolume(soup)).toBeCloseTo(w * d * h, 3);
    expect(surfaceArea(soup)).toBeCloseTo(2 * (w * d + w * h + d * h), 3);
  });

  it('cylinder volume is within 1% of the analytic value at 64 segments', () => {
    const r = 5, h = 12;
    const soup = cylinderSoup(r, h, 64);
    const analytic = Math.PI * r * r * h;
    const vol = signedVolume(soup);
    expect(Math.abs(vol - analytic) / analytic).toBeLessThan(0.01);
  });

  it('returns an inverted bounds box for an empty soup', () => {
    const bounds = boundsOfSoup({ positions: new Float32Array(0), triCount: 0 });
    expect(bounds.min).toEqual([Infinity, Infinity, Infinity]);
    expect(bounds.max).toEqual([-Infinity, -Infinity, -Infinity]);
  });
});

describe('weld', () => {
  it('welds a 12-triangle box down to 8 unique vertices', () => {
    const soup = boxSoup(10, 20, 5);
    const mesh = weld(soup);
    expect(mesh.vertexCount).toBe(8);
    expect(mesh.triCount).toBe(12);
    expect(mesh.indices.length).toBe(36);
  });

  it('keeps two near-touching boxes as separate components (exact-bit weld, no tolerance)', () => {
    const a = boxSoup(10, 10, 10, 0, 0, 0);
    const b = boxSoup(10, 10, 10, 10.0001, 0, 0); // almost touching, coords don't match exactly
    const combined = concatSoups([a, b]);
    const mesh = weld(combined);
    const comps = connectedComponents(mesh);
    expect(comps.count).toBe(2);
  });
});

describe('connected components', () => {
  it('separates the body from the sculpt shells in a synthetic two-shell base', () => {
    const opts: OprBodyOpts = { shape: 'rect', w: 25, d: 25 };
    const combined = syntheticTwoShellBase(opts);
    const bodyOnly = oprLikeBody(opts);

    const mesh = weld(combined);
    const comps = connectedComponents(mesh);

    // body (1) + slab (1) + bumps (3) = 5 shells, none sharing exact vertices.
    expect(comps.count).toBe(5);

    // The body is the component containing the lowest-z vertex (z = 0);
    // every sculpt shell sits at plateTop - 1.4 or higher.
    let bodyLabel = -1;
    let minZ = Infinity;
    for (let v = 0; v < mesh.vertexCount; v++) {
      const z = mesh.vertices[v * 3 + 2];
      if (z < minZ) {
        minZ = z;
        bodyLabel = comps.vertexLabel[v];
      }
    }
    expect(bodyLabel).toBeGreaterThanOrEqual(0);
    expect(comps.triCounts[bodyLabel]).toBe(bodyOnly.triCount);

    const extracted = extractComponent(combined, comps.triLabel, bodyLabel);
    expect(extracted.triCount).toBe(bodyOnly.triCount);
    expect(extracted.positions).toEqual(bodyOnly.positions);
  });
});

describe('manifold validation', () => {
  it('a closed box is watertight', () => {
    expect(isWatertight(boxSoup(10, 10, 10))).toBe(true);
  });

  it('oprLikeBody (rect and ellipse) is watertight with positive volume', () => {
    const rect = oprLikeBody({ shape: 'rect', w: 25, d: 25 });
    expect(isWatertight(rect)).toBe(true);
    expect(signedVolume(rect)).toBeGreaterThan(0);

    const ellipse = oprLikeBody({ shape: 'ellipse', w: 32, d: 32 });
    expect(isWatertight(ellipse)).toBe(true);
    expect(signedVolume(ellipse)).toBeGreaterThan(0);
  });

  it('reports exactly 3 boundary edges when one triangle is removed from a box', () => {
    const soup = boxSoup(10, 10, 10);
    const positions = soup.positions.slice(0, (soup.triCount - 1) * 9);
    const holed: Soup = { positions, triCount: soup.triCount - 1 };

    const report = manifoldReport(weld(holed));
    expect(report.boundaryEdges).toBe(3);
    expect(report.watertight).toBe(false);
  });

  it('reports exactly 3 non-manifold edges when a triangle is duplicated on a box', () => {
    const soup = boxSoup(10, 10, 10);
    const positions = new Float32Array(soup.positions.length + 9);
    positions.set(soup.positions);
    positions.set(soup.positions.subarray(0, 9), soup.positions.length);
    const dup: Soup = { positions, triCount: soup.triCount + 1 };

    const report = manifoldReport(weld(dup));
    expect(report.nonManifoldEdges).toBe(3);
    expect(report.watertight).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real-file integration (skipped automatically when the fixture is absent)
// ---------------------------------------------------------------------------

const SQUARE_25 = 'S_Base_Square_25mm_1.stl';
const ROUND_32 = 'S_Base_Round_32mm_1.stl';
const PERF_FILE = 'S_Base_Square_100mm_50mm_1.stl';

const hasSquare25 = fs.existsSync(oprPath(SQUARE_25));
const hasRound32 = fs.existsSync(oprPath(ROUND_32));
const hasPerfFile = fs.existsSync(oprPath(PERF_FILE));

function findBodyLabel(mesh: { vertexCount: number; vertices: Float32Array }, comps: { vertexLabel: Int32Array }): number {
  let bodyLabel = -1;
  let minZ = Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const z = mesh.vertices[v * 3 + 2];
    if (z < minZ) {
      minZ = z;
      bodyLabel = comps.vertexLabel[v];
    }
  }
  return bodyLabel;
}

describe('real OPR fixture integration', () => {
  it.skipIf(!hasSquare25)('S_Base_Square_25mm_1.stl: 19734 triangles, 2 components, watertight 28-tri body', () => {
    const soup = loadOprSoup(SQUARE_25)!;
    expect(soup.triCount).toBe(19734);

    const mesh = weld(soup);
    const comps = connectedComponents(mesh);
    expect(comps.count).toBe(2);

    const bodyLabel = findBodyLabel(mesh, comps);
    expect(comps.triCounts[bodyLabel]).toBe(28);

    const body = extractComponent(soup, comps.triLabel, bodyLabel);
    expect(isWatertight(body)).toBe(true);

    const bounds = boundsOfSoup(body);
    const sizeX = bounds.max[0] - bounds.min[0];
    const sizeY = bounds.max[1] - bounds.min[1];
    const sizeZ = bounds.max[2] - bounds.min[2];
    expect(Math.abs(sizeX - 24.868)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(sizeY - 24.868)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(sizeZ - 2.984)).toBeLessThanOrEqual(0.01);
  });

  it.skipIf(!hasRound32)('S_Base_Round_32mm_1.stl: body component has 788 triangles', () => {
    const soup = loadOprSoup(ROUND_32)!;
    const mesh = weld(soup);
    const comps = connectedComponents(mesh);

    const bodyLabel = findBodyLabel(mesh, comps);
    expect(comps.triCounts[bodyLabel]).toBe(788);
  });
});

describe('performance sanity', () => {
  it.skipIf(!hasPerfFile)('readStl + weld + connectedComponents on the 100mm base finishes under 5s', () => {
    const start = performance.now();

    const buf = fs.readFileSync(oprPath(PERF_FILE));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const soup = readStl(arrayBuffer);
    const mesh = weld(soup);
    const comps = connectedComponents(mesh);

    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      `perf: ${soup.triCount} tris, ${mesh.vertexCount} verts, ${comps.count} components in ${elapsed.toFixed(0)}ms`,
    );
    expect(elapsed).toBeLessThan(5000);
  });
});
