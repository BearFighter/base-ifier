/**
 * Magnet slot specs (size + tolerance) and validity checks against a body outline.
 */
import type { BodyOutline, MagnetSlotSpec } from '../types';
import { minEdgeDistance, pointInConvexPolygon } from '../geom2d/polygon';

export interface MagnetSizing {
  dia: number;
  thick: number;
  radialTol: number;
  depthTol: number;
  sides: number;
}

export interface MagnetSlotInput {
  x: number;
  y: number;
  dia?: number;
  thick?: number;
}

export function magnetSlotSpecs(sizing: MagnetSizing, slots: MagnetSlotInput[]): MagnetSlotSpec[] {
  return slots.map((s) => {
    const dia = s.dia ?? sizing.dia;
    const thick = s.thick ?? sizing.thick;
    return {
      x: s.x,
      y: s.y,
      radius: dia / 2 + sizing.radialTol,
      depth: thick + sizing.depthTol,
      sides: Math.max(12, Math.round(sizing.sides)),
    };
  });
}

export interface SlotCheckOptions {
  floorMin: number;
  minWall: number;
}

/** Returns human-readable warnings; empty means all slots are valid. */
export function checkMagnetSlots(outline: BodyOutline, specs: MagnetSlotSpec[], opts: SlotCheckOptions): string[] {
  const warnings: string[] = [];
  specs.forEach((s, i) => {
    const label = `magnet ${i + 1}`;
    const floor = outline.plateTop - s.depth;
    if (floor < opts.floorMin - 1e-9) {
      warnings.push(`${label}: only ${floor.toFixed(2)}mm of material above the slot (minimum ${opts.floorMin}mm)`);
    }
    if (!pointInConvexPolygon(outline.bottom, s.x, s.y)) {
      warnings.push(`${label}: centre is outside the piece`);
      return;
    }
    const dTop = minEdgeDistance(outline.top, s.x, s.y);
    const wall = dTop - s.radius;
    if (wall < opts.minWall - 1e-9) {
      warnings.push(`${label}: wall to the bevelled edge is ${Math.max(0, wall).toFixed(2)}mm (minimum ${opts.minWall}mm)`);
    }
    for (let j = 0; j < i; j++) {
      const o = specs[j];
      const gap = Math.hypot(o.x - s.x, o.y - s.y) - o.radius - s.radius;
      if (gap < opts.minWall - 1e-9) warnings.push(`${label} and magnet ${j + 1} are ${Math.max(0, gap).toFixed(2)}mm apart (minimum ${opts.minWall}mm)`);
    }
  });
  return warnings;
}
