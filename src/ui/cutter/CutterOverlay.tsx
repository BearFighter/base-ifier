/**
 * Drawn ON the top-down view of the big base: every base (nested), selectable and
 * draggable. In the Underside view it becomes the magnet editor for the selected
 * base. Mounted inside #viewport-overlay.
 */
import { useEffect } from 'react';
import { useAppStore } from '@/state/project';
import { useViewMapping } from '@/viewport/mapping';
import { BaseOutlines } from './BaseOutlines';
import { MagnetOverlay } from './MagnetOverlay';
import { useBases } from './useBases';
import type { Rect } from './snap';
import './cutter.css';

export function CutterOverlay() {
  const mapping = useViewMapping();
  const B = useBases();
  const project = useAppStore((s) => s.project);

  // Delete key removes the selected base (never the big base)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && B.selected && B.selected.parentId !== null && B.mode === 'top') {
        e.preventDefault();
        B.requestDeletePiece(B.selected.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [B]);

  if (!B.selected || !(mapping.valid && mapping.width > 0)) return null;

  if (B.mode === 'underside') {
    const data = B.selectedGeom?.status === 'ready' ? B.selectedGeom.data : undefined;
    if (!data) return null;
    const piece = B.selected;
    return (
      <MagnetOverlay
        mapping={mapping}
        project={project}
        piece={piece}
        outline={data.outline}
        onCommit={(slots) => B.setPieceMagnets(piece.id, { mode: 'manual', slots })}
      />
    );
  }

  if (B.mode !== 'top') return null;

  const onCommit = (id: string, rect: Rect) => {
    const box = B.boxes.find((b) => b.id === id);
    if (!box) return;
    const p = box.parentRect;
    const xy: [number, number] = [rect.x + rect.w / 2 - (p.x + p.w / 2), rect.y + rect.h / 2 - (p.y + p.h / 2)];
    B.updatePiece(id, { xy: [r2(xy[0]), r2(xy[1])], shape: { ...box.piece.shape, w: r2(rect.w), d: r2(rect.h) } });
  };

  // Movement tray mode, before the tray exists: show where its rim will reach
  const trayRims = B.workMode === 'tray'
    ? B.boxes
        .filter((b) => b.piece.role === 'frame' && !B.boxes.some((t) => t.piece.role === 'tray' && t.piece.trayOf === b.id))
        .map((b) => {
          const edge = { ...project.tray, ...(b.piece.tray ?? {}) }.edge;
          return { x: b.rect.x - edge, y: b.rect.y - edge, w: b.rect.w + 2 * edge, h: b.rect.h + 2 * edge };
        })
    : undefined;

  return <BaseOutlines mapping={mapping} boxes={B.boxes} selectedId={B.selectedId} onSelect={B.selectPiece} onCommit={onCommit} trayRims={trayRims} />;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
