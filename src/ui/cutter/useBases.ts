/**
 * One mental model for the UI: the loaded file is the big base; in Multibase
 * mode a "frame" (unit footprint) sits on it and bases sit inside the frame; in
 * the other modes bases sit straight on the big base. Never deeper.
 * This hook derives each item's rectangle in BIG BASE coordinates (what the
 * top-down view draws) and the area inside it where children may go.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/state/project';
import { pieceOriginInSource, pieceSize } from '@/model/tree';
import type { Piece, Project } from '@/model/types';
import { USABLE_INSET } from '@/kernel/pipeline/computePiece';
import type { Rect } from './snap';

export interface BaseBox {
  id: string;
  piece: Piece;
  /** footprint in big-base coordinates (mm, centre origin) */
  rect: Rect;
  /** where children may be placed: a frame's whole footprint; a base's plate top minus a safety margin */
  usable: Rect;
  depth: number;
  /** the parent's usable rect: the area this item must stay inside */
  parentRect: Rect;
}

/**
 * How far each side of an item's plate top sits inside its footprint, per axis
 * [x, y]. Must match the kernel: the scene's own top outline is scaled per axis
 * (OPR: 92.4%), 'original' profiles copy that proportionally, 'inset' profiles
 * lean in by a fixed amount, frames do not lean in at all.
 */
export function insetOf(piece: Piece, project: Project): [number, number] {
  if (piece.role === 'frame') return [0, 0];
  const src = project.sources[piece.sourceId];
  const sx = src ? src.normalization.topScale[0] : 0.92, sy = src ? src.normalization.topScale[1] : 0.92;
  const { w, d } = pieceSize(piece);
  const p = piece.parentId === null ? { kind: 'original' as const } : (piece.profile ?? project.defaultProfile ?? { kind: 'original' as const });
  if (p.kind === 'inset') return [p.inset, p.inset];
  return [((1 - sx) * w) / 2, ((1 - sy) * d) / 2];
}

export function useBases() {
  const selectedId = useAppStore((s) => s.project.selectedId);
  const pieces = useAppStore((s) => s.project.pieces);
  const sources = useAppStore((s) => s.project.sources);
  const showHelp = useAppStore((s) => s.view.showHelp);
  const mode = useAppStore((s) => s.view.mode);
  const workMode = useAppStore((s) => s.project.mode);
  const defaultProfile = useAppStore((s) => s.project.defaultProfile);
  const baseified = useAppStore((s) => s.baseified);
  const selected = selectedId ? pieces[selectedId] : undefined;
  // With nothing selected, still show the (first) loaded scene rather than an empty work area.
  const source = selected ? sources[selected.sourceId] : Object.values(sources)[0];
  const rootId = source?.rootPieceId ?? null;
  const root = rootId ? pieces[rootId] : undefined;
  const rootGeom = useAppStore((s) => (rootId ? s.geometry[rootId] : undefined));
  const selectedGeom = useAppStore((s) => (selectedId ? s.geometry[selectedId] : undefined));
  const busy = useAppStore((s) => s.busy);
  const actions = useAppStore(
    useShallow((s) => ({
      addPiece: s.addPiece,
      addPieces: s.addPieces,
      updatePiece: s.updatePiece,
      selectPiece: s.selectPiece,
      requestDeletePiece: s.requestDeletePiece,
      setPieceMagnets: s.setPieceMagnets,
      setView: s.setView,
      setDefaultProfile: s.setDefaultProfile,
      setMode: s.setMode,
    })),
  );

  const project = useAppStore((s) => s.project);
  const boxes = useMemo<BaseBox[]>(() => {
    if (!root) return [];
    const out: BaseBox[] = [];
    const rootSize = pieceSize(root);
    const rootRect: Rect = { x: -rootSize.w / 2, y: -rootSize.d / 2, w: rootSize.w, h: rootSize.d };
    // Round the inset UP to 0.01 mm so the drawn usable area is never larger than
    // the kernel's (placements are rounded to 0.01 mm and must not get clipped).
    const shrink = (r: Rect, by: [number, number]): Rect => {
      const bx = Math.ceil(by[0] * 100 - 1e-6) / 100, byy = Math.ceil(by[1] * 100 - 1e-6) / 100;
      const w = Math.max(0, r.w - 2 * bx), h = Math.max(0, r.h - 2 * byy);
      return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
    };
    const walk = (p: Piece, depth: number, parentRect: Rect) => {
      const { w, d } = pieceSize(p);
      const c = pieceOriginInSource(project, p.id);
      const rect: Rect = p.parentId === null ? rootRect : { x: c[0] - w / 2, y: c[1] - d / 2, w, h: d };
      const ins = insetOf(p, project);
      const usable = p.role === 'frame' ? rect : shrink(rect, [ins[0] + USABLE_INSET, ins[1] + USABLE_INSET]);
      out.push({ id: p.id, piece: p, rect, usable, depth, parentRect });
      for (const cid of p.children) {
        const child = pieces[cid];
        if (child) walk(child, depth + 1, usable);
      }
    };
    walk(root, 0, rootRect);
    return out;
  }, [root, pieces, project]);

  const rootSize = root ? pieceSize(root) : null;
  const selectedSize = selected ? pieceSize(selected) : null;
  const selectedBox = selectedId ? boxes.find((b) => b.id === selectedId) : undefined;

  return { selectedId, selected, selectedSize, selectedBox, root, rootId, rootSize, rootGeom, selectedGeom, boxes, showHelp, mode, workMode, defaultProfile, baseified, busy, pieces, ...actions };
}
