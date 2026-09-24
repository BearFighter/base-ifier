/**
 * Pure derivations the store applies when you press Base-ify. Kept out of
 * project.ts so they can be unit tested without a worker.
 */
import { PROFILE_FLAT } from '@/kernel/types';
import type { Shape, Vec2 } from '@/kernel/types';
import { defaultEdges, newId } from '@/model/defaults';
import { pieceSize } from '@/model/tree';
import type { Piece, Project } from '@/model/types';
import { traySettingsFor } from './chain';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A frame's tray outline: the frame grown by the rim on every side. */
export function trayShapeFor(project: Project, frame: Piece): Shape {
  // the whole scene as the tray: exactly the scene, no rim beyond it
  if (frame.parentId === null) return { ...frame.shape };
  const t = traySettingsFor(project, frame);
  const size = pieceSize(frame);
  return { kind: frame.shape.kind, w: r2(size.w + 2 * t.edge), d: r2(size.d + 2 * t.edge) };
}

/**
 * One movement tray per frame on the scene; with no frame and bases straight on the
 * scene, one tray that IS the whole scene (a slot per base, no rim beyond the scene).
 *
 * The tray is a child of the SCENE, not of the frame: `computePiece` clips a child
 * to its parent's usable area, and the tray's rim has to be able to reach past the
 * frame (which is also what lets it carry real scenery). Its magnets are 'manual'
 * and empty so nothing tries to auto-place magnets on it — its holes come from the
 * bases in its frame.
 */
export function trayPiecesFor(project: Project, rootId: string): Piece[] {
  const root = project.pieces[rootId];
  if (!root) return [];
  const out: Piece[] = [];
  const onRoot = root.children.map((cid) => project.pieces[cid]).filter((p): p is Piece => !!p);
  // no unit frame, but bases straight on the scene: the whole scene is the tray
  if (!onRoot.some((p) => p.role === 'frame') && onRoot.some((p) => (p.role ?? 'base') === 'base')) {
    const shape = trayShapeFor(project, root);
    return [{
      id: newId('pc'),
      sourceId: root.sourceId,
      parentId: rootId,
      name: `${root.name} tray`,
      shape,
      xy: [0, 0] as Vec2,
      rotDeg: 0,
      edges: defaultEdges(shape),
      profile: PROFILE_FLAT,
      role: 'tray',
      trayOf: root.id,
      magnets: { mode: 'manual', slots: [] },
      children: [],
    }];
  }
  for (const cid of root.children) {
    const frame = project.pieces[cid];
    if (!frame || frame.role !== 'frame') continue;
    const shape = trayShapeFor(project, frame);
    out.push({
      id: newId('pc'),
      sourceId: frame.sourceId,
      parentId: rootId,
      name: `${frame.name} tray`,
      shape,
      xy: [frame.xy[0], frame.xy[1]] as Vec2,
      rotDeg: 0,
      edges: defaultEdges(shape),
      profile: PROFILE_FLAT,
      role: 'tray',
      trayOf: frame.id,
      magnets: { mode: 'manual', slots: [] },
      children: [],
    });
  }
  return out;
}
