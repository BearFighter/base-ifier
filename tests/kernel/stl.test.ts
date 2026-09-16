import { describe, it, expect } from 'vitest';
import { boxSoup } from '../fixtures/synthetic';
import { writeBinaryStl } from '@/kernel/stl/write';
import { readStl, readStlHeader, isBinaryStl } from '@/kernel/stl/read';

describe('stl write/read round-trip', () => {
  it('writes and reads back a box with byte-identical positions', () => {
    const soup = boxSoup(10, 20, 5);
    const buf = writeBinaryStl([soup], 'test header');
    expect(isBinaryStl(buf)).toBe(true);

    const read = readStl(buf);
    expect(read.triCount).toBe(soup.triCount);
    expect(read.positions).toEqual(soup.positions);
  });

  it('round-trips multiple soups concatenated into one file', () => {
    const a = boxSoup(10, 10, 10, 0, 0, 0);
    const b = boxSoup(5, 5, 5, 20, 0, 0);
    const buf = writeBinaryStl([a, b]);
    const read = readStl(buf);
    expect(read.triCount).toBe(a.triCount + b.triCount);
  });

  it('readStlHeader returns the header text and triangle count', () => {
    const soup = boxSoup(10, 20, 5);
    const buf = writeBinaryStl([soup], 'My Header');
    const { header, triCount } = readStlHeader(buf);
    expect(header).toBe('My Header');
    expect(triCount).toBe(soup.triCount);
  });

  it('throws a clear error for a malformed binary buffer', () => {
    const bad = new ArrayBuffer(84 + 50 * 3 - 1); // one byte short of a 3-triangle file
    new DataView(bad).setUint32(80, 3, true);
    expect(() => readStl(bad)).toThrowError();
  });

  it('throws a clear error for a too-small buffer', () => {
    const bad = new ArrayBuffer(10);
    expect(() => readStl(bad)).toThrowError();
  });

  it('parses a small ASCII STL sample', () => {
    const ascii = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid test
`;
    const buf = (new TextEncoder().encode(ascii).buffer) as ArrayBuffer;
    expect(isBinaryStl(buf)).toBe(false);

    const soup = readStl(buf);
    expect(soup.triCount).toBe(1);
    expect(Array.from(soup.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('throws for malformed ASCII input', () => {
    const buf = (new TextEncoder().encode('not an stl file at all').buffer) as ArrayBuffer;
    expect(() => readStl(buf)).toThrowError();
  });
});
