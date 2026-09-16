/**
 * Print-ready ("pre-supported") export.
 *
 * Tilts a finished piece about the long axis of its footprint, lifts it off
 * the build plate and generates resin supports under its flat underside so
 * the exported STL can go straight into a slicer. The scheme follows
 * docs/research/resin-printing-bases.md and the OPR "Supported STL" files:
 * tilted (never flat), no raft, ~6 mm standoff, supports standing on small
 * flared feet, denser along the footprint edge than in the middle, never
 * touching a magnet recess. Density and bracing follow
 * docs/research/support-patterns.md: contacts relax from the edge to the
 * middle and with base size; the edge feet are fused into a low rail; pillars
 * over ~8 mm get one ring of horizontal bracing ('light') or a full zig-zag
 * lattice ('full').
 *
 * Coordinates: the input soups are in the piece's local frame (Z up, bottom
 * face at z = 0, footprint centred on the origin). The output is in "print"
 * space: Z up, build plate at z = 0, everything above it.
 */
import type { Bounds3, MagnetSlotSpec, Polygon2, Soup, Vec2, Vec3 } from '../types';
import { SoupBuilder } from '../types';
import { insetConvex } from '../geom2d/offset';
import { pointInConvexPolygon, polygonBounds, polygonCentroid } from '../geom2d/polygon';
import { boundsOfSoup } from '../mesh/bbox';

export interface PresupportOptions {
  /** tilt of the underside from the build plate, degrees; 0 prints flat on the supports */
  tiltDeg: number;
  /** gap between the plate and the lowest point of the piece, mm */
  standoff: number;
  /** contact diameter where the support meets the piece, mm */
  tipDiameter: number;
  /** length of the cone between the pillar and the neck, mm */
  tipLength: number;
  /** thin cylinder of `tipDiameter` just before the surface, mm; keeps the contact round and small */
  neckLength: number;
  /** 'normal': the tip meets the underside square-on (round contact); 'vertical': straight up */
  tipAlign: 'normal' | 'vertical';
  /** diameter of a small ball centred on the contact, mm; 0 = none. Breaks at the neck and leaves a dome that sands in a stroke */
  contactBall: number;
  /** pillar diameter, mm (tall pillars are widened automatically) */
  pillarDiameter: number;
  /** diameter of the flared foot on the plate, mm */
  footDiameter: number;
  /** height of the foot flare, mm */
  footHeight: number;
  /** spacing of supports in the middle of the underside, mm */
  spacing: number;
  /** spacing of supports along the footprint edge, mm */
  edgeSpacing: number;
  /** how far inside the footprint edge the edge ring sits, mm */
  edgeInset: number;
  /** how far the tip enters the underside along its axis, mm */
  penetration: number;
  /** extra clearance kept around magnet recesses, mm */
  slotClearance: number;
  /** segments around each support */
  segments: number;
  /** off: nothing; light: edge rail + one ring of bars at mid height; full: rail + bars every braceInterval + diagonals */
  bracing: BracingLevel;
  /** link pillars closer than this (horizontal distance, mm); 0 = 1.6 x the larger spacing */
  braceMaxLink: number;
  /** vertical distance between bracing levels ('full'), mm */
  braceInterval: number;
  /** strut diameter, mm */
  braceDiameter: number;
  /** pillars shorter than this are never braced, mm */
  braceMinHeight: number;
  /** diameter of the low rail that fuses the edge-ring feet, mm */
  railDiameter: number;
}

export type SupportDensity = 'light' | 'medium' | 'heavy';
export type BracingLevel = 'off' | 'light' | 'full';

/**
 * Contact spacing by base size and density preset, mm. Bands: up to 40 mm,
 * 40-100 mm, over 100 mm. 'heavy' is the research/OPR-like density; 'medium'
 * (default) is what the user asked for after a heavy print worked; 'light' is
 * for confident users with a well-tuned printer.
 */
