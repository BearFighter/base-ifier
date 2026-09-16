/**
 * STL export helpers: single piece and a packed "print plate" of many pieces.
 */
import type { Soup } from '../types';
import { concatSoups } from '../types';
import { writeBinaryStl } from '../stl/write';
import { boundsOfSoup } from '../mesh/bbox';
import { transformSoup } from '../mesh/transform';

export interface ExportablePiece {
  name: string;
  body: Soup;
  sculpt: Soup;
  /** print supports (print-ready exports only); already in print space */
  supports?: Soup;
}

export function pieceToStl(p: ExportablePiece): ArrayBuffer {
  const shells = p.supports && p.supports.triCount > 0 ? [p.body, p.sculpt, p.supports] : [p.body, p.sculpt];
  return writeBinaryStl(shells, `Base-ifier ${p.name}`.slice(0, 80));
}

export interface PlateOptions {
  gap?: number;
  /** maximum row width before wrapping, mm */
  rowWidth?: number;
}

/** Shelf-pack pieces on the XY plane (each piece keeps its own orientation). */
export function packPlate(pieces: ExportablePiece[], opts: PlateOptions = {}): { soup: Soup; placements: { name: string; x: number; y: number; w: number; d: number }[] } {
  const gap = opts.gap ?? 3;
  const rowWidth = opts.rowWidth ?? 200;
  const items = pieces.map((p) => {
    const all = concatSoups(p.supports ? [p.body, p.sculpt, p.supports] : [p.body, p.sculpt]);
    const b = boundsOfSoup(all);
    return { p, all, b, w: b.max[0] - b.min[0], d: b.max[1] - b.min[1] };
  });
  items.sort((a, b) => b.d - a.d);
  const placed: Soup[] = [];
  const placements: { name: string; x: number; y: number; w: number; d: number }[] = [];
  let x = 0, y = 0, rowH = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > rowWidth) { x = 0; y += rowH + gap; rowH = 0; }
    const tx = x - it.b.min[0], ty = y - it.b.min[1], tz = -it.b.min[2];
    placed.push(transformSoup(it.all, { translate: [tx, ty, tz] }));
    placements.push({ name: it.p.name, x, y, w: it.w, d: it.d });
    x += it.w + gap;
    rowH = Math.max(rowH, it.d);
  }
  return { soup: concatSoups(placed), placements };
}

export function plateToStl(pieces: ExportablePiece[], opts: PlateOptions = {}): ArrayBuffer {
  const { soup } = packPlate(pieces, opts);
  return writeBinaryStl([soup], 'Base-ifier print plate');
}
