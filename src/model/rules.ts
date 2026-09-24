/**
 * What may be placed where, per work mode. Pulled out of the store so it can be
 * unit tested: the tree is never deeper than frame -> base, and each mode allows
 * a different shape of tree.
 *
 *  - Single base: one base, straight on the scene.
 *  - Diorama: any number of bases straight on the scene; leftovers at Base-ify.
 *  - Multibase: a unit frame on the scene, bases inside the frame.
 *  - Movement tray: the same as Multibase, plus a tray per frame at Base-ify; or, with no
 *    frame at all, bases straight on the scene and the WHOLE scene becomes the tray.
 */
import type { PieceRole, WorkMode } from './types';

export interface PlacementTarget {
  /** the piece the new item would go on */
  parentIsRoot: boolean;
  parentRole: PieceRole;
  /** how many items the parent already holds */
  siblingCount: number;
  /** on the scene: how many unit frames and how many bases straight on it (movement tray mode needs to know) */
  rootFrames?: number;
  rootBases?: number;
}

/** Plain-English reason the placement is refused, or null when it is allowed. */
export function placementError(mode: WorkMode, role: PieceRole, target: PlacementTarget): string | null {
  const { parentIsRoot, parentRole, siblingCount } = target;
  if (!parentIsRoot && parentRole !== 'frame') return 'Bases cannot be cut from another base. Select the big base or a frame first.';
  if (role === 'frame' && !parentIsRoot) return 'A frame can only be placed on the big base.';
  if (role === 'tray') return 'Movement trays are made for you when you press Base-ify.';
  if (mode === 'single') {
    if (role !== 'base' || !parentIsRoot) return 'Single base mode: place one base on the scene.';
    if (siblingCount > 0) return `Single base mode holds one base and ${siblingCount} ${siblingCount === 1 ? 'is' : 'are'} already placed. Delete ${siblingCount === 1 ? 'it' : 'them'} first, or switch to Diorama mode to keep several.`;
  }
  if (mode === 'diorama' && (role === 'frame' || !parentIsRoot)) return 'Diorama mode: place bases straight on the big base; frames are for Multibase mode.';
  if (mode === 'tray' && parentIsRoot) {
    // either unit frames (a tray per frame) or bases straight on the scene (the whole scene is the tray), never both
    if (role === 'base' && (target.rootFrames ?? 0) > 0) return 'Movement tray mode: this scene has a unit frame, so bases go inside it. Delete the frame to make the whole scene the tray instead.';
    if (role === 'frame' && (target.rootBases ?? 0) > 0) return 'Movement tray mode: bases are already placed straight on the scene, so the whole scene is the tray. Delete them to use a unit frame instead.';
  }
  if (mode === 'multibase' && role === 'base' && parentIsRoot) return 'Multibase mode: place a unit frame first, then put bases inside it.';
  return null;
}

/** Modes that use a unit frame holding bases. */
export function usesFrames(mode: WorkMode): boolean {
  return mode === 'multibase' || mode === 'tray';
}
