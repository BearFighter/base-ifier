/**
 * Pure helpers that translate Project data into the plain-data requests the
 * worker API expects. No worker/store imports here — these stay unit
 * testable against a hand-built Project.
 */
import { ancestors } from '@/model/tree';
import { PROFILE_GW } from '@/kernel/types';
import type { Piece, Project } from '@/model/types';
import type { MagnetRequest, PieceChainNode, PieceGeometryTransfer, SizingRequest, SourceSummary, PresupportRequest, UndersideRequest, SocketRequest } from '@/worker/api';

/** Ancestor chain of `pieceId`, root first, ending with the piece itself. */
export function chainFor(project: Project, pieceId: string): PieceChainNode[] {
  const piece = project.pieces[pieceId];
  if (!piece) return [];
  const chain = [...ancestors(project, pieceId), piece];
  const plug = project.plug ?? { depth: 4, clearance: 0.2 };
  return chain.map((p) => ({
    id: p.id,
    shape: p.shape,
    xy: p.xy,
    rotDeg: p.rotDeg,
    edges: p.edges,
    profile: p.parentId === null ? undefined : (p.profile ?? project.defaultProfile ?? PROFILE_GW),
    role: p.role ?? 'base',
    cut: p.cut ?? 'full',
    plugDepth: p.plugDepth ?? plug.depth,
    plugClearance: p.plugClearance ?? plug.clearance,
    sockets: socketsFor(project, p),
  }));
}

/** Plug bases (siblings) whose footprint lies inside a leftover piece: the leftover keeps their sockets. */
function socketsFor(project: Project, piece: Piece): SocketRequest[] | undefined {
  if (piece.role !== 'leftover' || piece.parentId === null) return undefined;
  const parent = project.pieces[piece.parentId];
  if (!parent) return undefined;
  const plug = project.plug ?? { depth: 4, clearance: 0.2 };
  // an object scene has ONE remainder (the object itself) that keeps every base's pocket or hole;
  // a plate scene has rectangular leftovers that only keep the plugs inside them
  const objectScene = project.sources[piece.sourceId]?.normalization.mode === 'generic';
  const mine = rectOf(piece);
  const tol = objectScene ? 1 : 1e-6;
  const out: SocketRequest[] = [];
  for (const cid of parent.children) {
    const c = project.pieces[cid];
    if (!c || c.id === piece.id || c.role === 'frame' || c.role === 'leftover') continue;
    const isPlug = c.cut === 'plug';
    if (!objectScene && !isPlug) continue;
    const r = rectOf(c);
    const clearance = isPlug ? (c.plugClearance ?? plug.clearance) : 0;
    if (r.x0 - clearance >= mine.x0 - tol && r.x1 + clearance <= mine.x1 + tol && r.y0 - clearance >= mine.y0 - tol && r.y1 + clearance <= mine.y1 + tol) {
      out.push({ shape: c.shape, xy: c.xy, rotDeg: c.rotDeg, plugDepth: c.plugDepth ?? plug.depth, clearance, plug: isPlug });
    }
  }
  return out.length ? out : undefined;
}

function rectOf(p: Piece): { x0: number; y0: number; x1: number; y1: number } {
  const w = p.shape.w, d = p.shape.d;
  return { x0: p.xy[0] - w / 2, y0: p.xy[1] - d / 2, x1: p.xy[0] + w / 2, y1: p.xy[1] + d / 2 };
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
