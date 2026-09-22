/**
 * Movement tray geometry, part 1: chopping the tray's SURROUND (everything that
 * is not a slot) into convex cells.
 *
 * A movement tray is a thin floor with a raised surround: the material between
 * and around the slots the bases drop into. That surround is not convex, and
 * nothing in this kernel can cut or triangulate a non-convex region
 * (`cutPrism` keeps `n·p <= d` for every plane; `buildBody`'s top cap is a fan).
 * So the surround is decomposed into convex cells once, and the SAME cell list
 * then drives both the analytic tray body (`buildTray`) and the cut of the
 * scene's sculpted surface, which is why the pocket rims can never disagree.
 *
 * Two details carry the whole design:
 *  - Slots that touch simply merge. Every grid cell that lies inside a pocket is
 *    dropped, so two pockets 0.4 mm apart leave one continuous opening with no
 *    wall and no polygon union anywhere.
 *  - `weld` compares exact float32 bit patterns, so two closed shells that share
 *    a corner fuse into a non-manifold edge, while two shells that overlap by
 *    0.01 mm stay two closed manifolds. Every cell edge that is NOT a real
 *    boundary (the tray outline or a slot wall) is therefore pushed 0.01 mm
 *    outward, so neighbouring cells overlap instead of butting together.
 *    0.01 mm is thousands of float32 ulps and a fifth of a resin pixel.
 */
import type { Polygon2, Shape, Vec2 } from '../types';
import { clipConvexPolygons } from '../geom2d/clipConvex';
import { polygonArea, polygonBounds } from '../geom2d/polygon';
import { ellipsePolygon, shapePolygon, shapeSegments } from '../geom2d/shapes';
import { complementWedges, outsetConvex } from '../pipeline/plug';

/** Thinnest wall the tray keeps between two slots, mm. Anything thinner joins the opening. */
export const TRAY_MIN_RIB = 0.4;
/** How far a cell edge that is only a seam between two cells is pushed outward, mm. */
export const TRAY_SEAM_EPS = 0.01;
/** A slot closer than this to the tray's outer edge is reported, mm. */
export const TRAY_MIN_WALL = 1.0;
/** Above this many cells the tray still builds, but the user is told it will be slow. */
export const TRAY_CELL_WARN = 400;
/** Round slots are cut as pockets with at most this many sides (a 32-gon is invisible under a base). */
export const TRAY_POCKET_SEGMENTS = 32;

export interface TrayCell {
  /** convex, CCW, in the same frame as the tray outline */
  poly: Polygon2;
  /** per edge (edge i runs poly[i] -> poly[i+1]): the edge lies on the tray's outer outline */
  onTray: boolean[];
  /** per edge: the edge lies on a slot wall */
  onPocket: boolean[];
  /** which slots this cell touches */
  touches: number[];
}

export interface TrayCellOptions {
  /** thinnest wall kept between slots, mm (default TRAY_MIN_RIB); 0 keeps everything */
  minRib?: number;
  /** outward push on seam edges, mm (default TRAY_SEAM_EPS); 0 makes the cells an exact cover */
  seamEps?: number;
  /** cells smaller than this are dropped, mm² */
  minArea?: number;
  /** grid step of the bare-floor measurement, mm */
  step?: number;
}

export interface TrayCellsResult {
  cells: TrayCell[];
  warnings: string[];
  /** cells dropped for being thinner than the minimum rib */
  slivers: number;
  /** the largest rectangle of floor with no surround across it: what makes a thin tray curl */
  thinSpan: { w: number; d: number };
}

/**
 * The pocket a base leaves in the tray: its footprint plus `gap` per side. Round
 * footprints are simplified to at most `maxSegments` sides and then grown by the
 * sagitta as well, so the gap is never SMALLER than asked anywhere.
 */
