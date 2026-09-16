import { describe, it, expect } from 'vitest';
import { buildBody } from '@/kernel/body/buildBody';
import { magnetSlotSpecs } from '@/kernel/body/magnetSlots';
import { rectPolygon, ellipsePolygon } from '@/kernel/geom2d/shapes';
import { scalePolygonAbout, pointInConvexPolygon, minEdgeDistance } from '@/kernel/geom2d/polygon';
import { isWatertight } from '@/kernel/mesh/validate';
import { boundsOfSoup } from '@/kernel/mesh/bbox';
import { readStl } from '@/kernel/stl/read';
import { prepareSource } from '@/kernel/source/prepareSource';
import { computePiece, sourceFrame, rootPieceParams } from '@/kernel/pipeline/computePiece';
import { presupport, supportContacts, supportLayout, braceLinks, densitySpacing, autoTiltDeg, estimatePrintHeight, supportTriangles, DEFAULT_PRESUPPORT } from '@/kernel/pipeline/presupport';
import { pieceToStl } from '@/kernel/pipeline/exportPiece';
import { syntheticSculpt, loadOprSoup } from '../fixtures/synthetic';
import type { EdgeTreatment, MagnetSlotSpec, Soup, Vec3 } from '@/kernel/types';

const PLATE = 2.984;
const sizing = { dia: 3, thick: 2, radialTol: 0.1, depthTol: 0.1, sides: 24 };

function rectPiece(w: number, d: number, slots: { x: number; y: number }[] = []) {
  const bottom = rectPolygon(w, d);
  const top = scalePolygonAbout(bottom, 0.9237, 0.9237, 0, 0);
  const specs: MagnetSlotSpec[] = magnetSlotSpecs(sizing, slots);
  const { soup: body } = buildBody({ bottom, top, plateTop: PLATE }, specs);
  const sculpt = syntheticSculpt(w, d, PLATE);
  return { body, sculpt, bottom, slots: specs };
}

