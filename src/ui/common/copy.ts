/**
 * Plain-language formatting helpers shared by the side panels. Builds on
 * `src/ui/util/format.ts` (owned by the viewport/cutter side of the app) —
 * this file only adds phrasing that's specific to the panel rewrite.
 */
import type { Shape, Vec2 } from '@/kernel/types';
import type { MagnetPreset } from '@/model/presets';
import { formatMm } from '@/ui/util/format';

/** "100 × 150 mm" */
export function formatWD(w: number, d: number, decimals = 2): string {
  return `${formatMm(w, decimals)} × ${formatMm(d, decimals)} mm`;
}

/** "rectangle" / "square" / "oval" / "round", for use after a size like "100 × 150 mm". */
export function shapeNoun(shape: Shape): string {
  const squareish = Math.abs(shape.w - shape.d) < 0.01;
  if (shape.kind === 'rect') return squareish ? 'square' : 'rectangle';
  return squareish ? 'round' : 'oval';
}

/** "1.95 million triangles" / "12k triangles" / "788 triangles" */
export function formatTriangleCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} million triangles`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString()}k triangles`;
  return `${n.toLocaleString()} triangle${n === 1 ? '' : 's'}`;
}

/** "420 ms" / "1.3 s" */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Body volume, always in cm³ (piece panel measurements are small numbers where mm³ isn't useful). */
export function formatCm3(mm3: number): string {
  if (!Number.isFinite(mm3)) return '—';
  return `${(mm3 / 1000).toFixed(2)} cm³`;
}

/**
 * "12.5 mm right, 50 mm back from the parent's centre" — xy is the piece's
 * cutter centre in the parent's local frame (+x right, +y back, matching the
 * rect edge order front/right/back/left).
 */
export function positionPhrase(xy: Vec2): string {
  const [x, y] = xy;
  const parts: string[] = [];
  if (Math.abs(x) > 0.005) parts.push(`${formatMm(Math.abs(x))} mm ${x > 0 ? 'right' : 'left'}`);
  if (Math.abs(y) > 0.005) parts.push(`${formatMm(Math.abs(y))} mm ${y > 0 ? 'back' : 'forward'}`);
  if (parts.length === 0) return "at the parent's centre";
  return `${parts.join(', ')} from the parent's centre`;
}

/** "3 × 2 mm (3 mm across, 2 mm thick)" */
export function magnetPresetLabel(p: MagnetPreset): string {
  return `${p.dia} × ${p.thick} mm (${p.dia} mm across, ${p.thick} mm thick)`;
}

/** How far the sides of the plate lean inward from bottom to top, in mm. */
export function edgeSlopeMm(topScaleX: number, nominalW: number): number {
  return (1 - topScaleX) * (nominalW / 2);
}
