/**
 * Typed access to the bundled preset catalog (src/presets/bases.json):
 * game systems, individual base sizes, and multi-model unit footprints.
 */

import type { Shape } from '@/kernel/types';
import data from '@/presets/bases.json';

export interface GameSystem {
  id: string;
  name: string;
  notes?: string;
}

export interface BasePreset {
  system: string;
  name: string;
  shape: Shape;
  w: number;
  d: number;
  use?: string;
  notes?: string;
  kind: 'base' | 'footprint';
  troopType?: string;
  unitSize?: string;
  models?: number;
}

export interface MagnetPreset {
  dia: number;
  thick: number;
  label: string;
  notes?: string;
}

type RawShape = 'round' | 'oval' | 'square' | 'rect';

interface RawBase {
  system: string;
  name: string;
  shape: RawShape;
  w: number;
  d: number;
  use?: string;
  notes?: string;
}

interface RawFootprint {
  system: string;
  name: string;
  troopType: string;
  unitSize: string;
  w: number;
  d: number;
  models: number;
  notes?: string;
}

interface RawData {
  systems: GameSystem[];
  bases: RawBase[];
  footprints: RawFootprint[];
  magnets: MagnetPreset[];
}

const raw = data as RawData;

export const SYSTEMS: GameSystem[] = raw.systems;

function toShape(kind: RawShape, w: number, d: number): Shape {
  return kind === 'round' || kind === 'oval' ? { kind: 'ellipse', w, d } : { kind: 'rect', w, d };
}

let cachedPresets: BasePreset[] | null = null;

/** All base presets (individual bases + multi-model unit footprints). */
export function allPresets(): BasePreset[] {
  if (cachedPresets) return cachedPresets;
  const bases: BasePreset[] = raw.bases.map((b) => ({
    system: b.system,
    name: b.name,
    shape: toShape(b.shape, b.w, b.d),
    w: b.w,
    d: b.d,
    use: b.use,
    notes: b.notes,
    kind: 'base',
  }));
  const footprints: BasePreset[] = raw.footprints.map((f) => ({
    system: f.system,
    name: f.name,
    shape: { kind: 'rect', w: f.w, d: f.d },
    w: f.w,
    d: f.d,
    notes: f.notes,
    kind: 'footprint',
    troopType: f.troopType,
    unitSize: f.unitSize,
    models: f.models,
  }));
  cachedPresets = [...bases, ...footprints];
  return cachedPresets;
}

export function presetsForSystem(id: string): BasePreset[] {
  return allPresets().filter((p) => p.system === id);
}

export function findPreset(system: string, name: string): BasePreset | undefined {
  return allPresets().find((p) => p.system === system && p.name === name);
}

export function magnetPresets(): MagnetPreset[] {
  return raw.magnets;
}

/** Human-readable label, e.g. "125 x 50 mm — Heavy Infantry Troop (10)". */
export function presetLabel(p: BasePreset): string {
  const size = `${p.w} x ${p.d} mm`;
  if (p.kind === 'footprint') {
    return `${size} — ${p.troopType} ${p.unitSize} (${p.models})`;
  }
  const suffix = p.use ? ` (${p.use})` : '';
  return `${size} — ${p.name}${suffix}`;
}

/** Presets whose footprint matches w x d in either orientation, within `tol` mm. */
export function matchPresetsBySize(w: number, d: number, tol = 0.01): BasePreset[] {
  return allPresets().filter((p) => {
    const straight = Math.abs(p.w - w) <= tol && Math.abs(p.d - d) <= tol;
    const swapped = Math.abs(p.w - d) <= tol && Math.abs(p.d - w) <= tol;
    return straight || swapped;
  });
}
