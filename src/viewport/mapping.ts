/**
 * Mapping between the top-down orthographic view and the viewport's CSS pixels,
 * published by the viewport every frame so 2D overlays (cutter frames, magnet
 * handles) can be drawn in an SVG layer on top of the canvas.
 *
 * Coordinates: mm in the SELECTED piece's local frame (x right, y up, as seen
 * from above; from below, x is mirrored so the underside view reads correctly).
 */
import { create } from 'zustand';

export interface ViewMapping {
  /** viewport size in CSS px */
  width: number;
  height: number;
  /** CSS px per mm */
  pxPerMm: number;
  /** px coordinates of the local origin (0,0) */
  originPx: [number, number];
  /** true when looking at the underside (x mirrored) */
  mirrored: boolean;
  /** true only in 'top' / 'underside' modes where overlays are valid */
  valid: boolean;
}

export interface ViewMappingStore extends ViewMapping {
  set(m: Partial<ViewMapping>): void;
}

export const useViewMapping = create<ViewMappingStore>((set) => ({
  width: 0,
  height: 0,
  pxPerMm: 4,
  originPx: [0, 0],
  mirrored: false,
  valid: false,
  set: (m) => set(m),
}));

export function mmToPx(m: ViewMapping, x: number, y: number): [number, number] {
  const sx = m.mirrored ? -1 : 1;
  return [m.originPx[0] + sx * x * m.pxPerMm, m.originPx[1] - y * m.pxPerMm];
}

export function pxToMm(m: ViewMapping, px: number, py: number): [number, number] {
  const sx = m.mirrored ? -1 : 1;
  return [(sx * (px - m.originPx[0])) / m.pxPerMm, (m.originPx[1] - py) / m.pxPerMm];
}

// Dev aid: inspect the mapping from the browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __viewMapping?: unknown }).__viewMapping = useViewMapping;
}