export function densitySpacing(maxDim: number, density: SupportDensity): { edgeSpacing: number; spacing: number } {
  const band = maxDim <= 40 ? 0 : maxDim <= 100 ? 1 : 2;
  const table: Record<SupportDensity, { edge: number[]; mid: number[] }> = {
    heavy: { edge: [1.5, 2, 2.5], mid: [3, 4.5, 6] },
    medium: { edge: [2.5, 3, 3.5], mid: [5, 6, 8] },
    light: { edge: [4, 5, 6], mid: [8, 10, 12] },
  };
  return { edgeSpacing: table[density].edge[band], spacing: table[density].mid[band] };
}

export const DEFAULT_PRESUPPORT: PresupportOptions = {
  tiltDeg: 45,
  standoff: 6,
  tipDiameter: 0.4,
  tipLength: 1.5,
  neckLength: 0.4,
  tipAlign: 'normal',
  contactBall: 0.5,
  pillarDiameter: 1.4,
  footDiameter: 3,
  footHeight: 0.5,
  spacing: 5,
  edgeSpacing: 2.5,
  edgeInset: 1,
  penetration: 0.2,
  slotClearance: 0.8,
  segments: 12,
  bracing: 'light',
  braceMaxLink: 0,
  braceInterval: 8,
  braceDiameter: 0.8,
  braceMinHeight: 8,
  railDiameter: 1.2,
};

/** Research default: rounds/ovals 35°, rectangles 45°, the largest rectangles 55°. */
export function autoTiltDeg(shape: { kind: 'rect' | 'ellipse'; w: number; d: number }): number {
  if (shape.kind === 'ellipse') return 35;
  return Math.max(shape.w, shape.d) >= 100 ? 55 : 45;
}

export interface PresupportInput {
  body: Soup;
  sculpt: Soup;
  /** footprint at z = 0 in the piece's local frame (CCW, convex) */
  bottom: Polygon2;
  /** magnet recesses in the same frame (already scaled like the outline) */
  slots: MagnetSlotSpec[];
  /** hollow underside: the void outline and depth; interior contacts then land on the ceiling */
  underside?: { rim: Polygon2; depth: number };
}

export interface PresupportResult {
  body: Soup;
  sculpt: Soup;
  /** all supports, one closed shell each */
  supports: Soup;
  /** where the support tips meet the underside, print space */
  contacts: Vec3[];
  /** outward (downward) unit normal of the underside in print space; tips enter along -normal */
  normal: Vec3;
  tiltDeg: number;
  /** axis the piece was tilted about: its long footprint axis */
  axis: 'x' | 'y';
  /** overall print height, mm */
  height: number;
  bounds: Bounds3;
  supportCount: number;
  /** bracing struts added between neighbouring pillars */
  strutCount: number;
  /** rail segments fusing the edge-ring feet */
  railCount: number;
  warnings: string[];
}

interface Frame {
  /** local -> print (rotation only) */
  rot(p: Vec3): Vec3;
  /** print -> local (rotation only) */
  inv(p: Vec3): Vec3;
  lift: number;
}

function makeFrame(axis: 'x' | 'y', tiltDeg: number): Omit<Frame, 'lift'> {
  const t = (tiltDeg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  if (axis === 'y') {
    // rotate about Y: the X extent climbs
    return {
      rot: ([x, y, z]) => [x * c + z * s, y, -x * s + z * c],
      inv: ([x, y, z]) => [x * c - z * s, y, x * s + z * c],
    };
  }
  // rotate about X: the Y extent climbs
  return {
    rot: ([x, y, z]) => [x, y * c - z * s, y * s + z * c],
    inv: ([x, y, z]) => [x, y * c + z * s, -y * s + z * c],
  };
}

function rotateSoup(soup: Soup, rot: (p: Vec3) => Vec3, lift: number): Soup {
  const n = soup.triCount * 9;
  const src = soup.positions;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    const p = rot([src[i], src[i + 1], src[i + 2]]);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2] + lift;
  }
  return { positions: out, triCount: soup.triCount };
}

