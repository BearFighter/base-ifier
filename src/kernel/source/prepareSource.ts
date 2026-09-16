/**
 * Turn a raw base STL into the normalised representation the pipeline works on:
 * an analytic body outline (bottom / top / plateTop) in nominal millimetres and a
 * trimmed, welded, binned sculpt mesh.
 */
import type { Bounds3, IndexedMesh, Shape, Soup, Vec2 } from '../types';
import { weld } from '../mesh/weld';
import { connectedComponents, extractComponent, extractComponents } from '../mesh/components';
import { manifoldReport } from '../mesh/validate';
import { boundsOfSoup } from '../mesh/bbox';
import { transformSoup } from '../mesh/transform';
import { analyzeBody, type BodyAnalysis } from '../body/analyzeBody';
import { trimAbove } from '../sculpt/trim';
import { buildBins, type Bins } from '../sculpt/bins';
import { convexHull } from '../geom2d/hull';
import { polygonBounds, polygonCentroid, scalePolygonAbout } from '../geom2d/polygon';
import { nominalFromFilename } from './nominalFromFilename';

export interface PreparedSource {
  name: string;
  nominal: Shape;
  /** measured footprint / nominal footprint (≈0.9947 for OPR files) */
  measuredScale: number;
  mode: 'twoShell' | 'generic';
  /** body outline in the normalised frame (centred, bottom at z=0, nominal mm) */
  outline: BodyAnalysis;
  /** trimmed sculpt, normalised frame */
  sculpt: IndexedMesh;
  bins: Bins;
  /** z at which the sculpt was trimmed (plateTop - overlap) */
  sculptTrimZ: number;
  stats: {
    tris: number;
    bodyTris: number;
    sculptTris: number;
    components: number;
    nonManifoldEdges: number;
    boundaryEdges: number;
    bounds: Bounds3;
    rawBounds: Bounds3;
  };
  warnings: string[];
  /** transform applied to raw coordinates: p' = (p + translate) * scale */
  transform: { scale: number; translate: [number, number, number] };
  timings: Record<string, number>;
}

export interface PrepareOptions {
  /** override the nominal size (otherwise parsed from the file name) */
  nominal?: Shape;
  /** vertical overlap between sculpt and body, mm */
  sculptOverlap?: number;
  /** XY bin size, mm */
  binSize?: number;
  /** generic mode: assumed top/bottom scale when the body cannot be analysed */
  genericTopScale?: number;
  onProgress?: (stage: string, fraction: number) => void;
}