export function trayPocket(shape: Shape, cx: number, cy: number, rotDeg: number, gap: number, maxSegments = TRAY_POCKET_SEGMENTS): Polygon2 {
  if (shape.kind === 'rect') return outsetConvex(shapePolygon(shape, cx, cy, rotDeg), gap);
  const n = Math.max(8, Math.min(maxSegments, shapeSegments(shape)));
  const poly = shapePolygon({ kind: 'ellipse', w: shape.w, d: shape.d }, cx, cy, rotDeg);
  const coarse = n < poly.length ? rotateAbout(ellipsePolygon(shape.w, shape.d, n, cx, cy), rotDeg, cx, cy) : poly;
  // an inscribed n-gon dips inside the ellipse by this much at its edge midpoints
  const sagitta = (Math.max(shape.w, shape.d) / 2) * (1 - Math.cos(Math.PI / n));
  return outsetConvex(coarse, gap + sagitta);
}

function rotateAbout(poly: Polygon2, deg: number, cx: number, cy: number): Polygon2 {
  if (((deg % 360) + 360) % 360 === 0) return poly;
  const rad = (deg * Math.PI) / 180;
  const s = Math.sin(rad), c = Math.cos(rad);
  return poly.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] as Vec2);
}

/**
 * The convex cells of `tray` minus `pockets`.
 *
 * Grid first (the tray's bbox split at every pocket's bbox edges), then free
 * cells merged back into maximal rectangles — for a normal rank-and-file tray
 * the whole surround collapses to four rectangles. Only the cells a pocket
 * actually crosses go through `complementWedges`, applied once per pocket, which
 * is what makes overlapping round slots work without any polygon union.
 */
export function traySurroundCells(tray: Polygon2, pockets: Polygon2[], opts: TrayCellOptions = {}): TrayCellsResult {
  const warnings: string[] = [];
  const minRib = opts.minRib ?? TRAY_MIN_RIB;
  const seamEps = opts.seamEps ?? TRAY_SEAM_EPS;
  const minArea = opts.minArea ?? 0.02;
  if (tray.length < 3) return { cells: [], warnings: ['The tray has no outline.'], slivers: 0, thinSpan: { w: 0, d: 0 } };

  const tb = polygonBounds(tray);
  const pb = pockets.map((p) => polygonBounds(p));
  const clampX = (v: number) => Math.min(tb.max[0], Math.max(tb.min[0], v));
  const clampY = (v: number) => Math.min(tb.max[1], Math.max(tb.min[1], v));
  const xs = sortedUnique([tb.min[0], tb.max[0], ...pb.flatMap((b) => [clampX(b.min[0]), clampX(b.max[0])])]);
  const ys = sortedUnique([tb.min[1], tb.max[1], ...pb.flatMap((b) => [clampY(b.min[1]), clampY(b.max[1])])]);
  const cols = xs.length - 1, rows = ys.length - 1;
  if (cols < 1 || rows < 1) return { cells: [], warnings: ['The tray has no area.'], slivers: 0, thinSpan: { w: 0, d: 0 } };

  // --- 1. classify every grid rectangle: free / inside a slot / crossed by one
  const free = new Uint8Array(rows * cols);
  const crossed: { rect: Polygon2; pockets: number[] }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect = rectPoly(xs[c], ys[r], xs[c + 1], ys[r + 1]);
      const area = (xs[c + 1] - xs[c]) * (ys[r + 1] - ys[r]);
      if (area <= minArea) continue;
      let inside = false;
      const hits: number[] = [];
      for (let i = 0; i < pockets.length && !inside; i++) {
        if (!bboxOverlap(pb[i], xs[c], ys[r], xs[c + 1], ys[r + 1])) continue;
        const inter = clipConvexPolygons(rect, pockets[i]);
        const ia = inter.length >= 3 ? polygonArea(inter) : 0;
        if (ia >= area - 1e-9) inside = true;
        else if (ia > 1e-9) hits.push(i);
      }
      if (inside) continue; // this rectangle IS the opening
      if (hits.length === 0) free[r * cols + c] = 1;
      else crossed.push({ rect, pockets: hits });
    }
  }

  // --- 2. free rectangles merged back together, 3. wedges around the slots
  const raw: Polygon2[] = mergeFreeRects(xs, ys, free, cols, rows);
  for (const { rect, pockets: hits } of crossed) {
    let rest: Polygon2[] = [rect];
    for (const i of hits) {
      const next: Polygon2[] = [];
      for (const part of rest) {
        const b = polygonBounds(part);
        if (!bboxOverlap(pb[i], b.min[0], b.min[1], b.max[0], b.max[1])) { next.push(part); continue; }
        for (const w of complementWedges(part, pockets[i])) if (polygonArea(w) > minArea) next.push(w);
      }
      rest = next;
    }
    raw.push(...rest);
  }

  // --- 4. a round or oval tray keeps only what lies inside its own outline
  const trayIsRect = isAxisAlignedRect(tray);
  const clipped: Polygon2[] = [];
  for (const p of raw) {
    const q = trayIsRect ? p : clipConvexPolygons(p, tray);
    if (q.length >= 3 && polygonArea(q) > minArea) clipped.push(q);
  }

  // --- 5. classify the edges, then drop unprintable slivers
  const cells: TrayCell[] = [];
  let slivers = 0;
  let mergedWalls = 0;
  for (const poly of clipped) {
    const cell = classify(poly, tray, pockets);
    if (minRib > 0 && minWidth(poly) < minRib) {
      slivers++;
      if (cell.touches.length >= 2) mergedWalls++;
      continue;
    }
    cells.push(cell);
  }
  if (mergedWalls > 0) warnings.push('Two bases here are almost touching, so the tray leaves no wall between them — they share one opening.');
  if (cells.length > TRAY_CELL_WARN) warnings.push(`This tray is made of ${cells.length} separate shapes around the slots, so it takes a moment to build.`);

  // --- 6. the seam whisker, then a last check that no two cells share a corner
  const out = seamEps > 0 ? cells.map((c) => ({ ...c, poly: pushSeams(c, seamEps) })) : cells;
  if (seamEps > 0) separateCorners(out);

  return { cells: out, warnings, slivers, thinSpan: largestBareFloor(tray, out, opts.step ?? 0.5) };
}

