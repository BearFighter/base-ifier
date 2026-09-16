/**
 * Layout-mode helpers: grids, "add preset" placement, fill remainder.
 */
import type { Shape } from '@/kernel/types';
import { largestEmptyRect } from '@/kernel/geom2d/maxEmptyRect';
import type { DraftCutter } from '@/state/types';
import { draftRect, type Rect } from './snap';

let counter = 0;
export function draftId(): string {
  counter++;
  return 'draft-' + Date.now().toString(36) + '-' + counter.toString(36);
}

/** Rect in container coordinates (min corner at 0,0) from a local-frame rect. */
function toContainer(r: Rect, container: { w: number; d: number }): Rect {
  return { x: r.x + container.w / 2, y: r.y + container.d / 2, w: r.w, h: r.h };
}

/** Largest free rectangle in the container not covered by `occupied` (local-frame rects). */
export function freeRect(container: { w: number; d: number }, occupied: Rect[], step = 0.5): Rect | null {
  const r = largestEmptyRect({ w: container.w, h: container.d }, occupied.map((o) => toContainer(o, container)), step);
  if (!r) return null;
  return { x: r.x - container.w / 2, y: r.y - container.d / 2, w: r.w, h: r.h };
}

/** Place a new shape of size w x d into the largest free area (bottom-left of it), or centred if nothing fits. */
export function placeNew(shape: Shape, container: { w: number; d: number }, occupied: Rect[], name?: string): DraftCutter {
  const free = freeRect(container, occupied);
  let x = -shape.w / 2, y = -shape.d / 2;
  if (free && free.w >= shape.w - 1e-6 && free.h >= shape.d - 1e-6) {
    x = free.x; y = free.y;
  } else if (free) {
    x = free.x; y = free.y;
  }
  return { id: draftId(), shape: { ...shape }, xy: [x + shape.w / 2, y + shape.d / 2], rotDeg: 0, name };
}

/** A draft covering the largest free rectangle. */
export function fillRemainder(container: { w: number; d: number }, occupied: Rect[]): DraftCutter | null {
  const free = freeRect(container, occupied);
  if (!free || free.w < 1 || free.h < 1) return null;
  return {
    id: draftId(),
    shape: { kind: 'rect', w: round2(free.w), d: round2(free.h) },
    xy: [round2(free.x + free.w / 2), round2(free.y + free.h / 2)],
    rotDeg: 0,
  };
}

/** cols x rows grid of cellW x cellD rects anchored at the container's bottom-left corner. */
export function gridDrafts(container: { w: number; d: number }, cols: number, rows: number, cellW: number, cellD: number, gap = 0): DraftCutter[] {
  const out: DraftCutter[] = [];
  const x0 = -container.w / 2, y0 = -container.d / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * (cellW + gap), y = y0 + r * (cellD + gap);
      if (x + cellW > container.w / 2 + 1e-6 || y + cellD > container.d / 2 + 1e-6) continue;
      out.push({ id: draftId(), shape: { kind: 'rect', w: cellW, d: cellD }, xy: [round2(x + cellW / 2), round2(y + cellD / 2)], rotDeg: 0 });
    }
  }
  return out;
}

export function occupiedRects(drafts: DraftCutter[], exclude?: string): Rect[] {
  return drafts.filter((d) => d.id !== exclude).map(draftRect);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
