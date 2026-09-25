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

/** An item's footprint for overlap tests: its bounding rect and whether it is a rectangle or an oval inside it. */
export interface Footprint {
  rect: Rect;
  kind: 'rect' | 'ellipse';
}

/**
 * Do two footprints really overlap? Round and oval bases are tested by their own outline,
 * not their bounding square: two 32 mm rounds whose squares overlap but whose circles do
 * not are fine. Touching (within `eps`) is not overlapping.
 */
export function footprintsOverlap(a: Footprint, b: Footprint, eps = 1e-3): boolean {
  if (!rectsOverlap(a.rect, b.rect, eps)) return false;
  if (a.kind === 'rect' && b.kind === 'rect') return true;
  const round = (f: Footprint) => f.kind === 'ellipse' && Math.abs(f.rect.w - f.rect.h) < 1e-6;
  if (round(a) && round(b)) {
    const d = Math.hypot(a.rect.x + a.rect.w / 2 - (b.rect.x + b.rect.w / 2), a.rect.y + a.rect.h / 2 - (b.rect.y + b.rect.h / 2));
    return d < a.rect.w / 2 + b.rect.w / 2 - eps;
  }
  return convexOverlap(outlineOf(a), outlineOf(b), eps);
}

/** The footprint as a convex polygon (ovals: 64 points on the outline). */
function outlineOf(f: Footprint): [number, number][] {
  const { x, y, w, h } = f.rect;
  if (f.kind === 'rect') return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const cx = x + w / 2, cy = y + h / 2, n = 64;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + (w / 2) * Math.cos(t), cy + (h / 2) * Math.sin(t)]);
  }
  return pts;
}

/** Separating-axis test for two convex polygons; they overlap only if no edge normal separates them by more than -eps. */
function convexOverlap(A: [number, number][], B: [number, number][], eps: number): boolean {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length];
      const nx = y1 - y0, ny = x0 - x1;
      const len = Math.hypot(nx, ny);
      if (len < 1e-12) continue;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const [px, py] of A) { const d = (px * nx + py * ny) / len; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (const [px, py] of B) { const d = (px * nx + py * ny) / len; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      if (maxA <= minB + eps || maxB <= minA + eps) return false;
    }
  }
  return true;
}
