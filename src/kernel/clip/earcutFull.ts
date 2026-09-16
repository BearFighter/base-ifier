/**
 * earcut that guarantees every input ring vertex is referenced by the output.
 * earcut drops exactly-collinear and duplicate points; when the ring is shared
 * with other geometry (our clipped polygons and zipped side bands) that creates
 * T-junctions and open edges. Dropped points are re-inserted by splitting the
 * triangle that spans their neighbours.
 */
import earcut from 'earcut';

export function earcutFull(flat: number[], holeIndices: number[] | undefined, warnings?: string[]): number[] {
  const tris = earcut(flat, holeIndices && holeIndices.length ? holeIndices : undefined, 2);
  const nPts = flat.length / 2;
  if (nPts < 3) return tris;
  const used = new Uint8Array(nPts);
  for (const i of tris) used[i] = 1;
  let missing = 0;
  for (let i = 0; i < nPts; i++) if (!used[i]) missing++;
  if (missing === 0) return tris;

  // ring bounds
  const starts = [0, ...(holeIndices ?? [])];
  const ringOf = (i: number): [number, number] => {
    for (let r = starts.length - 1; r >= 0; r--) {
      if (i >= starts[r]) {
        const end = r + 1 < starts.length ? starts[r + 1] : nPts;
        return [starts[r], end];
      }
    }
    return [0, nPts];
  };
  const edgeMap = new Map<string, number>(); // "a|b" -> triangle index (3*t)
  const rebuildEdges = () => {
    edgeMap.clear();
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = tris[t + e], b = tris[t + ((e + 1) % 3)];
        edgeMap.set(a + '|' + b, t);
      }
    }
  };
  rebuildEdges();
  let progress = true;
  while (missing > 0 && progress) {
    progress = false;
    for (let i = 0; i < nPts; i++) {
      if (used[i]) continue;
      const [s, e] = ringOf(i);
      const n = e - s;
      if (n < 3) { used[i] = 1; missing--; continue; }
      // nearest used neighbours along the ring
      let p = i, q = i;
      for (let k = 1; k < n; k++) { p = s + ((i - s - k + n) % n); if (used[p]) break; }
      for (let k = 1; k < n; k++) { q = s + ((i - s + k) % n); if (used[q]) break; }
      if (!used[p] || !used[q] || p === q) continue;
      // an exact duplicate of a neighbour needs no triangle: it welds to the same vertex
      if ((flat[i * 2] === flat[p * 2] && flat[i * 2 + 1] === flat[p * 2 + 1]) || (flat[i * 2] === flat[q * 2] && flat[i * 2 + 1] === flat[q * 2 + 1])) {
        used[i] = 1; missing--; progress = true; continue;
      }
      // the ring edge p->q (in ring order) must appear in some triangle, in either direction
      let t = edgeMap.get(p + '|' + q);
      let flipped = false;
      if (t === undefined) { t = edgeMap.get(q + '|' + p); flipped = true; }
      if (t === undefined) continue;
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      // third vertex of the triangle
      const third = a !== p && a !== q ? a : b !== p && b !== q ? b : c;
      // replace (p,q,third) with (p,i,third) and (i,q,third), preserving winding
      if (!flipped) {
        tris[t] = p; tris[t + 1] = i; tris[t + 2] = third;
        tris.push(i, q, third);
      } else {
        tris[t] = q; tris[t + 1] = i; tris[t + 2] = third;
        tris.push(i, p, third);
      }
      used[i] = 1; missing--; progress = true;
      rebuildEdges();
    }
  }
  if (missing > 0 && warnings) warnings.push(`cap: ${missing} ring point(s) could not be re-inserted after triangulation`);
  return tris;
}