/** True when a slot comes closer than `minWall` to the tray's outer edge (or crosses it). */
export function slotWallWarnings(tray: Polygon2, pockets: Polygon2[], minWall = TRAY_MIN_WALL): string[] {
  const warnings: string[] = [];
  let close = 0, open = 0;
  for (const p of pockets) {
    let worst = Infinity;
    for (const v of p) worst = Math.min(worst, signedInsideDistance(tray, v[0], v[1]));
    if (worst < 0) open++;
    else if (worst < minWall) close++;
  }
  if (open > 0) warnings.push(`${open === 1 ? 'A base reaches' : `${open} bases reach`} past the edge of the tray, so ${open === 1 ? 'its slot is' : 'their slots are'} open at the side. Make the rim wider, or move ${open === 1 ? 'it' : 'them'} in.`);
  else if (close > 0) warnings.push(`${close === 1 ? 'A base sits' : `${close} bases sit`} less than ${minWall} mm from the edge of the tray; a wider rim is stronger.`);
  return warnings;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sortedUnique(v: number[]): number[] {
  const s = v.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) if (out.length === 0 || x - out[out.length - 1] > 1e-9) out.push(x);
  return out;
}

export function rectPoly(x0: number, y0: number, x1: number, y1: number): Polygon2 {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function bboxOverlap(b: { min: Vec2; max: Vec2 }, x0: number, y0: number, x1: number, y1: number): boolean {
  return b.max[0] > x0 + 1e-9 && b.min[0] < x1 - 1e-9 && b.max[1] > y0 + 1e-9 && b.min[1] < y1 - 1e-9;
}

/** Row run-length merge, then merge runs with the same column span in adjacent rows. */
function mergeFreeRects(xs: number[], ys: number[], free: Uint8Array, cols: number, rows: number): Polygon2[] {
  const runs: { r0: number; r1: number; c0: number; c1: number }[] = [];
  let open = new Map<string, number>();
  for (let r = 0; r < rows; r++) {
    const next = new Map<string, number>();
    let c = 0;
    while (c < cols) {
      if (!free[r * cols + c]) { c++; continue; }
      let e = c;
      while (e + 1 < cols && free[r * cols + e + 1]) e++;
      const key = `${c},${e}`;
      const prev = open.get(key);
      if (prev !== undefined && runs[prev].r1 === r - 1) { runs[prev].r1 = r; next.set(key, prev); }
      else { runs.push({ r0: r, r1: r, c0: c, c1: e }); next.set(key, runs.length - 1); }
      c = e + 1;
    }
    open = next;
  }
  return runs.map((q) => rectPoly(xs[q.c0], ys[q.r0], xs[q.c1 + 1], ys[q.r1 + 1]));
}

function isAxisAlignedRect(poly: Polygon2): boolean {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 1e-9 && Math.abs(a[1] - b[1]) > 1e-9) return false;
  }
  return true;
}

