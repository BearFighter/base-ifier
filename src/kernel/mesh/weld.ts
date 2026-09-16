import type { IndexedMesh, Soup } from '../types';

/**
 * FNV-1a mix of three uint32 values followed by a murmur-style finalizer,
 * all via Math.imul (32-bit integer multiply, no float rounding).
 */
function hash32(a: number, b: number, c: number): number {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ a, 16777619) >>> 0;
  h = Math.imul(h ^ b, 16777619) >>> 0;
  h = Math.imul(h ^ c, 16777619) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Welds a triangle soup into an indexed mesh. Two vertices are considered
 * identical iff their x/y/z float32 bit patterns are exactly equal (no
 * epsilon tolerance). Preserves triangle order: soup triangle `t` becomes
 * indexed triangle `t` (so an external triLabel array indexes both the same
 * way).
 *
 * Implemented with an open-addressing hash table over raw uint32 bit
 * patterns (no per-vertex objects, no string keys) so it scales to millions
 * of triangles.
 */
export function weld(soup: Soup): IndexedMesh {
  const { positions, triCount } = soup;
  const numInputVerts = triCount * 3;

  const indices = new Uint32Array(numInputVerts);

  if (numInputVerts === 0) {
    return { vertices: new Float32Array(0), vertexCount: 0, indices, triCount: 0 };
  }

  // Bit-level view of the source floats. Safe: a Float32Array's byteOffset
  // is always a multiple of 4 (its element size), so it is valid to build a
  // Uint32Array view at the same offset.
  const srcBits = new Uint32Array(positions.buffer, positions.byteOffset, numInputVerts * 3);

  // Worst case every input vertex is unique; allocate for that and trim at
  // the end.
  const outPositions = new Float32Array(numInputVerts * 3);
  const outBits = new Uint32Array(outPositions.buffer, outPositions.byteOffset, outPositions.length);

  // Open-addressing hash table (linear probing), sized for load factor <= 0.5.
  let tableSize = 16;
  while (tableSize < numInputVerts * 2) tableSize *= 2;
  const mask = tableSize - 1;
  const slotVertex = new Int32Array(tableSize).fill(-1);

  let vertexCount = 0;

  for (let i = 0; i < numInputVerts; i++) {
    const base = i * 3;
    const a = srcBits[base];
    const b = srcBits[base + 1];
    const c = srcBits[base + 2];

    let slot = hash32(a, b, c) & mask;
    let vid: number;
    for (;;) {
      const existing = slotVertex[slot];
      if (existing === -1) {
        vid = vertexCount++;
        const ob = vid * 3;
        outBits[ob] = a;
        outBits[ob + 1] = b;
        outBits[ob + 2] = c;
        slotVertex[slot] = vid;
        break;
      }
      const eb = existing * 3;
      if (outBits[eb] === a && outBits[eb + 1] === b && outBits[eb + 2] === c) {
        vid = existing;
        break;
      }
      slot = (slot + 1) & mask;
    }
    indices[i] = vid;
  }

  const vertices = outPositions.slice(0, vertexCount * 3);
  return { vertices, vertexCount, indices, triCount };
}
