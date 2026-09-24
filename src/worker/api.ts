/**
 * Contract between the UI (main thread) and the geometry worker.
 * Everything crossing the boundary is plain data; Float32Arrays are transferred.
 */
import type { Bounds3, EdgeProfile, EdgeTreatment, Shape, Vec2 } from '@/kernel/types';
import type { StudioDocument, StudioProp } from '@/kernel/studio/document';

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
/** A plug base whose socket this piece must keep: its footprint in the shared parent frame. */
export interface SocketRequest {
  shape: Shape;
  xy: Vec2;
  rotDeg: number;
  plugDepth: number;
  clearance: number;
  /** the base is a plug (pocket); otherwise it took the whole column (hole through) */
  plug: boolean;
}

/**
 * A movement tray: the slots its frame's bases leave in it, and how thick and
 * roomy they are. Positions are in the frame shared by the tray and the bases
 * (the scene), so the worker only has to add the scene origin.
 */
export interface TrayRequest {
  /** the tray is the whole scene (no frame was placed): it has no rim beyond the scene */
  wholeScene?: boolean;
  /** thickness of the flat sheet under the whole tray, mm */
  floor: number;
  /** extra room per side in each slot, mm */
  gap: number;
  /** how far the surround stands above the floor: the plate height of the bases, mm */
  plateHeight: number;
  /** one per base in the frame, positioned in the scene's frame */
  slots: { shape: Shape; xy: Vec2; rotDeg: number }[];
  /** magnet holes in the floor, in the scene's frame; omitted = none */
  magnets?: { at: Vec2[]; sizing: MagnetRequest['sizing']; floorMin: number };
  /** the bases in the frame do not all have the same plate height, so they cannot all sit level */
  mixedHeights?: boolean;
  /** the bases' hollow underside */
  underside?: { depth: number; rim: number; ringWidth: number };
}

export interface PieceChainNode {
  id: string;
  shape: Shape;
  xy: Vec2;
  rotDeg: number;
  edges: EdgeTreatment[];
  /** edge profile; omitted = the file's original slope */
  profile?: EdgeProfile;
  role?: 'base' | 'frame' | 'leftover' | 'tray';
  /** 'full' (default) takes the whole column; 'plug' takes the top `plugDepth` and the terrain keeps a socket */
  cut?: 'full' | 'plug';
  plugDepth?: number;
  plugClearance?: number;
  /** plug bases inside this piece's footprint whose sockets it keeps */
  sockets?: SocketRequest[];
  /** set on a movement tray (role 'tray') */
  tray?: TrayRequest;
}