function minZAfter(soup: Soup, rot: (p: Vec3) => Vec3): number {
  const n = soup.triCount * 9;
  const src = soup.positions;
  let m = Infinity;
  for (let i = 0; i < n; i += 3) {
    const z = rot([src[i], src[i + 1], src[i + 2]])[2];
    if (z < m) m = z;
  }
  return m;
}

/** Points every `step` mm along a closed polygon, starting at each vertex so corners are covered. */
function ringPoints(poly: Polygon2, step: number): Vec2[] {
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const k = Math.max(1, Math.round(len / step));
    for (let j = 0; j < k; j++) {
      const f = j / k;
      out.push([a[0] + dx * f, a[1] + dy * f]);
    }
  }
  return out;
}

/** Hex-ish grid of points inside a convex polygon. */
function gridPoints(poly: Polygon2, step: number): Vec2[] {
  const out: Vec2[] = [];
  if (poly.length < 3) return out;
  const b = polygonBounds(poly);
  const c = polygonCentroid(poly);
  const rowH = step * 0.866;
  const rows = Math.ceil((b.max[1] - b.min[1]) / rowH) + 2;
  const cols = Math.ceil((b.max[0] - b.min[0]) / step) + 2;
  for (let r = -rows; r <= rows; r++) {
    const y = c[1] + r * rowH;
    if (y < b.min[1] || y > b.max[1]) continue;
    const off = (r & 1) !== 0 ? step / 2 : 0;
    for (let q = -cols; q <= cols; q++) {
      const x = c[0] + q * step + off;
      if (x < b.min[0] || x > b.max[0]) continue;
      if (pointInConvexPolygon(poly, x, y)) out.push([x, y]);
    }
  }
  return out;
}

/**
 * Support contact points in the piece's local XY: the edge ring (in order, on the
 * seating brim at z = 0) and the middle grid (on the void ceiling at `gridZ` when
 * the underside is hollow, otherwise on the flat underside at z = 0).
 */
export function supportLayout(bottom: Polygon2, slots: MagnetSlotSpec[], opts: PresupportOptions, underside?: { rim: Polygon2; depth: number }): { ring: Vec2[]; grid: Vec2[]; gridZ: number } {
  const ringPoly = insetConvex(bottom, opts.edgeInset);
  // the cone below a ceiling contact is ~1.4 mm wide, so keep it off the void wall
  const inner = underside ? insetConvex(underside.rim, Math.max(1, opts.pillarDiameter * 0.75)) : insetConvex(bottom, opts.edgeInset + opts.spacing * 0.75);
  const gridZ = underside ? underside.depth : 0;
  const keepOut = slots.map((s) => ({ x: s.x, y: s.y, r: s.radius + (underside ? 0.6 : 0) + opts.slotClearance }));
  const minSep = Math.min(opts.edgeSpacing, opts.spacing) * 0.5;
  const accepted: Vec2[] = [];
  const take = (p: Vec2): boolean => {
    if (keepOut.some((k) => Math.hypot(p[0] - k.x, p[1] - k.y) < k.r)) return false;
    if (accepted.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < minSep)) return false;
    accepted.push(p);
    return true;
  };
  const ring = (ringPoly.length >= 3 ? ringPoints(ringPoly, opts.edgeSpacing) : [polygonCentroid(bottom)]).filter(take);
  const grid = (inner.length >= 3 ? gridPoints(inner, opts.spacing) : []).filter(take);
  return { ring, grid, gridZ };
}

/** All contact points, edge ring first. */
export function supportContacts(bottom: Polygon2, slots: MagnetSlotSpec[], opts: PresupportOptions): Vec2[] {
  const l = supportLayout(bottom, slots, opts);
  return [...l.ring, ...l.grid];
}

interface SupportPost {
  /** pillar axis on the plate */
  x: number;
  y: number;
  /** pillar top (where the tip starts), mm above the plate */
  top: number;
}

