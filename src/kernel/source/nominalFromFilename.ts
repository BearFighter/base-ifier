import type { Shape } from '../types';

export interface NominalGuess {
  shape: Shape;
  /** which part of the file name matched */
  matched: string;
}

/**
 * Parse a nominal base size out of a file name.
 * Handles OPR names like "S_Base_Square_150mm_100mm_1.stl", "S_Base_Round_60mm_35mm_1.stl",
 * and generic names like "base_32mm.stl", "25x50.stl", "oval_105x70.stl", "round-40.stl".
 */
export function nominalFromFilename(name: string): NominalGuess | null {
  const base = name.replace(/\.[^.]+$/, '');
  const lower = base.toLowerCase();
  const isRound = /round|oval|circle|ellip/.test(lower);
  const isSquare = /square|rect|sq\b/.test(lower);

  // OPR style: "<Shape>_<a>mm_<b>mm" or "<Shape>_<a>mm"
  let m = /(round|square|oval|rect)[_\- ]*(\d+(?:\.\d+)?)\s*mm(?:[_\- ]*(\d+(?:\.\d+)?)\s*mm)?/i.exec(base);
  if (m) {
    const a = parseFloat(m[2]);
    const b = m[3] ? parseFloat(m[3]) : a;
    const kind = /round|oval/i.test(m[1]) ? 'ellipse' : 'rect';
    return { shape: { kind, w: Math.max(a, b), d: Math.min(a, b) }, matched: m[0] };
  }
  // "AxB" style
  m = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(base);
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    const kind = isRound ? 'ellipse' : 'rect';
    return { shape: { kind, w: Math.max(a, b), d: Math.min(a, b) }, matched: m[0] };
  }
  // single size with mm
  m = /(\d+(?:\.\d+)?)\s*mm/i.exec(base);
  if (m) {
    const a = parseFloat(m[1]);
    const kind = isSquare ? 'rect' : isRound ? 'ellipse' : 'ellipse';
    return { shape: { kind, w: a, d: a }, matched: m[0] };
  }
  return null;
}
