/**
 * Snapping helpers for cutter frames, all in the selected piece's local frame (mm).
 */
import type { DraftCutter } from '@/state/types';

export interface Rect {
  /** min corner */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function draftRect(d: DraftCutter): Rect {
  return { x: d.xy[0] - d.shape.w / 2, y: d.xy[1] - d.shape.d / 2, w: d.shape.w, h: d.shape.d };
}

export interface SnapLines {
  xs: number[];
  ys: number[];
}

/** Candidate snap lines: container edges + centre, plus the edges and centres of other rects. */
export function snapLines(container: { w: number; d: number }, others: Rect[]): SnapLines {
  const xs = [-container.w / 2, 0, container.w / 2];
  const ys = [-container.d / 2, 0, container.d / 2];
  for (const r of others) {
    xs.push(r.x, r.x + r.w, r.x + r.w / 2);
    ys.push(r.y, r.y + r.h, r.y + r.h / 2);
  }
  return { xs, ys };
}

function nearest(values: number[], v: number, tol: number): number | null {
  let best: number | null = null, bestD = tol;
  for (const c of values) {
    const d = Math.abs(c - v);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Snap a moving rect (edges and centre) to the lines; returns the snapped min corner. */
export function snapMove(r: Rect, lines: SnapLines, tol: number): { x: number; y: number; snappedX: number | null; snappedY: number | null } {
  let x = r.x, y = r.y, snappedX: number | null = null, snappedY: number | null = null;
  for (const [edge, off] of [[r.x, 0], [r.x + r.w, r.w], [r.x + r.w / 2, r.w / 2]] as [number, number][]) {
    const s = nearest(lines.xs, edge, tol);
    if (s !== null) { x = s - off; snappedX = s; break; }
  }
  for (const [edge, off] of [[r.y, 0], [r.y + r.h, r.h], [r.y + r.h / 2, r.h / 2]] as [number, number][]) {
    const s = nearest(lines.ys, edge, tol);
    if (s !== null) { y = s - off; snappedY = s; break; }
  }
  return { x, y, snappedX, snappedY };
}

/** Snap a single edge coordinate while resizing. */
export function snapEdge(v: number, values: number[], tol: number): number {
  const s = nearest(values, v, tol);
  return s === null ? v : s;
}

export function round(v: number, step = 0.01): number {
  return Math.round(v / step) * step;
}

export function clampRectToContainer(r: Rect, container: { w: number; d: number }): Rect {
  const hw = container.w / 2, hd = container.d / 2;
  let { x, y } = r;
  if (x < -hw) x = -hw;
  if (x + r.w > hw) x = hw - r.w;
  if (y < -hd) y = -hd;
  if (y + r.h > hd) y = hd - r.h;
  return { x, y, w: r.w, h: r.h };
}

export function rectsOverlap(a: Rect, b: Rect, eps = 1e-6): boolean {
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}