/** Triangles one support produces (pillar + joint + tip), for tests. */
export function supportTriangles(opts: PresupportOptions): number {
  const seg = Math.max(6, Math.round(opts.segments));
  const rows = Math.max(3, Math.round(seg / 2));
  const pillar = 6 * seg - 4; // foot ring, pillar ring, top ring: 2 bands + 2 caps
  const sphere = seg * (2 * rows - 2);
  const tip = 6 * seg - 4; // cone + neck: 2 bands + 2 caps
  const ball = opts.contactBall > 0 ? sphere : 0;
  return pillar + sphere + tip + ball;
}

/** Closed lathe: rings of (radius) at points along an axis, capped at both ends. Rings are CCW about `axis`. */
function addLathe(out: SoupBuilder, centres: Vec3[], radii: number[], axis: Vec3, seg: number): void {
  const ref: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u0: Vec3 = [axis[1] * ref[2] - axis[2] * ref[1], axis[2] * ref[0] - axis[0] * ref[2], axis[0] * ref[1] - axis[1] * ref[0]];
  const ul = Math.hypot(u0[0], u0[1], u0[2]);
  const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v: Vec3 = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
  const rings = centres.map((c, k) => {
    const r = radii[k];
    const pts: Vec3[] = [];
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const cu = Math.cos(t) * r, sv = Math.sin(t) * r;
      pts.push([c[0] + u[0] * cu + v[0] * sv, c[1] + u[1] * cu + v[1] * sv, c[2] + u[2] * cu + v[2] * sv]);
    }
    return pts;
  });
  const first = rings[0], last = rings[rings.length - 1];
  for (let i = 1; i < seg - 1; i++) out.triV(first[0], first[i + 1], first[i]); // faces -axis
  for (let k = 0; k < rings.length - 1; k++) {
    const lo = rings[k], hi = rings[k + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      out.triV(lo[i], lo[j], hi[j]);
      out.triV(lo[i], hi[j], hi[i]);
    }
  }
  for (let i = 1; i < seg - 1; i++) out.triV(last[0], last[i], last[i + 1]); // faces +axis
}

/** Closed UV sphere (fills the bend where the tilted tip leaves the vertical pillar). */
function addSphere(out: SoupBuilder, c: Vec3, r: number, seg: number, rows: number): void {
  const ring = (k: number): Vec3[] => {
    const phi = (k / rows) * Math.PI; // 0 = top
    const rr = r * Math.sin(phi), z = c[2] + r * Math.cos(phi);
    const pts: Vec3[] = [];
    for (let i = 0; i < seg; i++) {
      // half a step out of phase with the lathe rings so no vertex ever coincides with them
      const t = ((i + 0.5) / seg) * Math.PI * 2;
      pts.push([c[0] + rr * Math.cos(t), c[1] + rr * Math.sin(t), z]);
    }
    return pts;
  };
  const top: Vec3 = [c[0], c[1], c[2] + r], bottom: Vec3 = [c[0], c[1], c[2] - r];
  const rings: Vec3[][] = [];
  for (let k = 1; k < rows; k++) rings.push(ring(k));
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    out.triV(top, rings[0][i], rings[0][j]);
  }
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k], b = rings[k + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      out.triV(a[i], b[i], b[j]);
      out.triV(a[i], b[j], a[j]);
    }
  }
  const lastRing = rings[rings.length - 1];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    out.triV(bottom, lastRing[j], lastRing[i]);
  }
}

/**
 * One support for a contact point on the underside: a flared foot and vertical
 * pillar, a joint sphere, and a tip that runs along the underside's normal
 * (so the contact is a small round spot, not an oblique ellipse): a cone from
 * the pillar down to `tipDiameter`, a short neck of that diameter, entering the
 * surface by `penetration`. With tipAlign 'vertical' the whole thing is vertical.
 */
