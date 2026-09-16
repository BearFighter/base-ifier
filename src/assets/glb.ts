/**
 * Minimal glTF binary (.glb) reader for geometry only. Enough for the bundled
 * CC0 prop packs (built slim by scripts/build-assets.mjs: one or more meshes,
 * float positions, uint16/uint32 indices, no textures) and for user imports
 * of plain glb files. Runs in the worker: no DOM, no three.js.
 */
import type { Soup } from '@/kernel/types';
import { SoupBuilder } from '@/kernel/types';

interface GltfJson {
  asset?: { version?: string };
  scenes?: { nodes?: number[] }[];
  scene?: number;
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { byteLength: number; uri?: string }[];
}

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json: GltfJson, bin: DataView, binOffset: number, index: number): Float64Array {
  const acc = json.accessors![index];
  const view = json.bufferViews![acc.bufferView!];
  const comps = TYPE_SIZE[acc.type];
  const cb = COMPONENT_BYTES[acc.componentType];
  const stride = view.byteStride ?? comps * cb;
  const start = binOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float64Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      const o = start + i * stride + c * cb;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = bin.getFloat32(o, true); break;
        case 5125: v = bin.getUint32(o, true); break;
        case 5123: v = bin.getUint16(o, true); break;
        case 5121: v = bin.getUint8(o); break;
        case 5122: v = bin.getInt16(o, true); break;
        default: v = bin.getInt8(o);
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

type Mat4 = number[];
const IDENT: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function nodeMatrix(n: NonNullable<GltfJson['nodes']>[number]): Mat4 {
  if (n.matrix && n.matrix.length === 16) return n.matrix.slice();
  const t = n.translation ?? [0, 0, 0], q = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

export interface GlbOptions {
  /** glTF is Y-up; bases are Z-up. true (default) maps (x, y, z) -> (x, -z, y) */
  yUpToZUp?: boolean;
  /** uniform scale applied after axis conversion (glTF units are metres; pass 1000 for mm) */
  scale?: number;
}

/** All triangle geometry of a glb as one soup in the file's root frame. */
export function glbToSoup(buffer: ArrayBuffer, opts: GlbOptions = {}): Soup {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb file');
  const total = dv.getUint32(8, true);
  let off = 12;
  let json: GltfJson | null = null;
  let binOffset = -1;
  while (off < total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, off + 8, len))) as GltfJson;
    else if (type === 0x004e4942) binOffset = off + 8;
    off += 8 + len;
  }
  if (!json || binOffset < 0) throw new Error('glb without JSON or BIN chunk');
  const zUp = opts.yUpToZUp ?? true;
  const scale = opts.scale ?? 1;
  const out = new SoupBuilder(4096);
  const emit = (m: Mat4, meshIndex: number) => {
    const mesh = json!.meshes![meshIndex];
    for (const prim of mesh.primitives) {
      if ((prim.mode ?? 4) !== 4) continue;
      const pos = readAccessor(json!, dv, binOffset, prim.attributes.POSITION);
      const idx = prim.indices !== undefined ? readAccessor(json!, dv, binOffset, prim.indices) : null;
      const count = idx ? idx.length : pos.length / 3;
      const p = (k: number): [number, number, number] => {
        const i = idx ? idx[k] : k;
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        return zUp ? [wx * scale, -wz * scale, wy * scale] : [wx * scale, wy * scale, wz * scale];
      };
      for (let k = 0; k + 2 < count; k += 3) {
        const a = p(k), b = p(k + 1), c = p(k + 2);
        out.triV(a, b, c);
      }
    }
  };
  const visit = (ni: number, parent: Mat4) => {
    const n = json!.nodes![ni];
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) emit(m, n.mesh);
    for (const c of n.children ?? []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene?.nodes) for (const ni of scene.nodes) visit(ni, IDENT);
  else if (json.meshes) json.meshes.forEach((_m, i) => emit(IDENT, i));
  return out.buildCopy();
}

/** Centre a soup on the origin in XY and drop its lowest point to z = 0 (in place). */
export function groundSoup(soup: Soup): { footprintRadius: number; height: number } {
  const P = soup.positions;
  const n = soup.triCount * 9;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 3) {
    minX = Math.min(minX, P[i]); maxX = Math.max(maxX, P[i]);
    minY = Math.min(minY, P[i + 1]); maxY = Math.max(maxY, P[i + 1]);
    minZ = Math.min(minZ, P[i + 2]); maxZ = Math.max(maxZ, P[i + 2]);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let r2 = 0;
  for (let i = 0; i < n; i += 3) {
    P[i] -= cx; P[i + 1] -= cy; P[i + 2] -= minZ;
    r2 = Math.max(r2, P[i] * P[i] + P[i + 1] * P[i + 1]);
  }
  return { footprintRadius: Math.sqrt(r2), height: maxZ - minZ };
}