/** Distance from (x, y) to the closest point of a closed polyline. */
function boundaryDistance(poly: Polygon2, x: number, y: number): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)));
  }
  return best;
}

/** How far inside a convex CCW polygon a point is; negative when it is outside. */
function signedInsideDistance(poly: Polygon2, x: number, y: number): number {
  let worst = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    worst = Math.min(worst, (ex * (y - a[1]) - ey * (x - a[0])) / len);
  }
  return worst;
}

/**
 * Which of a cell's edges are real boundaries. An edge counts as a tray or slot
 * wall when its MIDPOINT sits on that outline — a wedge edge that only happens
 * to lie on the same infinite line as a slot edge, out beyond its ends, is a
 * seam between two cells, not a wall.
 */
function classify(poly: Polygon2, tray: Polygon2, pockets: Polygon2[]): TrayCell {
  const n = poly.length;
  const onTray: boolean[] = new Array(n).fill(false);
  const onPocket: boolean[] = new Array(n).fill(false);
  const touches = new Set<number>();
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (boundaryDistance(tray, mx, my) < 1e-6) onTray[i] = true;
    for (let k = 0; k < pockets.length; k++) {
      if (boundaryDistance(pockets[k], mx, my) < 1e-6) { onPocket[i] = true; touches.add(k); }
    }
  }
  return { poly, onTray, onPocket, touches: [...touches] };
}

/** Minimum width of a convex polygon (rotating-calipers: the thinnest edge-to-vertex span). */
export function minWidth(poly: Polygon2): number {
  const n = poly.length;
  if (n < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    let far = 0;
    for (const p of poly) far = Math.max(far, Math.abs((ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / len));
    best = Math.min(best, far);
  }
  return best === Infinity ? 0 : best;
}

/**
 * Per-edge offset of a convex polygon: edge i moves INWARD by insets[i] (negative
 * = outward). Unlike `insetConvexEdges` this keeps outward offsets, which is the
 * whole point of the seam whisker, so it does no containment check.
 */
export function offsetEdges(poly: Polygon2, insets: number[]): Polygon2 {
  const n = poly.length;
  if (n < 3) return poly;
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const d = insets[i] ?? 0;
    // inward normal of a CCW edge
    lines.push({ px: a[0] + (-dy / len) * d, py: a[1] + (dx / len) * d, dx, dy });
  }
  const res: Polygon2 = [];
  for (let k = 0; k < n; k++) {
    const l0 = lines[(k + n - 1) % n], l1 = lines[k];
    const det = l0.dx * l1.dy - l0.dy * l1.dx;
    if (Math.abs(det) < 1e-12) { res.push([l1.px, l1.py]); continue; }
    const t = ((l1.px - l0.px) * l1.dy - (l1.py - l0.py) * l1.dx) / det;
    res.push([l0.px + l0.dx * t, l0.py + l0.dy * t]);
  }
  return res.length >= 3 && polygonArea(res) > 1e-9 ? res : poly;
}

