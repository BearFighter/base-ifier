import type { StudioDocument } from '@/kernel/studio/document';
/**
 * Project data model for Base-ifier: sources, the piece tree, and per-project
 * settings. Builds only on kernel geometry types — must not import from
 * ui/state/worker.
 */

import type { Shape, EdgeTreatment, EdgeProfile, Vec2 } from '@/kernel/types';

export type PrinterProfile = 'resin' | 'fdm' | 'custom';

/** Magnet slot generation settings, shared across the whole project. */
export interface MagnetSettings {
  /** Magnet diameter, mm */
  dia: number;
  /** Magnet thickness (slot depth before tolerance), mm */
  thick: number;
  /** Radial (diameter) tolerance added to the slot, mm */
  radialTol: number;
  /** Depth tolerance added to the slot, mm */
  depthTol: number;
  /** Minimum floor thickness left under a slot, mm */
  floorMin: number;
  /** Minimum wall thickness around a slot, mm */
  minWall: number;
  /** Polygon segment count used to approximate the slot cylinder */
  sides: number;
  printer: PrinterProfile;
}

export type SizingPolicy = 'source' | 'nominal' | 'clearance';

/** Export-time sizing/layout settings, shared across the whole project. */
export interface ExportSettings {
  sizing: SizingPolicy;
  /** Extra clearance applied when sizing === 'clearance', mm */
  clearanceMm: number;
  /** Gap left between plated pieces, mm */
  plateGap: number;
  /** Print-ready exports: tilted, lifted and supported (see docs/research/resin-printing-bases.md) */
  presupport: PresupportSettings;
}

export interface PresupportSettings {
  enabled: boolean;
  /** degrees; null = automatic by shape (35 rounds, 45 rectangles, 55 large rectangles) */
  tiltDeg: number | null;
  /** gap between the build plate and the piece, mm */
  standoff: number;
  /** support tip diameter, mm */
  tipDiameter: number;
  /** how many supports: light / medium / heavy (spacing also scales with base size) */
  density: 'light' | 'medium' | 'heavy';
  /** off / light (edge rail + one ring of bars on tall supports) / full lattice */
  bracing: 'off' | 'light' | 'full';
}

/** How a source mesh's sculpted shell relates to its analytic body. */
export interface SourceNormalization {
  mode: 'twoShell' | 'generic';
  /** Height of the flat plate top above z = 0, mm */
  plateTop: number;
  /** [min, max] scale range applied to the sculpt top when fitting to the plate */
  topScale: [number, number];
  /** Extra margin left around the sculpt when clipping, mm */
  sculptMargin: number;
  /** Scale factor measured from the source mesh vs. its nominal size */
  measuredScale: number;
}

export interface SourceStats {
  tris: number;
  components: number;
  nonManifoldEdges: number;
  boundaryEdges: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** An imported STL and everything derived from analyzing it. */
export interface Source {
  id: string;
  name: string;
  fileKey: { hash: string; size: number };
  /** Nominal (catalog) shape this source is believed to represent */
  nominal: Shape;
  normalization: SourceNormalization;
  stats: SourceStats;
  /** The root Piece for this source (whole, uncut) */
  rootPieceId: string;
  /** where the scene came from: an STL file (default) or a Base Studio bake */
  origin?: 'file' | 'studio';
  studioId?: string;
}

/** What the user is making. Decides what can be placed on the big base and how deep it nests. */
export type WorkMode = 'diorama' | 'multibase' | 'single';

/** 'frame' = a reference outline (e.g. a unit footprint) that holds bases; 'leftover' = generated in Diorama mode. */
export type PieceRole = 'base' | 'frame' | 'leftover';

export interface MagnetSlot {
  id: string;
  /** Slot centre in the owning piece's local frame */
  xy: Vec2;
  /** Per-slot override of MagnetSettings.dia, if set */
  dia?: number;
  /** Per-slot override of MagnetSettings.thick, if set */
  thick?: number;
}

/**
 * One node in a source's cut tree. `xy` is the centre of this piece's cutter
 * in the PARENT piece's local frame, whose origin is the parent's footprint
 * bbox centre. The root piece of a source has xy [0,0] and shape equal to the
 * source's nominal shape.
 */
export interface Piece {
  id: string;
  sourceId: string;
  parentId: string | null;
  name: string;
  shape: Shape;
  xy: Vec2;
  rotDeg: number;
  /**
   * 4 entries for rect (order: bottom edge y=-d/2, right x=+w/2, top y=+d/2,
   * left x=-w/2, i.e. CCW starting from the (-w/2,-d/2) corner), 1 entry for
   * ellipse.
   */
  edges: EdgeTreatment[];
  /** edge profile of this base (GW slight bevel, flat, custom, or the file's original slope); undefined = project default */
  profile?: EdgeProfile;
  /** default 'base' */
  role?: PieceRole;
  /** 'full' (default) cuts the whole column out of the scene; 'plug' takes only the top `plugDepth` and the scene keeps a socket */
  cut?: 'full' | 'plug';
  /** mm; undefined = project default */
  plugDepth?: number;
  /** mm per side; undefined = project default */
  plugClearance?: number;
  magnets: { mode: 'auto' | 'manual'; slots: MagnetSlot[] };
  children: string[];
}

/** Defaults for plug cuts. */
export interface PlugSettings {
  /** how much terrain a plug base takes with it, measured from the lowest point over its footprint, mm */
  depth: number;
  /** gap between the plug and its socket, per side, mm */
  clearance: number;
}

/** The underside of every base: hollow with a brim (default) or a solid plate. */
export interface UndersideSettings {
  hollow: boolean;
  /** void depth under the base, mm; a magnet glued to the ceiling ends flush when this equals its thickness */
  voidDepth: number;
  /** solid brim width around the footprint, mm: the seating surface */
  rimWidth: number;
  /** magnet locating ring on the ceiling: height and wall width, mm */
  ringHeight: number;
  ringWidth: number;
  /** raised text on the void ceiling; empty = none */
  watermark: string;
  watermarkHeight: number;
}

export interface Project {
  version: 1;
  name: string;
  sources: Record<string, Source>;
  pieces: Record<string, Piece>;
  magnet: MagnetSettings;
  export: ExportSettings;
  underside: UndersideSettings;
  plug: PlugSettings;
  /** Base Studio scenes, by document id (saved with the project so they can be re-opened and re-baked) */
  studio?: Record<string, StudioDocument>;
  /** edge profile given to newly added bases when their size preset does not imply one */
  defaultProfile: EdgeProfile;
  /** what the user is making; default 'multibase' */
  mode: WorkMode;
  selectedId: string | null;
}
