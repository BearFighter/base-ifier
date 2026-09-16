/**
 * Pure helpers over the Project piece tree. None of these mutate their
 * inputs — each returns a new Project/array. The app store applies these
 * through immer, but they stay pure so they can be unit tested and reused
 * outside the store.
 */

import type { Vec2 } from '@/kernel/types';
import type { Piece, Project } from './types';

/** Register `piece` and link it into its parent's `children` (if any). */
export function addPiece(project: Project, piece: Piece): Project {
  const pieces = { ...project.pieces, [piece.id]: piece };
  if (piece.parentId !== null) {
    const parent = pieces[piece.parentId];
    if (parent) {
      pieces[piece.parentId] = { ...parent, children: [...parent.children, piece.id] };
    }
  }
  return { ...project, pieces };
}

/** Remove `id` and every descendant, unlinking it from its parent's children. */
export function removeSubtree(project: Project, id: string): Project {
  const toRemove = new Set<string>([id, ...descendants(project, id)]);
  const pieces: Record<string, Piece> = {};
  for (const [pid, piece] of Object.entries(project.pieces)) {
    if (toRemove.has(pid)) continue;
    pieces[pid] = piece;
  }
  const removed = project.pieces[id];
  if (removed && removed.parentId !== null && pieces[removed.parentId]) {
    const parent = pieces[removed.parentId];
    pieces[removed.parentId] = { ...parent, children: parent.children.filter((c) => c !== id) };
  }
  const selectedId = project.selectedId !== null && toRemove.has(project.selectedId) ? null : project.selectedId;
  return { ...project, pieces, selectedId };
}

/** Ancestor chain of `id`, root first. Does not include `id` itself. */
export function ancestors(project: Project, id: string): Piece[] {
  const chain: Piece[] = [];
  let current = project.pieces[id];
  while (current && current.parentId !== null) {
    const parent: Piece | undefined = project.pieces[current.parentId];
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain.reverse();
}

/** All descendant piece ids of `id` (not including `id` itself). */
export function descendants(project: Project, id: string): string[] {
  const out: string[] = [];
  const stack = [...(project.pieces[id]?.children ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    out.push(next);
    const piece = project.pieces[next];
    if (piece) stack.push(...piece.children);
  }
  return out;
}

/** Every piece of `sourceId` with no children. */
export function leaves(project: Project, sourceId: string): Piece[] {
  return Object.values(project.pieces).filter((p) => p.sourceId === sourceId && p.children.length === 0);
}

/** Depth of `id` in its tree; the source's root piece is depth 0. */
export function pieceDepth(project: Project, id: string): number {
  return ancestors(project, id).length;
}

/** Other pieces sharing the same parent as `id` (not including `id`). */
export function siblings(project: Project, id: string): Piece[] {
  const piece = project.pieces[id];
  if (!piece) return [];
  return Object.values(project.pieces).filter((p) => p.id !== id && p.parentId === piece.parentId);
}

export function renamePiece(project: Project, id: string, name: string): Project {
  return updatePiece(project, id, { name });
}

export function updatePiece(project: Project, id: string, patch: Partial<Piece>): Project {
  const piece = project.pieces[id];
  if (!piece) return project;
  return { ...project, pieces: { ...project.pieces, [id]: { ...piece, ...patch } } };
}

/**
 * Origin of piece `id` in its source's coordinate frame: the sum of `xy`
 * across the piece and all its ancestors, since every frame shares the
 * source axes and each piece's origin is its own cutter centre.
 */
export function pieceOriginInSource(project: Project, id: string): Vec2 {
  const piece = project.pieces[id];
  if (!piece) return [0, 0];
  let x = piece.xy[0];
  let y = piece.xy[1];
  for (const ancestor of ancestors(project, id)) {
    x += ancestor.xy[0];
    y += ancestor.xy[1];
  }
  return [x, y];
}

/** Footprint size of a piece, accounting for a 90/270 degree rotation. */
export function pieceSize(piece: Piece): { w: number; d: number } {
  const { w, d } = piece.shape;
  const norm = ((piece.rotDeg % 360) + 360) % 360;
  return norm === 90 || norm === 270 ? { w: d, d: w } : { w, d };
}