function addSupport(out: SoupBuilder, contact: Vec3, normal: Vec3, opts: PresupportOptions): SupportPost {
  const seg = Math.max(6, Math.round(opts.segments));
  const rows = Math.max(3, Math.round(seg / 2));
  const m: Vec3 = opts.tipAlign === 'vertical' ? [0, 0, -1] : normal; // points out of the body
  const into: Vec3 = [-m[0], -m[1], -m[2]];
  const L = opts.tipLength + opts.neckLength;
  const J: Vec3 = [contact[0] + m[0] * L, contact[1] + m[1] * L, contact[2] + m[2] * L]; // pillar top / tip start
  const height = J[2];
  const rPillar = pillarRadius(height, opts);
  const rTip = opts.tipDiameter / 2;
  const rFoot = Math.max(opts.footDiameter / 2, rPillar);
  const zFoot = Math.min(opts.footHeight, height * 0.25);
  // foot + pillar, vertical
  addLathe(out, [[J[0], J[1], 0], [J[0], J[1], zFoot], [J[0], J[1], height]], [rFoot, rPillar, rPillar], [0, 0, 1], seg);
  // joint: a hair bigger than the pillar so its equator never shares the pillar's top ring
  addSphere(out, J, rPillar * 1.02, seg, rows);
  // cone + neck along the normal, ending inside the body; the cone starts a little
  // inside the pillar (overlap, not a butt joint, whose rings would weld together)
  const back = rPillar * 0.15;
  const J2: Vec3 = [J[0] + into[0] * back, J[1] + into[1] * back, J[2] + into[2] * back];
  const N: Vec3 = [contact[0] + m[0] * opts.neckLength, contact[1] + m[1] * opts.neckLength, contact[2] + m[2] * opts.neckLength];
  const E: Vec3 = [contact[0] + into[0] * opts.penetration, contact[1] + into[1] * opts.penetration, contact[2] + into[2] * opts.penetration];
  addLathe(out, [J2, N, E], [rPillar, rTip, rTip], into, seg);
  // ball on the contact: the support breaks at the neck and leaves a small dome, not a crater
  if (opts.contactBall > 0) addSphere(out, contact, opts.contactBall / 2, seg, rows);
  return { x: J[0], y: J[1], top: height };
}

/** A closed cylinder between two points (bracing strut); overlaps the pillars it joins. */
function addStrut(out: SoupBuilder, a: Vec3, b: Vec3, radius: number, seg: number, onPlate = false): void {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  const n: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  // any vector not parallel to n
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u0: Vec3 = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]];
  const ul = Math.hypot(u0[0], u0[1], u0[2]);
  const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const ring = (c: Vec3): Vec3[] => {
    const pts: Vec3[] = [];
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const cu = Math.cos(t) * radius, sv = Math.sin(t) * radius;
      const z = c[2] + u[2] * cu + v[2] * sv;
      pts.push([c[0] + u[0] * cu + v[0] * sv, c[1] + u[1] * cu + v[1] * sv, onPlate ? Math.max(0, z) : z]);
    }
    return pts;
  };
  const ra = ring(a), rb = ring(b);
  // cap at a faces -n, cap at b faces +n, band CCW from outside
  for (let i = 1; i < seg - 1; i++) out.triV(ra[0], ra[i + 1], ra[i]);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    out.triV(ra[i], ra[j], rb[j]);
    out.triV(ra[i], rb[j], rb[i]);
  }
  for (let i = 1; i < seg - 1; i++) out.triV(rb[0], rb[i], rb[i + 1]);
}

export interface BraceLink {
  a: number;
  b: number;
  /** heights of the horizontal bars, mm */
  levels: number[];
}

/**
 * Which pillars get tied together and at what heights. Each pillar links to its
 * nearest neighbours (up to 4) within `braceMaxLink`; bars sit every
 * `braceInterval` mm from the foot up to just under the shorter pillar's tip.
 * Only pillars at least `braceMinHeight` tall take part.
 */
