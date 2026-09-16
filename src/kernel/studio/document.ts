/**
 * Base Studio document: everything needed to rebuild a scene (board, ground
 * recipe, prop placements, rules). Plain data so it saves inside the project
 * file and travels to the worker; the worker turns it into a two-shell source
 * for the cutter (`bake.ts` next to this file). Lives in the kernel so the
 * worker and the UI share one definition; the kernel never imports the app.
 */
import type { Shape } from '../types';
import type { Circle } from '../props/scatter';

export type LicenceTag = 'cc0' | 'attribution' | 'merchant-prints-only' | 'personal-only' | 'no-derivatives' | 'own-rights' | 'unknown';

export interface StudioBoard {
  shape: Shape;
  /** plate thickness, mm; 2.984 matches the OPR sets */
  plateTop: number;
  /** how far the plate top sits inside the footprint per axis; OPR look is 0.9237, flat sides 1 */
  topScale: [number, number];
  /**
   * Extra board around the size you picked, mm per side. Single bases and unit
   * footprints get 1.5 mm so the base can be cut out of the scene with clean edges
   * (the margin is cut away); slabs and display boards get 0.
   */
  margin: number;
}

/** The board as actually built: the picked size grown by the margin on every side. */
export function boardShape(board: StudioBoard): Shape {
  const m = board.margin ?? 0;
  return { kind: board.shape.kind, w: board.shape.w + 2 * m, d: board.shape.d + 2 * m };
}

export interface StudioGround {
  presetId: string;
  seed: number;
  /** multiplier on the preset's roughness (0.5 gentle .. 2 rugged) */
  roughness: number;
  /** multiplier on the preset's tile stamp strength */
  texture: number;
  /** extra stamps the user placed */
  stamps: StudioStamp[];
  /** brush dabs the user painted, in order */
  strokes: StudioStroke[];
}

export interface StudioStamp {
  id: string;
  stamp: string;
  x: number;
  y: number;
  size: number;
  strength: number;
  rotDeg: number;
}

export interface StudioStroke {
  x: number;
  y: number;
  radius: number;
  strength: number;
  kind: 'raise' | 'lower' | 'smooth' | 'flatten';
}

/** One placed prop. Either a bundled/imported asset or a parametric element. */
export interface StudioProp {
  id: string;
  /** asset id from the pack manifest, or 'param:<kind>' */
  assetId: string;
  /** parametric parameters when assetId starts with 'param:' */
  params?: Record<string, number>;
  x: number;
  y: number;
  /** yaw, degrees */
  rotDeg: number;
  scale: number;
  /** extra sink into the ground, mm */
  sink: number;
  seed: number;
  licence: LicenceTag;
  /** placed by a scatter brush (true) or by hand (false); scatters can be re-rolled */
  scattered: boolean;
  hero?: boolean;
}

export interface StudioRules {
  rimInset: number;
  footZones: Circle[];
  density: 'light' | 'medium' | 'heavy';
  heroProps: boolean;
  /** props sink this far into the ground by default, mm */
  sink: number;
  /** override the preset's height cap, mm; null = preset default by board size */
  heightCap: number | null;
}

export interface StudioDocument {
  id: string;
  name: string;
  version: 1;
  board: StudioBoard;
  ground: StudioGround;
  props: StudioProp[];
  rules: StudioRules;
  /** the last scatter seed, so "Re-roll" changes it */
  scatterSeed: number;
  /** the Source this document was last baked into, if any */
  sourceId?: string;
}

export interface BoardPreset {
  id: string;
  label: string;
  group: string;
  shape: Shape;
}

