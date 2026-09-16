/** Binary STL writing. */
import type { Soup } from '../types';

const HEADER_BYTES = 80;
const TRI_COUNT_BYTES = 4;
const BYTES_PER_TRI = 50;

function writeHeader(view: DataView, header: string): void {
  // Pad/truncate to exactly 80 bytes.
  for (let i = 0; i < HEADER_BYTES; i++) {
    const code = i < header.length ? header.charCodeAt(i) & 0xff : 0;
    view.setUint8(i, code);
  }
}

/** Concatenates one or more soups into a single binary STL file. */
export function writeBinaryStl(soups: Soup[], header = 'Base-ifier'): ArrayBuffer {
  let triCount = 0;
  for (const s of soups) triCount += s.triCount;

  const byteLength = HEADER_BYTES + TRI_COUNT_BYTES + BYTES_PER_TRI * triCount;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);

  writeHeader(view, header);
  view.setUint32(HEADER_BYTES, triCount, true);

  let offset = HEADER_BYTES + TRI_COUNT_BYTES;

  for (const soup of soups) {
    const p = soup.positions;
    for (let t = 0; t < soup.triCount; t++) {
      const i = t * 9;
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];

      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        nx /= len; ny /= len; nz /= len;
      } else {
        nx = 0; ny = 0; nz = 0;
      }

      view.setFloat32(offset, nx, true); offset += 4;
      view.setFloat32(offset, ny, true); offset += 4;
      view.setFloat32(offset, nz, true); offset += 4;

      view.setFloat32(offset, ax, true); offset += 4;
      view.setFloat32(offset, ay, true); offset += 4;
      view.setFloat32(offset, az, true); offset += 4;

      view.setFloat32(offset, bx, true); offset += 4;
      view.setFloat32(offset, by, true); offset += 4;
      view.setFloat32(offset, bz, true); offset += 4;

      view.setFloat32(offset, cx, true); offset += 4;
      view.setFloat32(offset, cy, true); offset += 4;
      view.setFloat32(offset, cz, true); offset += 4;

      view.setUint16(offset, 0, true); offset += 2;
    }
  }

  return buffer;
}
