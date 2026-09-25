/**
 * Draws every base of the loaded file on the top-down view, nested, and lets you
 * click to select, drag to move and drag the corners to resize. Changes are
 * committed when you let go; the cut is recomputed in the background.
 */
import { useRef, useState } from 'react';
import type { Vec2 } from '@/kernel/types';
import { mmToPx, pxToMm, type ViewMapping } from '@/viewport/mapping';
import { clampRectToContainer, footprintsOverlap, round, snapEdge, snapLines, snapMove, type Rect } from './snap';
import type { BaseBox } from './useBases';

export interface BaseOutlinesProps {
  mapping: ViewMapping;
  boxes: BaseBox[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** commit a move/resize; rect is in big-base coordinates */
  onCommit(id: string, rect: Rect): void;
  minSize?: number;
  /** Movement tray mode, before Base-ify: where each frame's tray will reach */
  trayRims?: Rect[];
}

type HandleName = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: HandleName[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

interface DragState {
  id: string;
  kind: 'move' | HandleName;
  startMm: Vec2;
  startRect: Rect;
  rect: Rect;
  pointerId: number;
  moved: boolean;
}

/** Siblings that share the parent, ignoring the tray (which lies over everything by design). */
function siblingsOf(boxes: BaseBox[], box: BaseBox): BaseBox[] {
  return boxes.filter((b) => b.piece.parentId === box.piece.parentId && b.id !== box.id && b.piece.role !== 'tray');
}

export function BaseOutlines({ mapping, boxes, selectedId, onSelect, onCommit, minSize = 5, trayRims }: BaseOutlinesProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const tolMm = 6 / mapping.pxPerMm;

  const toMm = (e: { clientX: number; clientY: number }): Vec2 => {
    const el = svgRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    return pxToMm(mapping, e.clientX - r.left, e.clientY - r.top);
  };

  const begin = (e: React.PointerEvent, box: BaseBox, kind: DragState['kind']) => {
    if (box.depth === 0 || box.piece.role === 'tray') return; // the big base and the tray are not dragged
    e.stopPropagation();
    e.preventDefault();
    onSelect(box.id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: box.id, kind, startMm: toMm(e), startRect: box.rect, rect: box.rect, pointerId: e.pointerId, moved: false });
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const box = boxes.find((b) => b.id === drag.id);
    if (!box) return;
    const cur = toMm(e);
    const dx = cur[0] - drag.startMm[0], dy = cur[1] - drag.startMm[1];
    const parent = box.parentRect;
    const container = { w: parent.w, d: parent.h };
    const toLocal = (r: Rect): Rect => ({ x: r.x - (parent.x + parent.w / 2), y: r.y - (parent.y + parent.h / 2), w: r.w, h: r.h });
    const toRoot = (r: Rect): Rect => ({ x: r.x + parent.x + parent.w / 2, y: r.y + parent.y + parent.h / 2, w: r.w, h: r.h });
    const siblings = siblingsOf(boxes, box).map((b) => toLocal(b.rect));
    const lines = snapLines(container, siblings);
    const noSnap = e.altKey;
    let r = toLocal({ ...drag.startRect });
    if (drag.kind === 'move') {
      r = { ...r, x: r.x + dx, y: r.y + dy };
      if (!noSnap) {
        const s = snapMove(r, lines, tolMm);
        r = { ...r, x: s.x, y: s.y };
        setGuides({ x: s.snappedX === null ? null : s.snappedX + parent.x + parent.w / 2, y: s.snappedY === null ? null : s.snappedY + parent.y + parent.h / 2 });
      } else setGuides({ x: null, y: null });
      r = clampRectToContainer(r, container);
    } else {
      let x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
      const k = drag.kind;
      if (k.includes('w')) x0 += dx;
      if (k.includes('e')) x1 += dx;
      if (k.includes('s')) y0 += dy;
      if (k.includes('n')) y1 += dy;
      if (!noSnap) {
        if (k.includes('w')) x0 = snapEdge(x0, lines.xs, tolMm);
        if (k.includes('e')) x1 = snapEdge(x1, lines.xs, tolMm);
        if (k.includes('s')) y0 = snapEdge(y0, lines.ys, tolMm);
        if (k.includes('n')) y1 = snapEdge(y1, lines.ys, tolMm);
      }
      const hw = container.w / 2, hd = container.d / 2;
      x0 = Math.max(-hw, x0); x1 = Math.min(hw, x1); y0 = Math.max(-hd, y0); y1 = Math.min(hd, y1);
      if (x1 - x0 < minSize) { if (k.includes('w')) x0 = x1 - minSize; else x1 = x0 + minSize; }
      if (y1 - y0 < minSize) { if (k.includes('s')) y0 = y1 - minSize; else y1 = y0 + minSize; }
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      setGuides({ x: null, y: null });
    }
    const rr = toRoot({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) });
    setDrag({ ...drag, rect: rr, moved: true });
  };

  const end = (e: React.PointerEvent) => {
    if (!drag) return;
    try { (e.currentTarget as Element).releasePointerCapture(drag.pointerId); } catch { /* ignore */ }
    const d = drag;
    setDrag(null);
    setGuides({ x: null, y: null });
    if (d.moved) onCommit(d.id, d.rect);
  };

  const px = (x: number, y: number) => mmToPx(mapping, x, y);
  // the tray is drawn before the frame and the bases it holds, so it never covers them
  const ordered = [...boxes].sort((a, b) => a.depth - b.depth || (a.piece.role === 'tray' ? -1 : 0) - (b.piece.role === 'tray' ? -1 : 0));