/** Move every edge that is only a seam outward by `eps` (real walls stay exact). */
function pushSeams(cell: TrayCell, eps: number): Polygon2 {
  return offsetEdges(cell.poly, cell.poly.map((_, i) => (cell.onTray[i] || cell.onPocket[i] ? 0 : -eps)));
}

/**
 * Last line of defence for `weld`: if two cells still share a corner at float32
 * precision, grow the later one about its own centroid until they do not. The
 * nudge is well under a micron, so nothing measurable moves.
 */
function separateCorners(cells: { poly: Polygon2 }[]): void {
  const seen = new Set<string>();
  const key = (v: Vec2) => `${Math.fround(v[0])},${Math.fround(v[1])}`;
  for (const cell of cells) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!cell.poly.some((v) => seen.has(key(v)))) break;
      const cx = cell.poly.reduce((s, v) => s + v[0], 0) / cell.poly.length;
      const cy = cell.poly.reduce((s, v) => s + v[1], 0) / cell.poly.length;
      const f = 1 + 1e-5 * (attempt + 1);
      cell.poly = cell.poly.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as Vec2);
    }
    for (const v of cell.poly) seen.add(key(v));
  }
}

/**
 * The biggest rectangle of tray with nothing but floor under it — the span that
 * decides whether a thin floor will curl as it cures. Rasterises the surround on
 * a grid and runs the classic maximal-rectangle histogram over what is left.
 */
export function largestBareFloor(tray: Polygon2, cells: { poly: Polygon2 }[], step = 0.5): { w: number; d: number } {
  const b = polygonBounds(tray);
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  const cols = Math.max(1, Math.round(w / step)), rows = Math.max(1, Math.round(h / step));
  if (cols * rows > 4_000_000) return { w: 0, d: 0 };
  const solid = new Uint8Array(rows * cols);
  const inside = new Uint8Array(rows * cols);
  const mark = (poly: Polygon2, target: Uint8Array) => {
    const pbx = polygonBounds(poly);
    const c0 = Math.max(0, Math.floor((pbx.min[0] - b.min[0]) / step));
    const c1 = Math.min(cols - 1, Math.ceil((pbx.max[0] - b.min[0]) / step));
    const r0 = Math.max(0, Math.floor((pbx.min[1] - b.min[1]) / step));
    const r1 = Math.min(rows - 1, Math.ceil((pbx.max[1] - b.min[1]) / step));
    for (let r = r0; r <= r1; r++) {
      const y = b.min[1] + (r + 0.5) * step;
      for (let c = c0; c <= c1; c++) {
        if (target[r * cols + c]) continue;
        const x = b.min[0] + (c + 0.5) * step;
        if (signedInsideDistance(poly, x, y) >= 0) target[r * cols + c] = 1;
      }
    }
  };
  mark(tray, inside);
  for (const cell of cells) mark(cell.poly, solid);
  // a cell is bare floor when it is inside the tray and no surround covers it
  const heights = new Int32Array(cols);
  let best = 0, bw = 0, bh = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bare = inside[r * cols + c] === 1 && solid[r * cols + c] === 0;
      heights[c] = bare ? heights[c] + 1 : 0;
    }
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const hh = c === cols ? 0 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= hh) {
        const idx = stack.pop()!;
        const height = heights[idx];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        const area = height * width;
        if (area > best) { best = area; bw = width * step; bh = height * step; }
      }
      stack.push(c);
    }
  }
  return { w: Math.round(bw * 100) / 100, d: Math.round(bh * 100) / 100 };
}

/** The longest unbroken run of bare floor on either axis, mm — what the thickness advice uses. */
export function thinSpanMm(span: { w: number; d: number }): number {
  return Math.max(span.w, span.d);
}