export function braceLinks(tips: Vec3[], opts: PresupportOptions): BraceLink[] {
  const links: BraceLink[] = [];
  if (opts.bracing === 'off' || tips.length < 2) return links;
  const maxLink = opts.braceMaxLink > 0 ? opts.braceMaxLink : Math.max(opts.edgeSpacing, opts.spacing) * 1.6;
  const cell = maxLink;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  tips.forEach((t, i) => {
    const k = key(t[0], t[1]);
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  });
  const seen = new Set<string>();
  for (let i = 0; i < tips.length; i++) {
    const a = tips[i];
    if (a[2] < opts.braceMinHeight) continue;
    const cx = Math.floor(a[0] / cell), cy = Math.floor(a[1] / cell);
    const cand: { j: number; d: number }[] = [];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j === i) continue;
          const b = tips[j];
          if (b[2] < opts.braceMinHeight) continue;
          const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (d <= maxLink && d > 1e-6) cand.push({ j, d });
        }
      }
    }
    cand.sort((p, q) => p.d - q.d);
    // nearest neighbours, but never two in (nearly) the same direction: a strut to
    // the farther one would run through the nearer pillar and duplicate its end cap
    const chosen: { j: number; ang: number }[] = [];
    for (const { j } of cand) {
      const ang = Math.atan2(tips[j][1] - a[1], tips[j][0] - a[0]);
      if (chosen.some((c) => Math.abs(Math.atan2(Math.sin(ang - c.ang), Math.cos(ang - c.ang))) < Math.PI / 6)) continue;
      chosen.push({ j, ang });
      if (chosen.length >= 4) break;
    }
    for (const { j } of chosen) {
      const id = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const top = Math.min(a[2], tips[j][2]) - 1;
      const levels: number[] = [];
      if (opts.bracing === 'full') {
        for (let z = opts.footHeight + opts.braceInterval; z < top; z += opts.braceInterval) levels.push(z);
      } else if (opts.bracing === 'light') {
        const z = Math.min(a[2], tips[j][2]) * 0.5;
        if (z > opts.footHeight + 1 && z < top) levels.push(z);
      }
      if (levels.length > 0) links.push({ a: i, b: j, levels });
    }
  }
  return links;
}

function pillarRadius(height: number, opts: PresupportOptions): number {
  return Math.max(opts.pillarDiameter / 2, 0.006 * height);
}

function addBracing(out: SoupBuilder, tips: Vec3[], links: BraceLink[], opts: PresupportOptions): number {
  let struts = 0;
  const r = opts.braceDiameter / 2;
  const seg = Math.max(6, Math.round(opts.segments / 2));
  // Struts start and end just inside the pillar wall rather than on its axis:
  // two struts leaving one pillar in opposite directions would otherwise share
  // bit-identical end caps and weld into a non-manifold edge.
  const strut = (P: Vec3, Q: Vec3, rp: number, rq: number) => {
    const dx = Q[0] - P[0], dy = Q[1] - P[1], dz = Q[2] - P[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < rp + rq + 0.2) return;
    const n: Vec3 = [dx / len, dy / len, dz / len];
    addStrut(out, [P[0] + n[0] * rp * 0.5, P[1] + n[1] * rp * 0.5, P[2] + n[2] * rp * 0.5], [Q[0] - n[0] * rq * 0.5, Q[1] - n[1] * rq * 0.5, Q[2] - n[2] * rq * 0.5], r, seg);
    struts++;
  };
  for (const l of links) {
    const A = tips[l.a], B = tips[l.b];
    const ra = pillarRadius(A[2], opts), rb = pillarRadius(B[2], opts);
    for (let k = 0; k < l.levels.length; k++) {
      const z = l.levels[k];
      strut([A[0], A[1], z], [B[0], B[1], z], ra, rb);
      if (opts.bracing === 'full' && k + 1 < l.levels.length) {
        const z2 = l.levels[k + 1];
        // zig-zag: alternate the diagonal's direction bay by bay
        if (k % 2 === 0) strut([A[0], A[1], z], [B[0], B[1], z2], ra, rb);
        else strut([B[0], B[1], z], [A[0], A[1], z2], rb, ra);
      }
    }
  }
  return struts;
}

