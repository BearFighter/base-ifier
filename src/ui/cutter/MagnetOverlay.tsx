/**
 * Magnet slot editor drawn over the underside (or top) view of the selected piece.
 */
import { useEffect, useRef, useState } from 'react';
import type { Vec2 } from '@/kernel/types';
import type { MagnetSlot, Piece, Project } from '@/model/types';
import { newId } from '@/model/defaults';
import { minEdgeDistance } from '@/kernel/geom2d/polygon';
import { mmToPx, pxToMm, type ViewMapping } from '@/viewport/mapping';
import type { PieceGeometryTransfer } from '@/worker/api';

export interface MagnetOverlayProps {
  mapping: ViewMapping;
  project: Project;
  piece: Piece;
  /** the piece's plate outline (never the whole geometry: typed arrays must not be props) */
  outline: PieceGeometryTransfer['outline'];
  onCommit(slots: MagnetSlot[]): void;
}

export function MagnetOverlay({ mapping, project, piece, outline, onCommit }: MagnetOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [local, setLocal] = useState<MagnetSlot[]>(piece.magnets.slots);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; pointerId: number; offset: Vec2 } | null>(null);
  useEffect(() => { setLocal(piece.magnets.slots); }, [piece.magnets.slots]);

  const m = project.magnet;
  const radiusOf = (s: MagnetSlot) => (s.dia ?? m.dia) / 2 + m.radialTol;
  const top = outline.top;
  const toMm = (e: { clientX: number; clientY: number }): Vec2 => {
    const el = svgRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    return pxToMm(mapping, e.clientX - r.left, e.clientY - r.top);
  };

  const onPointerDown = (e: React.PointerEvent, s: MagnetSlot) => {
    e.stopPropagation(); e.preventDefault();
    setSelected(s.id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toMm(e);
    setDrag({ id: s.id, pointerId: e.pointerId, offset: [s.xy[0] - p[0], s.xy[1] - p[1]] });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toMm(e);
    const xy: Vec2 = [r2(p[0] + drag.offset[0]), r2(p[1] + drag.offset[1])];
    setLocal((ls) => ls.map((s) => (s.id === drag.id ? { ...s, xy } : s)));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    try { (e.currentTarget as Element).releasePointerCapture(drag.pointerId); } catch { /* ignore */ }
    setDrag(null);
    onCommit(local);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toMm(e);
    const s: MagnetSlot = { id: newId('mg'), xy: [r2(p[0]), r2(p[1])] };
    const next = [...local, s];
    setLocal(next); setSelected(s.id); onCommit(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !(e.target instanceof HTMLInputElement)) {
        const next = local.filter((s) => s.id !== selected);
        setLocal(next); setSelected(null); onCommit(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, local, onCommit]);

  const topPath = top.map((p, i) => { const q = mmToPx(mapping, p[0], p[1]); return `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`; }).join(' ') + ' Z';

  return (
    <svg
      ref={svgRef}
      width={mapping.width}
      height={mapping.height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', overflow: 'visible' }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      onPointerDown={() => setSelected(null)}
    >
      <path d={topPath} fill="none" stroke="rgba(255,209,102,0.5)" strokeWidth={1} strokeDasharray="4 3" />
      {local.map((s) => {
        const r = radiusOf(s);
        const c = mmToPx(mapping, s.xy[0], s.xy[1]);
        const rpx = r * mapping.pxPerMm;
        const wall = minEdgeDistance(top, s.xy[0], s.xy[1]) - r;
        const bad = wall < m.minWall - 1e-9;
        const stroke = bad ? '#ff6b6b' : s.id === selected ? '#ffd166' : '#7cc4ff';
        return (
          <g key={s.id} style={{ cursor: 'move' }} onPointerDown={(e) => onPointerDown(e, s)}>
            <circle cx={c[0]} cy={c[1]} r={rpx} fill={bad ? 'rgba(255,107,107,0.2)' : 'rgba(124,196,255,0.2)'} stroke={stroke} strokeWidth={2} />
            <circle cx={c[0]} cy={c[1]} r={Math.max(2, rpx * 0.15)} fill={stroke} />
            <text x={c[0]} y={c[1] - rpx - 4} textAnchor="middle" fontSize={10} fill={stroke} style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {`${s.dia ?? m.dia}×${s.thick ?? m.thick} @ ${s.xy[0]}, ${s.xy[1]}`}
            </text>
            {s.id === selected && (
              <g
                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onClick={(e) => { e.stopPropagation(); const next = local.filter((x) => x.id !== s.id); setLocal(next); setSelected(null); onCommit(next); }}
                style={{ cursor: 'pointer' }}
              >
                <title>Remove this magnet</title>
                <circle cx={c[0] + rpx + 10} cy={c[1] - rpx} r={8} fill="rgba(30,30,36,0.95)" stroke="rgba(255,120,120,0.9)" strokeWidth={1} />
                <text x={c[0] + rpx + 10} y={c[1] - rpx + 4} textAnchor="middle" fontSize={12} fill="rgba(255,140,140,0.95)" style={{ pointerEvents: 'none', userSelect: 'none' }}>×</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