/** What is under a base footprint: material thickness from the object's bottom, and terrain heights. */
export interface ColumnInfo {
  minTop: number;
  maxTop: number;
  maxBottom: number;
  /** material from the bottom to the lowest terrain point over the footprint, mm */
  thickness: number;
  /** grid points over the footprint that hit nothing (holes) */
  misses: number;
  /** whether a full cut would be carved out of the object (no plate under it) */
  carved: boolean;
  /** the whole footprint sits on solid material (a plug needs this) */
  covered: boolean;
  /** the material under the footprint stops above the bottom somewhere (a shell): backing is added */
  hollow: boolean;
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

/** Hollow underside: brim, void, magnet cups. Omitted = solid plate. The maker mark is added by the worker, never requested. */
export interface UndersideRequest {
  depth: number;
  rim: number;
  ringHeight: number;
  ringWidth: number;
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

/** What a finished movement tray turned out like: what the Bases tab and the Export tab report. */
export interface TrayInfo {
  /** the floor as built: deepened for the magnets when the setting was thinner than they are, mm */
  floor: number;
  /** the floor the settings asked for, mm */
  floorAsked: number;
  plateHeight: number;
  /** 'recess' = magnet pockets in the top face; 'through' = holes right through the floor */
  magnetMode: 'none' | 'recess' | 'through';
  /** the floor thickness that would take the magnets fully, mm */
  magnetFloorWanted: number;
  /** the biggest rectangle of floor with no surround across it: what makes a thin tray curl, mm */
  thinSpan: { w: number; d: number };
  /** how many convex shapes the surround was built from */
  cells: number;
  watermark: boolean;
}

export interface PieceGeometryTransfer {
  /** set when the base was carved out of the object (no plate): floor height in the source and thinnest material */
  carved?: { floorZ: number; thickness: number; plug: boolean };
  /** set on a movement tray */
  tray?: TrayInfo;
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

/**
 * One of the user's prop STLs handed to the worker. Base Studio scatters nothing
 * else: the worker keeps the geometry, the document keeps the metadata (family,
 * licence, pick weight) in `StudioDocument.library`.
 */
export interface StudioAssetTransfer {
  /** the library item's id */
  id: string;
  /** for warnings only */
  name: string;
  family: string;
  /** the STL file's bytes (binary or ASCII) */
  stl: ArrayBuffer;
}

export interface StudioAssetInfo {
  id: string;
  name: string;
  footprintRadius: number;
  height: number;
  tris: number;
  /** a closed surface (no open edges); open meshes are reported but never scattered or placed */
  closed: boolean;
  /** over ~150k triangles: previewed simplified, exported in full */
  heavy: boolean;
  /** set when the file could not be read */
  error?: string;
}

/**
 * Which triangles of the merged props mesh belong to which placed prop, in
 * document order. Lets the viewport turn a clicked triangle into a prop id and
 * lift one prop out of the merged mesh without a mesh per prop.
 */
export interface StudioPropRange {
  /** `StudioProp.id` */
  id: string;
  /** first triangle of this prop in the merged props mesh */
  start: number;
  /** how many triangles it has */
  count: number;
}

/**
 * Where a placed prop actually ended up: x and y are the document's, z is the
 * height the drop-to-ground worked out, and rotDeg/scale are the document's.
 * The viewport hangs its drag handle on exactly this spot.
 */
export interface StudioPlacement {
  id: string;
  x: number;
  y: number;
  z: number;
  rotDeg: number;
  scale: number;
}

/** What the studio viewport draws: the ground and all props as flat triangle soups (positions only). */
export interface StudioPreviewTransfer {
  ground: MeshTransfer;
  props: MeshTransfer;
  /** triangle ranges into `props`, one per placed prop, in document order */
  propRanges: StudioPropRange[];
  /** where each placed prop ended up, same order as `propRanges` */
  placements: StudioPlacement[];
  bounds: Bounds3;
  propCount: number;
  warnings: string[];
  timings: Record<string, number>;
}

export interface KernelApi {
  /** `onProgress` must be a separate argument (Comlink proxies only top-level function arguments). */
  loadSource(id: string, name: string, buffer: ArrayBuffer, opts?: { nominal?: Shape }, onProgress?: ProgressCallback): Promise<SourceSummary>;
  unloadSource(id: string): Promise<void>;
  computePiece(req: ComputeRequest): Promise<PieceGeometryTransfer>;
  /** terrain under a base: thickness and heights over its footprint (cheap; used before Base-ify to offer plug cuts) */
  columnInfo(req: { sourceId: string; chain: PieceChainNode[] }): Promise<ColumnInfo | null>;
  /** suggested magnet positions (piece-local) for the piece described by the chain */
  autoMagnets(req: { sourceId: string; chain: PieceChainNode[]; radius: number; minWall: number }): Promise<Vec2[]>;
  exportPiece(item: ExportItem): Promise<ArrayBuffer>;
  /** Base Studio: parse and cache the user's prop STLs (the only props the studio has) */
  registerStudioAssets(assets: StudioAssetTransfer[]): Promise<StudioAssetInfo[]>;
  /** Base Studio: forget prop geometry for these library item ids */
  unregisterStudioAssets(ids: string[]): Promise<void>;
  /** Base Studio: re-roll the scattered props of a document */
  scatterStudio(doc: StudioDocument): Promise<StudioProp[]>;
  /** Base Studio: ground + props meshes for the studio viewport (no weld/bins) */
  previewStudio(doc: StudioDocument): Promise<StudioPreviewTransfer>;
  /** Base Studio: bake the document into a source the cutter can use, registered under `id` */
  bakeStudio(id: string, doc: StudioDocument): Promise<SourceSummary>;
  exportPlate(items: ExportItem[], gap: number): Promise<ArrayBuffer>;
  /** zip of one STL per item, file names "<name>.stl" */
  exportZip(items: ExportItem[]): Promise<ArrayBuffer>;
}
