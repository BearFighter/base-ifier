/** Formatting helpers for millimetre quantities shown in the UI. */
import type { Bounds3 } from '@/kernel/types';

/** Rounds to `decimals` places and drops trailing zeros (e.g. 40, 32.5). */
export function formatMm(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(decimals));
  return rounded.toString();
}

export function formatSize(w: number, d: number, decimals = 2): string {
  return `${formatMm(w, decimals)} x ${formatMm(d, decimals)}`;
}

export function formatVolume(mm3: number): string {
  if (!Number.isFinite(mm3)) return '—';
  const abs = Math.abs(mm3);
  if (abs >= 1000) return `${(mm3 / 1000).toFixed(2)} cm³`;
  return `${mm3.toFixed(1)} mm³`;
}

export function formatBoundsSize(b: Bounds3): string {
  const w = b.max[0] - b.min[0];
  const d = b.max[1] - b.min[1];
  const h = b.max[2] - b.min[2];
  return `${formatMm(w)} × ${formatMm(d)} × ${formatMm(h)} mm`;
}

export function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