export function prepareSource(raw: Soup, name: string, opts: PrepareOptions = {}): PreparedSource {
  const warnings: string[] = [];
  const timings: Record<string, number> = {};
  const overlap = opts.sculptOverlap ?? 0.1;
  const progress = opts.onProgress ?? (() => {});
  let t0 = now();

  progress('weld', 0);
  const mesh = weld(raw);
  const comps = connectedComponents(mesh);
  const report = manifoldReport(mesh);
  timings.weld = now() - t0; t0 = now();
  progress('analyse', 0.2);

  const rawBounds = boundsOfSoup(raw);

  // body = component containing the lowest vertex
  let lowestTri = 0, lowestZ = Infinity;
  for (let t = 0; t < raw.triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const z = raw.positions[t * 9 + v * 3 + 2];
      if (z < lowestZ) { lowestZ = z; lowestTri = t; }
    }
  }
  const bodyLabel = comps.triLabel[lowestTri];
  const bodySoup = extractComponent(raw, comps.triLabel, bodyLabel);
  const bodyBounds = boundsOfSoup(bodySoup);
  const rawW = rawBounds.max[0] - rawBounds.min[0], rawD = rawBounds.max[1] - rawBounds.min[1];
  const bodyW = bodyBounds.max[0] - bodyBounds.min[0], bodyD = bodyBounds.max[1] - bodyBounds.min[1];
  const bodyH = bodyBounds.max[2] - bodyBounds.min[2];
  const twoShell =
    comps.count >= 2 &&
    bodySoup.triCount < 5000 &&
    bodyH > 1 && bodyH < 6 &&
    Math.abs(bodyW - rawW) < 0.5 && Math.abs(bodyD - rawD) < 0.5;
  const mode: 'twoShell' | 'generic' = twoShell ? 'twoShell' : 'generic';
  if (!twoShell) warnings.push('No separate base plate found: treating the file as a solid object. Bases are carved out of it, and only get a plate under them where it is thin.');

  // measured footprint (of the body in two-shell mode, else of the whole mesh)
  const measW = twoShell ? bodyW : rawW;
  const measD = twoShell ? bodyD : rawD;
  const cx = twoShell ? (bodyBounds.min[0] + bodyBounds.max[0]) / 2 : (rawBounds.min[0] + rawBounds.max[0]) / 2;
  const cy = twoShell ? (bodyBounds.min[1] + bodyBounds.max[1]) / 2 : (rawBounds.min[1] + rawBounds.max[1]) / 2;
  const z0 = twoShell ? bodyBounds.min[2] : rawBounds.min[2];

  // nominal size
  let nominal: Shape;
  let measuredScale = 1;
  const guess = opts.nominal ? { shape: opts.nominal } : nominalFromFilename(name);
  if (guess) {
    let { w, d } = guess.shape;
    // orient nominal to the measured axes
    if (Math.abs(measW - w) + Math.abs(measD - d) > Math.abs(measW - d) + Math.abs(measD - w)) { const t = w; w = d; d = t; }
    nominal = { kind: guess.shape.kind, w, d };
    const sx = measW / w, sy = measD / d;
    if (Math.abs(sx - sy) > 0.02) warnings.push(`Measured footprint ${measW.toFixed(2)} x ${measD.toFixed(2)} does not match nominal ${w} x ${d} uniformly; using the mean scale.`);
    measuredScale = (sx + sy) / 2;
    if (measuredScale < 0.9 || measuredScale > 1.1) {
      warnings.push(`Measured size differs from nominal by ${((measuredScale - 1) * 100).toFixed(1)}%; check the nominal size.`);
    }
  } else {
    const kind: Shape['kind'] = twoShell && bodySoup.triCount > 100 ? 'ellipse' : 'rect';
    nominal = { kind, w: round3(measW), d: round3(measD) };
    warnings.push('No nominal size in the file name; using the measured size.');
  }

  const scale = 1 / measuredScale;
  const translate: [number, number, number] = [-cx, -cy, -z0];
  // p' = (p + t) * s, applied in place (inputs are private copies)
  const applyT = (s: Soup) => transformSoup(s, { scale: [scale, scale, scale], translate: [-cx * scale, -cy * scale, -z0 * scale] }, true);
  timings.analyse = now() - t0; t0 = now();

  // body outline
  let outline: BodyAnalysis;
  let sculptRaw: Soup | null;
  if (twoShell) {
    outline = analyzeBody(applyT(bodySoup));
    const others: number[] = [];
    for (let l = 0; l < comps.count; l++) if (l !== bodyLabel) others.push(l);
    sculptRaw = applyT(extractComponents(raw, comps.triLabel, others));
  } else {
    const all = applyT({ positions: raw.positions.slice(), triCount: raw.triCount });
    const b = boundsOfSoup(all);
    const pts: Vec2[] = [];
    const P = all.positions;
    for (let i = 0; i < all.triCount * 3; i++) if (P[i * 3 + 2] < 0.2) pts.push([P[i * 3], P[i * 3 + 1]]);
    let bottom = convexHull(pts);
    if (bottom.length < 3) {
      bottom = [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.max[0], b.max[1]], [b.min[0], b.max[1]]];
    }
    // object mode: the whole mesh is the sculpt and there is no plate. Bases cut from it are
    // carved out of the object itself (or get a plate under them where the object is thin).
    outline = { bottom, top: bottom.slice(), plateTop: 0, topScale: [1, 1], zMin: 0, zMax: b.max[2] };
    void detectPlateTop; void polygonCentroid; void scalePolygonAbout; void polygonBounds; void opts.genericTopScale;
    sculptRaw = all;
  }
  progress('trim', 0.5);

  // two-shell: trim the sculpt just below the plate top, weld and bin it; object mode keeps every triangle
  const sculptTrimZ = twoShell ? outline.plateTop - overlap : -Infinity;
  let sculptMesh0: IndexedMesh | null = weld(sculptRaw!);
  sculptRaw = null; // release the soup copy before trimming allocates
  let sculpt: IndexedMesh;
  if (twoShell) {
    const trimmed = trimAbove(sculptMesh0, sculptTrimZ);
    sculptMesh0 = null;
    warnings.push(...trimmed.warnings);
    sculpt = weld(trimmed.soup);
    trimmed.soup = { positions: new Float32Array(0), triCount: 0 };
  } else {
    sculpt = sculptMesh0;
    sculptMesh0 = null;
  }
  timings.trim = now() - t0; t0 = now();
  progress('bins', 0.8);
  const bins = buildBins(sculpt, opts.binSize ?? 2);
  timings.bins = now() - t0;
  progress('done', 1);

  const bounds: Bounds3 = {
    min: [(rawBounds.min[0] - cx) * scale, (rawBounds.min[1] - cy) * scale, (rawBounds.min[2] - z0) * scale],
    max: [(rawBounds.max[0] - cx) * scale, (rawBounds.max[1] - cy) * scale, (rawBounds.max[2] - z0) * scale],
  };

  return {
    name,
    nominal,
    measuredScale,
    mode,
    outline,
    sculpt,
    bins,
    sculptTrimZ,
    stats: {
      tris: raw.triCount,
      bodyTris: twoShell ? bodySoup.triCount : 0,
      sculptTris: sculpt.triCount,
      components: comps.count,
      nonManifoldEdges: report.nonManifoldEdges,
      boundaryEdges: report.boundaryEdges,
      bounds,
      rawBounds,
    },
    warnings,
    transform: { scale, translate },
    timings,
  };
}

/** Peak of upward-facing triangle area between z=1 and z=8 (0.05mm bins). */
function detectPlateTop(s: Soup): number | null {
  const P = s.positions;
  const binW = 0.05, zLo = 1, zHi = 8;
  const nb = Math.ceil((zHi - zLo) / binW);
  const hist = new Float64Array(nb);
  for (let t = 0; t < s.triCount; t++) {
    const i = t * 9;
    const ax = P[i], ay = P[i + 1], az = P[i + 2], bx = P[i + 3], by = P[i + 4], bz = P[i + 5], cx = P[i + 6], cy = P[i + 7], cz = P[i + 8];
    if (Math.abs(az - bz) > 0.01 || Math.abs(az - cz) > 0.01) continue; // not flat
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (nz <= 0) continue; // not facing up
    const z = (az + bz + cz) / 3;
    if (z < zLo || z >= zHi) continue;
    hist[Math.floor((z - zLo) / binW)] += nz / 2;
  }
  let best = -1, bestA = 0;
  for (let i = 0; i < nb; i++) if (hist[i] > bestA) { bestA = hist[i]; best = i; }
  return best < 0 ? null : zLo + (best + 0.5) * binW;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
