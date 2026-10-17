/**
 * Which way is up: a scene saved on its side (or upside down) is stood on its
 * biggest flat face on import, a correctly saved one is never touched, and a
 * tall prop is left standing.
 */
import { describe, expect, it } from 'vitest';
import { detectUpAxis, orientSoup, rotateSoupUp, UP_AXES, type UpAxis } from '@/kernel/source/orient';
import { axisPermutationDet, permuteSoupAxes } from '@/kernel/mesh/transform';
import { prepareSource } from '@/kernel/source/prepareSource';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { signedVolume } from '@/kernel/mesh/volume';
import { isWatertight } from '@/kernel/mesh/validate';
import { concatSoups, type Soup } from '@/kernel/types';
import { boxSoup, loadOprSoup, oprLikeBody, syntheticTwoShellBase } from '../fixtures/synthetic';

/** +90° about X, written out by hand so the test does not lean on the code it checks: (x, y, z) -> (x, -z, y). */
function rotX90(s: Soup): Soup {
  const P = s.positions, out = new Float32Array(s.triCount * 9);
  for (let i = 0; i < s.triCount * 9; i += 3) { out[i] = P[i]; out[i + 1] = -P[i + 2]; out[i + 2] = P[i + 1]; }
  return { positions: out, triCount: s.triCount };
}

/** +90° about Y: (x, y, z) -> (z, y, -x). */
function rotY90(s: Soup): Soup {
  const P = s.positions, out = new Float32Array(s.triCount * 9);
  for (let i = 0; i < s.triCount * 9; i += 3) { out[i] = P[i + 2]; out[i + 1] = P[i + 1]; out[i + 2] = -P[i]; }
  return { positions: out, triCount: s.triCount };
}

const extent = (s: Soup) => { const b = boundsOfSoup(s); return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]; };

describe('orientation: the rotations', () => {
  it('are all proper rotations that keep a closed box closed and outward', () => {
    const box = boxSoup(40, 30, 3);
    const v0 = signedVolume(box);
    for (const up of UP_AXES) {
      const r = rotateSoupUp(box, up);
      expect(isWatertight(r)).toBe(true);
      expect(signedVolume(r)).toBeCloseTo(v0, 3);
      expect(boundsOfSoup(r).min[2]).toBe(0);
    }
  });

  it('refuses a mirror', () => {
    expect(axisPermutationDet({ src: [1, 0, 2], sign: [1, 1, 1] })).toBe(-1);
    expect(() => permuteSoupAxes(boxSoup(1, 1, 1), { src: [1, 0, 2], sign: [1, 1, 1] })).toThrow();
  });

  it('turn the named axis of the file to point up', () => {
    // a 10 x 20 x 30 box: whichever axis is turned up, its old extent becomes the height
    const box = boxSoup(10, 20, 30);
    const want: Record<UpAxis, number> = { 'z+': 30, 'z-': 30, 'y+': 20, 'y-': 20, 'x+': 10, 'x-': 10 };
    for (const up of UP_AXES) expect(extent(rotateSoupUp(box, up))[2]).toBeCloseTo(want[up], 5);
  });
});

describe('orientation: detecting which way is up', () => {
  it('(a) a flat 40 x 40 x 3 slab is Z up and is not touched', () => {
    const box = boxSoup(40, 40, 3);
    const d = detectUpAxis(box);
    expect(d.best).toBe('z+');
    expect(d.detected).toBe('z+');
    expect(d.confident).toBe(false);
    const same = rotateSoupUp(box, 'z+');
    expect(same).toBe(box);
    const o = orientSoup(box, 'auto');
    expect(Array.from(o.soup.positions)).toEqual(Array.from(box.positions));
    expect(o.orientation).toEqual({ applied: 'z+', detected: 'z+', auto: true, confident: false });
    expect(o.warnings).toEqual([]);
  });

  it('(b) the same slab standing on its edge (height along Y) is stood up', () => {
    const edge = rotX90(boxSoup(40, 40, 3));
    expect(extent(edge)[1]).toBeCloseTo(3, 5);
    const d = detectUpAxis(edge);
    expect(['y+', 'y-']).toContain(d.best);
    expect(d.confident).toBe(true);
    const up = rotateSoupUp(edge, d.best);
    const b = boundsOfSoup(up);
    expect(b.min[2]).toBe(0);
    expect(b.max[2]).toBeCloseTo(3, 5);
    expect(b.max[0] - b.min[0]).toBeCloseTo(40, 5);
    expect(b.max[1] - b.min[1]).toBeCloseTo(40, 5);
    expect(signedVolume(up)).toBeGreaterThan(0);
    expect(isWatertight(up)).toBe(true);
    const o = orientSoup(edge, 'auto');
    expect(o.orientation.applied).toBe(d.best);
    expect(o.warnings.join(' ')).toMatch(/lying on its side.*stood up/);
  });

  it('(c) a tall 10 x 10 x 40 prop is left standing, with only a warning', () => {
    const prop = boxSoup(10, 10, 40);
    const d = detectUpAxis(prop);
    expect(d.confident).toBe(false);
    expect(d.best).toBe('z+');
    const o = orientSoup(prop, 'auto');
    expect(o.orientation.applied).toBe('z+');
    expect(o.soup).toBe(prop);
  });

  it('a plain slab saved upside down stays as it is (its top is as flat as its bottom)', () => {
    expect(detectUpAxis(rotX90(rotX90(boxSoup(40, 40, 3)))).best).toBe('z+');
  });

  it('an explicit choice wins over the detection', () => {
    const box = boxSoup(40, 40, 3);
    const o = orientSoup(box, 'y+');
    expect(o.orientation).toMatchObject({ applied: 'y+', detected: 'z+', auto: false });
    expect(extent(o.soup)[2]).toBeCloseTo(40, 5);
    expect(o.warnings).toEqual([]);
  });
});

