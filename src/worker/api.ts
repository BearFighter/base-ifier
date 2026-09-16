/**
 * Contract between the UI (main thread) and the geometry worker.
 * Everything crossing the boundary is plain data; Float32Arrays are transferred.
 */
import type { Bounds3, EdgeProfile, EdgeTreatment, Shape, Vec2 } from '@/kernel/types';

export interface OutlineTransfer {
  bottom: Vec2[];
  top: Vec2[];
  plateTop: number;
}

export interface SourceSummary {
  id: string;
  name: string;
  nominal: Shape;
  measuredScale: number;
  mode: 'twoShell' | 'generic';
  outline: OutlineTransfer & { topScale: [number, number] };
  stats: {
    tris: number;
    bodyTris: number;
    sculptTris: number;
    components: number;
    nonManifoldEdges: number;
    boundaryEdges: number;
    bounds: Bounds3;
  };
  warnings: string[];
  timings: Record<string, number>;
}

/** One node of the ancestor chain, root first. The root node has xy [0,0] and the source's nominal shape. */
export interface PieceChainNode {
  id: string;
  shape: Shape;
  xy: Vec2;
  rotDeg: number;
  edges: EdgeTreatment[];
  /** edge profile; omitted = the file's original slope */
  profile?: EdgeProfile;
  role?: 'base' | 'frame' | 'leftover';
}

export interface MagnetRequest {
  /** piece-local underside coordinates */
  slots: { x: number; y: number; dia?: number; thick?: number }[];
  sizing: { dia: number; thick: number; radialTol: number; depthTol: number; sides: number };
  check: { floorMin: number; minWall: number };
}

export interface SizingRequest {
  /** uniform output scale, default 1 */
  scale?: number;
  /** per-side clearance, mm, default 0 */
  clearance?: number;
}

/** Hollow underside: brim, void, magnet locating rings, watermark. Omitted = solid plate. */
export interface UndersideRequest {
  depth: number;
  rim: number;
  ringHeight: number;
  ringWidth: number;
  watermark: string;
  watermarkHeight: number;
}

export interface ComputeRequest {
  sourceId: string;
  chain: PieceChainNode[];
  magnets?: MagnetRequest;
  sizing?: SizingRequest;
  underside?: UndersideRequest;
  /** outline-only (no sculpt geometry) */
  skipSculpt?: boolean;
  /** simplify sculpt meshes above this many triangles for display (default 600k; 0 = never) */
  previewLimit?: number;
}

/**
 * Mesh for display. Non-indexed: `positions` has 9 floats per triangle.
 * Indexed (root pieces): `positions` is a vertex array and `indices` has 3 per triangle.
 * No normals are sent; render with flat shading (derivative normals).
 */
export interface MeshTransfer {
  positions: Float32Array;
  indices?: Uint32Array;
  triCount: number;
  /** true when this is a simplified preview of a much larger mesh (display only) */
  simplified?: boolean;
  /** triangle count of the full mesh when simplified */
  fullTriCount?: number;
}

export interface PieceGeometryTransfer {
  pieceId: string;
  /** piece origin in the source frame */
  origin: Vec2;
  /** footprint size, nominal mm */
  size: { w: number; d: number };
  /** piece-local outline after sizing */
  outline: OutlineTransfer;
  /** parent-frame outline for children: the piece's own outline in the SOURCE frame */
  frameOutline: OutlineTransfer;
  body: MeshTransfer;
  sculpt: MeshTransfer;
  /** false when the request skipped the sculpt (outline/body only) */
  hasSculpt: boolean;
  warnings: string[];
  bodyVolume: number;
  bounds: Bounds3;
  timings: Record<string, number>;
}

/** Print-ready export: tilt, lift and support the piece (see kernel/pipeline/presupport.ts). */
export interface PresupportRequest {
  /** degrees; null = pick by shape (35 rounds, 45 rects, 55 large rects) */
  tiltDeg: number | null;
  standoff: number;
  tipDiameter: number;
  /** contact spacing preset; the spacing itself also depends on the base size */
  density: 'light' | 'medium' | 'heavy';
  /** off / light (edge rail + one ring of bars) / full (lattice) */
  bracing: 'off' | 'light' | 'full';
}

export interface ExportItem extends ComputeRequest {
  name: string;
  /** when set, the export is tilted and supported */
  presupport?: PresupportRequest;
}

export type ProgressCallback = (stage: string, fraction: number) => void;

export interface KernelApi {
  /** `onProgress` must be a separate argument (Comlink proxies only top-level function arguments). */
  loadSource(id: string, name: string, buffer: ArrayBuffer, opts?: { nominal?: Shape }, onProgress?: ProgressCallback): Promise<SourceSummary>;
  unloadSource(id: string): Promise<void>;
  computePiece(req: ComputeRequest): Promise<PieceGeometryTransfer>;
  /** suggested magnet positions (piece-local) for the piece described by the chain */
  autoMagnets(req: { sourceId: string; chain: PieceChainNode[]; radius: number; minWall: number }): Promise<Vec2[]>;
  exportPiece(item: ExportItem): Promise<ArrayBuffer>;
  exportPlate(items: ExportItem[], gap: number): Promise<ArrayBuffer>;
  /** zip of one STL per item, file names "<name>.stl" */
  exportZip(items: ExportItem[]): Promise<ArrayBuffer>;
}