/** Fuse consecutive edge-ring feet with a low bar lying on the plate. */
function addRail(out: SoupBuilder, feet: Vec3[], opts: PresupportOptions): number {
  if (opts.bracing === 'off' || feet.length < 2) return 0;
  const r = opts.railDiameter / 2;
  let n = 0;
  for (let i = 0; i < feet.length; i++) {
    const a = feet[i], b = feet[(i + 1) % feet.length];
    if (feet.length === 2 && i === 1) break;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > opts.edgeSpacing * 2.2 || d < 2 * r) continue;
    // ends sit just inside each foot, never on its axis: two rails meeting at one
    // foot along a straight edge would otherwise share bit-identical end caps
    const nx = (b[0] - a[0]) / d, ny = (b[1] - a[1]) / d, o = r * 0.5;
    addStrut(out, [a[0] + nx * o, a[1] + ny * o, r], [b[0] - nx * o, b[1] - ny * o, r], r, 8, true);
    n++;
  }
  return n;
}

export function presupport(input: PresupportInput, options: Partial<PresupportOptions> = {}): PresupportResult {
  const opts: PresupportOptions = { ...DEFAULT_PRESUPPORT, ...options };
  const warnings: string[] = [];
  const tiltDeg = Math.max(0, Math.min(80, opts.tiltDeg));

  const b = polygonBounds(input.bottom);
  const w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
  // tilt about the long axis so the short side climbs: lowest print, shortest supports
  const axis: 'x' | 'y' = w >= d ? 'x' : 'y';
  const fr = makeFrame(axis, tiltDeg);

  const minZ = Math.min(minZAfter(input.body, fr.rot), input.sculpt.triCount > 0 ? minZAfter(input.sculpt, fr.rot) : Infinity);
  const lift = opts.standoff - minZ;
  const body = rotateSoup(input.body, fr.rot, lift);
  const sculpt = rotateSoup(input.sculpt, fr.rot, lift);

  const layout = supportLayout(input.bottom, input.slots, opts, input.underside);
  const toPrint = ([x, y]: Vec2, z: number): Vec3 => {
    const p = fr.rot([x, y, z]);
    return [p[0], p[1], p[2] + lift];
  };
  const ringContacts = layout.ring.map((c) => toPrint(c, 0));
  const contacts: Vec3[] = [...ringContacts, ...layout.grid.map((c) => toPrint(c, layout.gridZ))];
  const normal = fr.rot([0, 0, -1]);
  const out = new SoupBuilder(Math.max(256, contacts.length * 300));
  const posts = contacts.map((c) => addSupport(out, c, normal, opts));
  const tops: Vec3[] = posts.map((p) => [p.x, p.y, p.top]);
  const struts = addBracing(out, tops, braceLinks(tops, opts), opts);
  const rails = addRail(out, posts.slice(0, ringContacts.length).map((p) => [p.x, p.y, 0]), opts);
  const supports = out.buildCopy();

  const bb = boundsOfSoup(body);
  const bs = sculpt.triCount > 0 ? boundsOfSoup(sculpt) : bb;
  const bounds: Bounds3 = {
    min: [Math.min(bb.min[0], bs.min[0]), Math.min(bb.min[1], bs.min[1]), 0],
    max: [Math.max(bb.max[0], bs.max[0]), Math.max(bb.max[1], bs.max[1]), Math.max(bb.max[2], bs.max[2])],
  };
  if (contacts.length === 0) warnings.push('no room for supports under this base');
  return { body, sculpt, supports, contacts, normal, tiltDeg, axis, height: bounds.max[2], bounds, supportCount: contacts.length, strutCount: struts, railCount: rails, warnings };
}

/** Rough print height for the UI before anything is generated, mm. */
export function estimatePrintHeight(size: { w: number; d: number }, partHeight: number, tiltDeg: number, standoff: number): number {
  const t = (tiltDeg * Math.PI) / 180;
  return Math.min(size.w, size.d) * Math.sin(t) + partHeight * Math.cos(t) + standoff;
}