describe('orientation: a two-shell OPR-like base saved on its side', () => {
  const name = 'S_Base_Square_100mm_50mm_1.stl';
  const flat = syntheticTwoShellBase({ shape: 'rect', w: 100, d: 50 });

  it('(d) is found, stood up and prepared exactly like the base saved Z up', () => {
    expect(detectUpAxis(flat).best).toBe('z+');
    const ref = prepareSource(flat, name);
    expect(ref.mode).toBe('twoShell');

    const side = rotX90(flat);
    const d = detectUpAxis(side);
    expect(d.best).toBe('y-');
    expect(d.confident).toBe(true);
    const prepared = prepareSource(rotateSoupUp(side, d.best), name);
    expect(prepared.mode).toBe('twoShell');
    expect(prepared.nominal).toEqual(ref.nominal);
    expect(prepared.outline.plateTop).toBeCloseTo(ref.outline.plateTop, 5);
    expect(prepared.measuredScale).toBeCloseTo(ref.measuredScale, 6);
    expect(prepared.stats.bounds.max[2]).toBeCloseTo(ref.stats.bounds.max[2], 4);
  });

  it('stands on its brim even when its sculpt has a much bigger flat top (several real OPR files do)', () => {
    // brim ring 25² - 21² = 184 mm² underneath, a flat top of ~520 mm²: the outline, not the area, tells them apart
    const flatTop = concatSoups([oprLikeBody({ shape: 'rect', w: 25, d: 25 }), boxSoup(25 * 0.9237 - 0.2, 25 * 0.9237 - 0.2, 1, 0, 0, 2.884)]);
    const saved = detectUpAxis(flatTop);
    expect(saved.flat['z-']).toBeGreaterThan(2 * saved.flat['z+']);
    expect(saved.best).toBe('z+');
    expect(saved.detected).toBe('z+');
    const side = detectUpAxis(rotX90(flatTop));
    expect(side.best).toBe('y-');
    expect(side.confident).toBe(true);
  });

  it('is also found when it was saved standing on its end (X up)', () => {
    const end = rotY90(flat);
    const d = detectUpAxis(end);
    expect(d.best[0]).toBe('x');
    expect(d.confident).toBe(true);
    const prepared = prepareSource(rotateSoupUp(end, d.best), name);
    expect(prepared.mode).toBe('twoShell');
    expect(prepared.outline.plateTop).toBeCloseTo(prepareSource(flat, name).outline.plateTop, 5);
  });
});

describe('orientation: a real OPR file saved on its side', () => {
  const name = 'S_Base_Square_100mm_50mm_1.stl';
  const real = loadOprSoup(name);

  it.skipIf(!real)('(e) is detected and restored', () => {
    const raw = real!;
    expect(detectUpAxis(raw).best).toBe('z+');
    const ref = prepareSource(raw, name);
    const side = rotX90(raw);
    const d = detectUpAxis(side);
    expect(d.best).toBe('y-');
    expect(d.confident).toBe(true);
    const prepared = prepareSource(rotateSoupUp(side, d.best), name);
    expect(prepared.mode).toBe(ref.mode);
    expect(prepared.nominal).toEqual(ref.nominal);
    expect(prepared.outline.plateTop).toBeCloseTo(ref.outline.plateTop, 4);
    expect(prepared.stats.bodyTris).toBe(ref.stats.bodyTris);
  });
});
