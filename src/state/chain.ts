/**
 * Pure helpers that translate Project data into the plain-data requests the
 * worker API expects. No worker/store imports here — these stay unit
 * testable against a hand-built Project.
 */
import { ancestors } from '@/model/tree';
import { PROFILE_GW } from '@/kernel/types';
import type { Piece, Project } from '@/model/types';
import type { MagnetRequest, PieceChainNode, PieceGeometryTransfer, SizingRequest, SourceSummary, PresupportRequest, UndersideRequest } from '@/worker/api';

/** Ancestor chain of `pieceId`, root first, ending with the piece itself. */
export function chainFor(project: Project, pieceId: string): PieceChainNode[] {
  const piece = project.pieces[pieceId];
  if (!piece) return [];
  const chain = [...ancestors(project, pieceId), piece];
  return chain.map((p) => ({ id: p.id, shape: p.shape, xy: p.xy, rotDeg: p.rotDeg, edges: p.edges, profile: p.parentId === null ? undefined : (p.profile ?? project.defaultProfile ?? PROFILE_GW), role: p.role ?? 'base' }));
}

/** Builds the worker's MagnetRequest for a piece, or undefined if it has no slots. */
export function magnetRequestFor(
  project: Project,
  piece: Piece,
  geometry?: PieceGeometryTransfer,
): MagnetRequest | undefined {
  void geometry;
  if (piece.magnets.slots.length === 0) return undefined;
  const m = project.magnet;
  return {
    slots: piece.magnets.slots.map((s) => ({ x: s.xy[0], y: s.xy[1], dia: s.dia, thick: s.thick })),
    sizing: { dia: m.dia, thick: m.thick, radialTol: m.radialTol, depthTol: m.depthTol, sides: m.sides },
    check: { floorMin: m.floorMin, minWall: m.minWall },
  };
}

/** Hollow-underside request, or undefined for a solid plate. */
export function undersideRequestFor(project: Project): UndersideRequest | undefined {
  const u = project.underside;
  if (!u || !u.hollow) return undefined;
  return { depth: u.voidDepth, rim: u.rimWidth, ringHeight: u.ringHeight, ringWidth: u.ringWidth, watermark: u.watermark ?? '', watermarkHeight: u.watermarkHeight };
}

/** Print-ready export request, or undefined when exports stay plain. */
export function presupportRequestFor(project: Project): PresupportRequest | undefined {
  const p = project.export.presupport;
  if (!p || !p.enabled) return undefined;
  return { tiltDeg: p.tiltDeg, standoff: p.standoff, tipDiameter: p.tipDiameter, density: p.density ?? 'medium', bracing: p.bracing ?? 'light' };
}

/** Builds the worker's SizingRequest from the project's export sizing policy. */
export function sizingRequestFor(project: Project, source: SourceSummary | null): SizingRequest {
  switch (project.export.sizing) {
    case 'source':
      return { scale: source?.measuredScale ?? 1 };
    case 'nominal':
      return { scale: 1 };
    case 'clearance':
      return { scale: 1, clearance: project.export.clearanceMm };
  }
}