  return (
    <svg
      ref={svgRef}
      className="cutter-svg"
      width={mapping.width}
      height={mapping.height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {guides.x !== null && <line x1={px(guides.x, 0)[0]} x2={px(guides.x, 0)[0]} y1={0} y2={mapping.height} stroke="#ffb347" strokeWidth={1} />}
      {guides.y !== null && <line y1={px(0, guides.y)[1]} y2={px(0, guides.y)[1]} x1={0} x2={mapping.width} stroke="#ffb347" strokeWidth={1} />}
      {(trayRims ?? []).map((r, i) => {
        const rp = rectToPx(mapping, r);
        return <rect key={`rim${i}`} {...rp} fill="none" stroke="rgba(198,160,72,0.75)" strokeWidth={1.5} strokeDasharray="12 4" style={{ pointerEvents: 'none' }} />;
      })}
      {ordered.map((box) => {
        const isRoot = box.depth === 0;
        const rect = drag && drag.id === box.id ? drag.rect : box.rect;
        const rp = rectToPx(mapping, rect);
        const selected = box.id === selectedId;
        const isTray = box.piece.role === 'tray';
        const kindOf = (b: BaseBox) => (b.piece.shape.kind === 'ellipse' ? 'ellipse' : 'rect') as 'rect' | 'ellipse';
        const overlaps = !isRoot && !isTray && siblingsOf(boxes, box).some((s) => footprintsOverlap({ rect: s.rect, kind: kindOf(s) }, { rect, kind: kindOf(box) }));
        const hasKids = box.piece.children.length > 0;
        const isFrame = box.piece.role === 'frame';
        const isLeftover = box.piece.role === 'leftover';
        const stroke = isRoot ? 'rgba(120,180,255,0.45)' : overlaps ? '#ff6b6b' : selected ? '#ffd166' : isTray ? 'rgba(198,160,72,0.9)' : isFrame ? 'rgba(255,255,255,0.85)' : isLeftover ? 'rgba(200,200,120,0.8)' : hasKids ? 'rgba(140,230,160,0.9)' : '#7cc4ff';
        const fill = isRoot || isTray ? 'none' : selected ? 'rgba(255,209,102,0.16)' : isFrame ? 'rgba(255,255,255,0.03)' : isLeftover ? 'rgba(200,200,120,0.08)' : 'rgba(124,196,255,0.10)';
        const label = `${isFrame ? 'Frame: ' : ''}${box.piece.name} · ${fmt(rect.w)} × ${fmt(rect.h)}`;
        const showLabel = rp.width > 40 && rp.height > 16;
        return (
          <g key={box.id} style={{ pointerEvents: isRoot || isTray ? 'none' : 'auto' }}>
            <title>{isRoot || isTray ? box.piece.name : `${label} — click to select, drag to move, drag a corner to resize`}</title>
            {box.piece.shape.kind === 'rect' || isRoot ? (
              <rect {...rp} fill={fill} stroke={stroke} strokeWidth={selected ? 2 : isFrame || isTray ? 2 : 1.5} strokeDasharray={isRoot ? '4 3' : isTray ? '12 4' : isFrame ? '8 4' : undefined} style={{ cursor: isRoot || isTray ? 'default' : 'move' }} onPointerDown={(e) => begin(e, box, 'move')} />
            ) : (
              <ellipse cx={rp.x + rp.width / 2} cy={rp.y + rp.height / 2} rx={rp.width / 2} ry={rp.height / 2} fill={fill} stroke={stroke} strokeWidth={selected ? 2 : 1.5} strokeDasharray={isTray ? '12 4' : undefined} style={{ cursor: isTray ? 'default' : 'move' }} onPointerDown={(e) => begin(e, box, 'move')} />
            )}
            {!isRoot && showLabel && (
              <text x={rp.x + 5} y={rp.y + 13} fill={stroke} fontSize={11} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {label}
              </text>
            )}
            {selected && !isRoot && !isTray && HANDLES.map((h) => {
              const [hx, hy] = handlePos(rp, h, mapping.mirrored);
              return (
                <rect key={h} x={hx - 4} y={hy - 4} width={8} height={8} fill="#ffd166" stroke="#222" strokeWidth={1} style={{ cursor: cursorFor(h, mapping.mirrored) }} onPointerDown={(e) => begin(e, box, h)} />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function rectToPx(m: ViewMapping, r: Rect): { x: number; y: number; width: number; height: number } {
  const a = mmToPx(m, r.x, r.y), b = mmToPx(m, r.x + r.w, r.y + r.h);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
}

function handlePos(rp: { x: number; y: number; width: number; height: number }, h: HandleName, mirrored: boolean): [number, number] {
  const cx = rp.x + rp.width / 2, cy = rp.y + rp.height / 2;
  const left = rp.x, right = rp.x + rp.width, top = rp.y, bottom = rp.y + rp.height;
  const ePx = mirrored ? left : right, wPx = mirrored ? right : left;
  switch (h) {
    case 'n': return [cx, top];
    case 's': return [cx, bottom];
    case 'e': return [ePx, cy];
    case 'w': return [wPx, cy];
    case 'ne': return [ePx, top];
    case 'nw': return [wPx, top];
    case 'se': return [ePx, bottom];
    case 'sw': return [wPx, bottom];
  }
}

function cursorFor(h: HandleName, mirrored: boolean): string {
  const flip = (s: string) => (mirrored ? s.replace('e', 'X').replace('w', 'e').replace('X', 'w') : s);
  const k = flip(h);
  if (k === 'n' || k === 's') return 'ns-resize';
  if (k === 'e' || k === 'w') return 'ew-resize';
  if (k === 'ne' || k === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