/** Board sizes offered in the studio: single bases, unit footprints, slabs, boards. */
export const BOARD_PRESETS: BoardPreset[] = [
  { id: 'r25', label: '25 mm round', group: 'Single bases', shape: { kind: 'ellipse', w: 25, d: 25 } },
  { id: 'r32', label: '32 mm round', group: 'Single bases', shape: { kind: 'ellipse', w: 32, d: 32 } },
  { id: 'r40', label: '40 mm round', group: 'Single bases', shape: { kind: 'ellipse', w: 40, d: 40 } },
  { id: 'r50', label: '50 mm round', group: 'Single bases', shape: { kind: 'ellipse', w: 50, d: 50 } },
  { id: 'r60', label: '60 mm round', group: 'Single bases', shape: { kind: 'ellipse', w: 60, d: 60 } },
  { id: 'o60x35', label: '60 × 35 mm oval', group: 'Single bases', shape: { kind: 'ellipse', w: 60, d: 35 } },
  { id: 'o75x42', label: '75 × 42 mm oval', group: 'Single bases', shape: { kind: 'ellipse', w: 75, d: 42 } },
  { id: 's20', label: '20 mm square', group: 'Single bases', shape: { kind: 'rect', w: 20, d: 20 } },
  { id: 's25', label: '25 mm square', group: 'Single bases', shape: { kind: 'rect', w: 25, d: 25 } },
  { id: 's40', label: '40 mm square', group: 'Single bases', shape: { kind: 'rect', w: 40, d: 40 } },
  { id: 's50', label: '50 mm square', group: 'Single bases', shape: { kind: 'rect', w: 50, d: 50 } },
  { id: 'kow-inf-troop', label: 'KoW Infantry Troop 100 × 40', group: 'Unit footprints', shape: { kind: 'rect', w: 100, d: 40 } },
  { id: 'kow-inf-reg', label: 'KoW Infantry Regiment 100 × 80', group: 'Unit footprints', shape: { kind: 'rect', w: 100, d: 80 } },
  { id: 'kow-hinf-troop', label: 'KoW Heavy Infantry Troop 125 × 50', group: 'Unit footprints', shape: { kind: 'rect', w: 125, d: 50 } },
  { id: 'kow-hinf-reg', label: 'KoW Heavy Infantry Regiment 125 × 100', group: 'Unit footprints', shape: { kind: 'rect', w: 125, d: 100 } },
  { id: 'kow-horde', label: 'KoW Horde 200 × 80', group: 'Unit footprints', shape: { kind: 'rect', w: 200, d: 80 } },
  { id: 'tow-inf-5', label: 'Old World rank of 5 (125 × 25)', group: 'Unit footprints', shape: { kind: 'rect', w: 125, d: 25 } },
  { id: 'slab-100x50', label: '100 × 50 mm slab', group: 'Slabs', shape: { kind: 'rect', w: 100, d: 50 } },
  { id: 'slab-150x100', label: '150 × 100 mm slab', group: 'Slabs', shape: { kind: 'rect', w: 150, d: 100 } },
  { id: 'slab-200x150', label: '200 × 150 mm slab', group: 'Slabs', shape: { kind: 'rect', w: 200, d: 150 } },
  { id: 'board-300', label: '300 × 300 mm board', group: 'Display boards', shape: { kind: 'rect', w: 300, d: 300 } },
  { id: 'board-24x18', label: '24 × 18 in board (610 × 457)', group: 'Display boards', shape: { kind: 'rect', w: 610, d: 457 } },
  { id: 'board-2x2', label: '2 × 2 ft board (610 × 610)', group: 'Display boards', shape: { kind: 'rect', w: 610, d: 610 } },
];

export function boardPreset(id: string): BoardPreset {
  return BOARD_PRESETS.find((b) => b.id === id) ?? BOARD_PRESETS[17];
}

/** Margin a preset gets: single bases and unit footprints are cut OUT of the scene, so they get room around them. */
export function boardMargin(preset: BoardPreset): number {
  return preset.group === 'Single bases' || preset.group === 'Unit footprints' ? 1.5 : 0;
}

let counter = 0;
export function studioId(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/** A fresh scene: a 150 x 100 slab of temple ruins with one centred foot zone off. */
export function newStudioDocument(name = 'My scene', shape: Shape = { kind: 'rect', w: 150, d: 100 }, presetId = 'temple-ruins', margin = 0): StudioDocument {
  const seed = Math.floor(Math.random() * 1e9);
  return {
    id: studioId('st'),
    name,
    version: 1,
    // vertical plate sides: the cutter gives every cut base its own edge profile, and a
    // leaning plate top (the OPR look) would shrink the usable area below the picked size
    board: { shape, plateTop: 2.984, topScale: [1, 1], margin },
    ground: { presetId, seed, roughness: 1, texture: 1, stamps: [], strokes: [] },
    props: [],
    rules: { rimInset: 1.5, footZones: [], density: 'medium', heroProps: true, sink: 0.5, heightCap: null },
    scatterSeed: seed ^ 0x9e3779b9,
  };
}
