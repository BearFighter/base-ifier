import type { Shape, EdgeTreatment, EdgeProfile } from '@/kernel/types';
import { PROFILE_GW, PROFILE_FLAT, PROFILE_ORIGINAL } from '@/kernel/types';
import type { ExportSettings, MagnetSettings, PrinterProfile, Project, PresupportSettings, UndersideSettings, PlugSettings, TraySettings } from './types';

/** Generate a short, human-scanable unique id: `<prefix><base36 random>`. */
export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${time}${rand}`;
}

export function defaultMagnetSettings(printer: PrinterProfile = 'resin'): MagnetSettings {
  switch (printer) {
    case 'fdm':
      return {
        dia: 3,
        thick: 2,
        radialTol: 0.2,
        depthTol: 0.15,
        floorMin: 0.8,
        minWall: 1.2,
        sides: 48,
        printer: 'fdm',
      };
    case 'custom':
    case 'resin':
    default:
      return {
        dia: 3,
        thick: 2,
        radialTol: 0.1,
        depthTol: 0.1,
        floorMin: 0.6,
        minWall: 1.0,
        sides: 48,
        printer,
      };
  }
}

export function defaultExportSettings(): ExportSettings {
  return { sizing: 'source', clearanceMm: 0.25, plateGap: 3, presupport: defaultPresupportSettings() };
}

/** Research defaults (docs/research/resin-printing-bases.md): tilted, 6 mm standoff, 0.5 mm tips, edge-heavy. */
export function defaultPresupportSettings(): PresupportSettings {
  return { enabled: true, tiltDeg: null, standoff: 6, tipDiameter: 0.4, density: 'medium', bracing: 'light' };
}

/** Default edge treatment set for a shape: bevel on every edge. */
export function defaultEdges(shape: Shape): EdgeTreatment[] {
  const count = shape.kind === 'rect' ? 4 : 1;
  return Array.from({ length: count }, () => ({ kind: 'bevel' as const }));
}

export function newProject(name: string = 'Untitled'): Project {
  return {
    version: 1,
    name,
    sources: {},
    pieces: {},
    magnet: defaultMagnetSettings('resin'),
    export: defaultExportSettings(),
    underside: defaultUndersideSettings(),
    plug: defaultPlugSettings(),
    tray: defaultTraySettings(),
    studio: {},
    defaultProfile: PROFILE_GW,
    mode: 'multibase',
    selectedId: null,
  };
}

/** Plug cuts: 4 mm of terrain comes with the base, 0.2 mm per side of play in the socket. */
export function defaultPlugSettings(): PlugSettings {
  return { depth: 4, clearance: 0.2 };
}

/**
 * Movement trays: a 1 mm floor, 0.2 mm of play per side in each slot (a resin
 * drop-in fit), a 3 mm rim all round, and a magnet under every base. The floor is
 * deliberately thin by default and the app suggests thickening it once it knows
 * how much unbroken floor the layout actually leaves (see `suggestedTrayFloor`).
 */
export function defaultTraySettings(): TraySettings {
  return { floor: 1.0, gap: 0.2, edge: 3.0, magnets: true };
}

/** Floor range offered in the UI, mm. */
export const TRAY_FLOOR_MIN = 0.6;
export const TRAY_FLOOR_MAX = 4.0;

/**
 * House rule for how thick the floor should be, from the largest unbroken span of
 * bare floor the layout leaves. Thin resin sheets curl as they cure and no source
 * gives a cutoff in mm (docs/research/flat-underside.md §1), so these bands mirror
 * the app's existing 40/100 mm size bands and are meant to be confirmed with a
 * test print. Returns null when the floor already covers it.
 */
export function suggestedTrayFloor(spanMm: number, current: number): number | null {
  const want = spanMm > 110 ? 2.0 : spanMm > 60 ? 1.5 : 1.0;
  return want > current + 1e-9 ? want : null;
}

/** Hollow underside: 2 mm void inside a 2 mm brim, a cup per magnet. The maker mark is not a setting. */
export function defaultUndersideSettings(): UndersideSettings {
  return { hollow: true, voidDepth: 2, rimWidth: 2, ringHeight: 0.5, ringWidth: 0.4 };
}

/** Named edge profiles offered in the UI. */
export const PROFILE_CHOICES: { id: string; label: string; help: string; profile: EdgeProfile }[] = [
  { id: 'gw', label: 'Games Workshop style (slight bevel)', help: 'About 3 mm tall with sides that lean in ~0.7 mm, like Citadel plastic bases (40k, Age of Sigmar, The Old World).', profile: PROFILE_GW },
  { id: 'flat', label: 'Flat sides (MDF / Kings of War)', help: 'Straight vertical sides, 3 mm tall, like MDF or laser-cut bases and multibase trays.', profile: PROFILE_FLAT },
  { id: 'original', label: 'Same slope as the loaded file', help: 'Copies the proportional slope of the file you loaded (the One Page Rules set leans in about 8% per side).', profile: PROFILE_ORIGINAL },
];

/** Which named profile a preset's game system implies. */
export function profileForSystem(system: string | undefined): EdgeProfile | undefined {
  if (system === '40k' || system === 'old-world') return PROFILE_GW;
  if (system === 'kow') return PROFILE_FLAT;
  if (system === 'opr') return PROFILE_ORIGINAL;
  return undefined;
}

export function profileId(p: EdgeProfile | undefined): string {
  if (!p) return 'default';
  if (p.kind === 'original') return 'original';
  const hit = PROFILE_CHOICES.find((c) => c.profile.kind === 'inset' && Math.abs(c.profile.inset - p.inset) < 1e-9 && Math.abs(c.profile.height - p.height) < 1e-9);
  return hit ? hit.id : 'custom';
}