/** Undo the tilt/lift of a result to get back to the piece's local frame. */
function toLocal(res: ReturnType<typeof presupport>, p: Vec3, standoff: number, bottomHalfExtent: number): Vec3 {
  const t = (res.tiltDeg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  // lift = standoff - minZ, and the lowest point of the underside is the far edge of the short axis
  const lift = standoff + bottomHalfExtent * s;
  const [x, y, z0] = p;
  const z = z0 - lift;
  return res.axis === 'x' ? [x, y * c + z * s, -y * s + z * c] : [x * c - z * s, y, x * s + z * c];
}

function minZ(soup: Soup): number {
  return boundsOfSoup(soup).min[2];
}

describe('presupport', () => {
  it('tilts about the long axis, lifts to the standoff and stands the supports on the plate', () => {
    const piece = rectPiece(50, 25, [{ x: 0, y: 0 }]);
    const res = presupport(piece);
    expect(res.axis).toBe('x'); // the 25 mm side climbs
    expect(res.tiltDeg).toBe(45);
    expect(minZ(res.body)).toBeCloseTo(DEFAULT_PRESUPPORT.standoff, 3);
    expect(minZ(res.supports)).toBeCloseTo(0, 6);
    expect(res.supportCount).toBeGreaterThan(25);
    expect(res.supportCount).toBeLessThan(150);
    expect(res.height).toBeGreaterThan(20);
    expect(res.height).toBeLessThan(35);
    expect(res.warnings).toEqual([]);
    // rough estimate used by the UI is in the right ballpark
    const est = estimatePrintHeight({ w: 50, d: 25 }, PLATE + 1, 45, 6);
    expect(Math.abs(est - res.height)).toBeLessThan(4);
  });

  it('puts every contact on the underside, inside the footprint and clear of the magnet recess', () => {
    const piece = rectPiece(50, 25, [{ x: 10, y: 0 }]);
    const res = presupport(piece);
    for (const c of res.contacts) {
      const l = toLocal(res, c, DEFAULT_PRESUPPORT.standoff, 12.5);
      expect(Math.abs(l[2])).toBeLessThan(1e-3); // on the z = 0 plane
      expect(pointInConvexPolygon(piece.bottom, l[0], l[1])).toBe(true);
      expect(minEdgeDistance(piece.bottom, l[0], l[1])).toBeGreaterThan(DEFAULT_PRESUPPORT.edgeInset - 1e-6);
      const dist = Math.hypot(l[0] - 10, l[1] - 0);
      expect(dist).toBeGreaterThan(piece.slots[0].radius + DEFAULT_PRESUPPORT.slotClearance - 1e-6);
    }
    // the tips enter along the underside's normal and end inside the plate, straight above the contact
    expect(Math.hypot(res.normal[0], res.normal[1], res.normal[2])).toBeCloseTo(1, 9);
    expect(res.normal[2]).toBeLessThan(0);
    for (const c of res.contacts) {
      const pen = DEFAULT_PRESUPPORT.penetration;
      const tip: Vec3 = [c[0] - res.normal[0] * pen, c[1] - res.normal[1] * pen, c[2] - res.normal[2] * pen];
      const l = toLocal(res, tip, DEFAULT_PRESUPPORT.standoff, 12.5);
      expect(l[2]).toBeCloseTo(pen, 6);
      const lc = toLocal(res, c, DEFAULT_PRESUPPORT.standoff, 12.5);
      expect(Math.hypot(l[0] - lc[0], l[1] - lc[1])).toBeLessThan(1e-6);
    }
  });

  it('generates closed support shells and a three-shell STL', () => {
    const piece = rectPiece(25, 25);
    const res = presupport(piece, { bracing: 'off' });
    expect(res.strutCount).toBe(0);
    expect(res.railCount).toBe(0);
    expect(isWatertight(res.supports)).toBe(true);
    expect(res.supports.triCount).toBe(res.supportCount * supportTriangles(DEFAULT_PRESUPPORT));
    const stl = pieceToStl({ name: 'test', body: res.body, sculpt: res.sculpt, supports: res.supports });
    const back = readStl(stl);
    expect(back.triCount).toBe(res.body.triCount + res.sculpt.triCount + res.supports.triCount);
    // with the rail and bracing everything is still closed
    const braced = presupport(piece);
    expect(braced.railCount).toBeGreaterThan(0);
    expect(isWatertight(braced.supports)).toBe(true);
  });

  it('relaxes density from the edge to the middle and with base size', () => {
    const heavy = { ...DEFAULT_PRESUPPORT, edgeSpacing: 1.5, spacing: 3 };
    const piece = rectPiece(100, 50);
    const a = supportContacts(piece.bottom, [], heavy);
    const b = supportContacts(piece.bottom, [], heavy);
    expect(a).toEqual(b);
    const layout = supportLayout(piece.bottom, [], heavy);
    expect(a.length).toBe(layout.ring.length + layout.grid.length);
    const perimeter = 2 * (98 + 48);
    expect(layout.ring.length).toBeGreaterThan((perimeter / heavy.edgeSpacing) * 0.8);
    const interiorArea = (100 - 2 * 3.25) * (50 - 2 * 3.25);
    const cellArea = heavy.spacing * heavy.spacing * 0.866;
    expect(layout.grid.length).toBeLessThan((interiorArea / cellArea) * 1.2);
    expect(layout.grid.length).toBeGreaterThan((interiorArea / cellArea) * 0.5);

    expect(densitySpacing(25, 'medium')).toEqual({ edgeSpacing: 2.5, spacing: 5 });
    expect(densitySpacing(150, 'light')).toEqual({ edgeSpacing: 6, spacing: 12 });
    expect(densitySpacing(60, 'heavy')).toEqual({ edgeSpacing: 2, spacing: 4.5 });
    const mid = rectPiece(60, 40);
    const counts = (['light', 'medium', 'heavy'] as const).map((d) => presupport(mid, densitySpacing(60, d)).supportCount);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });

  it('braces tall pillars to their neighbours and leaves short ones alone', () => {
    const light = presupport(rectPiece(100, 50));
    expect(light.strutCount).toBeGreaterThan(0);
    expect(light.railCount).toBeGreaterThan(0);
    expect(isWatertight(light.supports)).toBe(true);
    // pillar tops sit below the contacts, down the normal by the cone + neck length
    const L = DEFAULT_PRESUPPORT.tipLength + DEFAULT_PRESUPPORT.neckLength;
    const tips: Vec3[] = light.contacts.map((c) => [c[0] + light.normal[0] * L, c[1] + light.normal[1] * L, c[2] + light.normal[2] * L]);
    const links = braceLinks(tips, DEFAULT_PRESUPPORT);
    expect(links.length).toBeGreaterThan(0);
    const maxLink = Math.max(DEFAULT_PRESUPPORT.edgeSpacing, DEFAULT_PRESUPPORT.spacing) * 1.6;
    for (const l of links) {
      const a = tips[l.a], b = tips[l.b];
      expect(a[2]).toBeGreaterThanOrEqual(DEFAULT_PRESUPPORT.braceMinHeight);
      expect(b[2]).toBeGreaterThanOrEqual(DEFAULT_PRESUPPORT.braceMinHeight);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThanOrEqual(maxLink);
      expect(l.levels.length).toBe(1); // light: one ring of bars at mid height
      expect(l.levels[0]).toBeCloseTo(Math.min(a[2], b[2]) * 0.5, 6);
    }
    const full = presupport(rectPiece(100, 50), { bracing: 'full' });
    expect(full.strutCount).toBeGreaterThan(light.strutCount);
    expect(isWatertight(full.supports)).toBe(true);
    const off = presupport(rectPiece(100, 50), { bracing: 'off' });
    expect(off.strutCount).toBe(0);
    expect(off.railCount).toBe(0);
    // a flat print sits 6 mm up: nothing is tall enough to brace, but the rail still fuses the edge feet
    const flat = presupport(rectPiece(100, 50), { tiltDeg: 0 });
    expect(flat.strutCount).toBe(0);
    expect(flat.railCount).toBeGreaterThan(0);
    expect(minZ(flat.supports)).toBeCloseTo(0, 6);
  });

  it('handles flat (0°) and round bases', () => {
    const flat = presupport(rectPiece(25, 25), { tiltDeg: 0 });
    expect(minZ(flat.body)).toBeCloseTo(6, 3);
    for (const c of flat.contacts) expect(c[2]).toBeCloseTo(6, 3);
    expect(flat.height).toBeCloseTo(6 + boundsOfSoup(rectPiece(25, 25).sculpt).max[2], 2);

    const bottom = ellipsePolygon(25, 25, 64);
    const top = scalePolygonAbout(bottom, 0.921, 0.921, 0, 0);
    const { soup: body } = buildBody({ bottom, top, plateTop: PLATE }, []);
    const round = presupport({ body, sculpt: syntheticSculpt(22, 22, PLATE), bottom, slots: [] }, { tiltDeg: autoTiltDeg({ kind: 'ellipse', w: 25, d: 25 }) });
    expect(round.tiltDeg).toBe(35);
    expect(round.supportCount).toBeGreaterThan(15);
    expect(isWatertight(round.supports)).toBe(true);
    for (const c of round.contacts) {
      const l = toLocal(round, c, 6, 12.5);
      expect(pointInConvexPolygon(bottom, l[0], l[1])).toBe(true);
    }
    expect(autoTiltDeg({ kind: 'rect', w: 100, d: 150 })).toBe(55);
    expect(autoTiltDeg({ kind: 'rect', w: 25, d: 50 })).toBe(45);
  });

  it('supports a base cut from the real 25 mm OPR file (skips when the set is absent)', () => {
    const soup = loadOprSoup('S_Base_Square_25mm_1.stl');
    if (!soup) return;
    const src = prepareSource(soup, 'S_Base_Square_25mm_1.stl');
    const root = computePiece(sourceFrame(src), rootPieceParams(src), { source: src });
    const edges: EdgeTreatment[] = [{ kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }, { kind: 'bevel' }];
    const child = computePiece(root.frame, { shape: { kind: 'rect', w: 20, d: 20 }, xy: [0, 0], rotDeg: 0, edges, profile: { kind: 'inset', inset: 0.7, height: 3 } }, { source: src, magnetSlots: magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]) });
    const sculpt = child.sculptMesh ? { positions: new Float32Array(0), triCount: 0 } : child.sculpt;
    const res = presupport({ body: child.body, sculpt, bottom: child.outline.bottom, slots: magnetSlotSpecs(sizing, [{ x: 0, y: 0 }]) });
    expect(res.warnings).toEqual([]);
    expect(isWatertight(res.supports)).toBe(true);
    expect(minZ(res.body)).toBeCloseTo(6, 3);
    expect(res.supportCount).toBeGreaterThan(15);
  });
});
