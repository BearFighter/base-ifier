/**
 * STL reading (binary + ASCII), auto-detected.
 *
 * Binary layout: 80-byte header, uint32 triangle count, then per triangle
 * 50 bytes = 12 float32 (normal xyz + 3 vertex xyz) + uint16 attribute byte
 * count, all little-endian. Stored normals are ignored; the kernel always
 * recomputes face normals from vertex positions.
 */
import type { Soup } from '../types';

const HEADER_BYTES = 80;
const TRI_COUNT_BYTES = 4;
const BYTES_PER_TRI = 50; // 12 floats (48 bytes) + uint16 attribute (2 bytes)

/**
 * Heuristic binary/ASCII detection: binary STL has a fixed-size layout
 * (84 + 50*n bytes) that we can verify exactly. ASCII STL starts with the
 * literal text "solid" and does not match that size equation (in the
 * overwhelmingly common case of non-degenerate files).
 */
export function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEADER_BYTES + TRI_COUNT_BYTES) {
    // Too small to be a valid binary STL; treat as ASCII (will fail there too
    // if it's not valid ASCII either).
    return false;
  }
  const view = new DataView(buffer);
  const triCount = view.getUint32(HEADER_BYTES, true);
  const expected = HEADER_BYTES + TRI_COUNT_BYTES + BYTES_PER_TRI * triCount;
  if (expected === buffer.byteLength) {
    return true;
  }
  return false;
}

export function readStlHeader(buffer: ArrayBuffer): { header: string; triCount: number } {
  if (buffer.byteLength < HEADER_BYTES + TRI_COUNT_BYTES) {
    throw new Error('readStlHeader: buffer too small to contain a binary STL header');
  }
  const bytes = new Uint8Array(buffer, 0, HEADER_BYTES);
  let header = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    header += String.fromCharCode(c);
  }
  const view = new DataView(buffer);
  const triCount = view.getUint32(HEADER_BYTES, true);
  return { header, triCount };
}

function readBinaryStl(buffer: ArrayBuffer): Soup {
  const view = new DataView(buffer);
  const triCount = view.getUint32(HEADER_BYTES, true);
  const expected = HEADER_BYTES + TRI_COUNT_BYTES + BYTES_PER_TRI * triCount;
  if (expected !== buffer.byteLength) {
    throw new Error(
      `readStl: malformed binary STL (header declares ${triCount} triangles, ` +
        `expected byteLength ${expected}, got ${buffer.byteLength})`,
    );
  }
  const positions = new Float32Array(triCount * 9);
  let offset = HEADER_BYTES + TRI_COUNT_BYTES;
  let o = 0;
  for (let t = 0; t < triCount; t++) {
    // Skip the 12-byte stored normal; we always recompute it.
    offset += 12;
    for (let v = 0; v < 9; v++) {
      positions[o++] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2; // attribute byte count
  }
  return { positions, triCount };
}

const ASCII_VERTEX_RE = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;

function readAsciiStl(buffer: ArrayBuffer): Soup {
  const text = new TextDecoder('utf-8').decode(buffer);
  if (!/^\s*solid\b/.test(text)) {
    throw new Error('readStl: malformed STL (not a valid binary or ASCII STL file)');
  }
  const coords: number[] = [];
  ASCII_VERTEX_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASCII_VERTEX_RE.exec(text)) !== null) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    const z = Number(m[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`readStl: malformed ASCII STL vertex "${m[0]}"`);
    }
    coords.push(x, y, z);
  }
  if (coords.length === 0) {
    throw new Error('readStl: malformed ASCII STL (no vertices found)');
  }
  if (coords.length % 9 !== 0) {
    throw new Error(
      `readStl: malformed ASCII STL (vertex count ${coords.length / 3} is not a multiple of 3)`,
    );
  }
  const positions = Float32Array.from(coords);
  return { positions, triCount: positions.length / 9 };
}

export function readStl(buffer: ArrayBuffer): Soup {
  if (isBinaryStl(buffer)) {
    return readBinaryStl(buffer);
  }
  return readAsciiStl(buffer);
}
