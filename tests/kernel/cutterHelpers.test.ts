import { describe, it, expect } from 'vitest';
import { snapLines, snapMove, snapEdge, clampRectToContainer, rectsOverlap, draftRect, footprintsOverlap } from '@/ui/cutter/snap';
import { fillRemainder, gridDrafts, placeNew, occupiedRects } from '@/ui/cutter/layout';

describe('snapping', () => {
  const container = { w: 125, d: 50 };
  it('snaps a rect edge to the container edge and centre', () => {
    const lines = snapLines(container, []);
    const r = { x: -62.2, y: -10, w: 25, h: 25 };
    const s = snapMove(r, lines, 1);
    expect(s.x).toBeCloseTo(-62.5, 6);
    expect(s.snappedX).toBe(-62.5);
    expect(s.y).toBeCloseTo(-10, 6);
    expect(snapEdge(24.7, lines.xs, 1)).toBe(24.7);
    expect(snapEdge(62.3, lines.xs, 1)).toBe(62.5);
  });
  it('snaps to sibling edges', () => {
    const lines = snapLines(container, [{ x: -62.5, y: -25, w: 25, h: 25 }]);
    const s = snapMove({ x: -37.9, y: -25, w: 25, h: 25 }, lines, 1);
    expect(s.x).toBeCloseTo(-37.5, 6);
  });
  it('clamps and detects overlaps', () => {
    expect(clampRectToContainer({ x: 60, y: 0, w: 25, h: 10 }, container).x).toBeCloseTo(37.5, 6);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 0, w: 10, h: 10 })).toBe(true);
  });
});

describe('grid and leftover helpers', () => {
  const container = { w: 125, d: 50 };
  it('builds the 5 x 25 front rank and finds the remaining 125 x 25 strip', () => {
    const front = gridDrafts(container, 5, 1, 25, 25);
    expect(front.length).toBe(5);
    expect(front[0].xy).toEqual([-50, -12.5]);
    expect(front[4].xy).toEqual([50, -12.5]);
    const strip = fillRemainder(container, occupiedRects(front));
    expect(strip).not.toBeNull();
    expect(strip!.shape).toEqual({ kind: 'rect', w: 125, d: 25 });
    expect(strip!.xy).toEqual([0, 12.5]);
  });
  it('places a new size into free space', () => {
    const front = gridDrafts(container, 5, 1, 25, 25);
    const d = placeNew({ kind: 'rect', w: 50, d: 25 }, container, occupiedRects(front));
    const r = draftRect(d);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.x).toBeCloseTo(-62.5, 6);
  });
});

describe('footprintsOverlap: round and oval bases are tested by their own outline', () => {
  const round = (cx: number, cy: number, d: number) => ({ rect: { x: cx - d / 2, y: cy - d / 2, w: d, h: d }, kind: 'ellipse' as const });
  const oval = (cx: number, cy: number, w: number, h: number) => ({ rect: { x: cx - w / 2, y: cy - h / 2, w, h }, kind: 'ellipse' as const });
  const box = (cx: number, cy: number, w: number, h: number) => ({ rect: { x: cx - w / 2, y: cy - h / 2, w, h }, kind: 'rect' as const });

  it('two rounds overlap only when the circles do, not their squares', () => {
    // diagonal neighbours: squares overlap by 4 mm each way, circles are 1.4 mm apart
    expect(footprintsOverlap(round(0, 0, 32), round(28, 28, 32))).toBe(false);
    expect(footprintsOverlap(round(0, 0, 32), round(20, 20, 32))).toBe(true);
    // touching exactly is fine
    expect(footprintsOverlap(round(0, 0, 32), round(32, 0, 32))).toBe(false);
    expect(footprintsOverlap(round(0, 0, 32), round(31.5, 0, 32))).toBe(true);
  });

  it('a round next to a square corner, and ovals end to end', () => {
    // circle tucked into the corner of a square: bounding boxes overlap, shapes do not
    expect(footprintsOverlap(box(0, 0, 25, 25), round(24, 24, 25))).toBe(false);
    expect(footprintsOverlap(box(0, 0, 25, 25), round(20, 0, 25))).toBe(true);
    expect(footprintsOverlap(oval(0, 0, 60, 35), oval(50, 28, 60, 35))).toBe(false);
    expect(footprintsOverlap(oval(0, 0, 60, 35), oval(40, 10, 60, 35))).toBe(true);
  });

  it('rectangles behave exactly as before', () => {
    expect(footprintsOverlap(box(0, 0, 25, 25), box(20, 0, 25, 25))).toBe(true);
    expect(footprintsOverlap(box(0, 0, 25, 25), box(25, 0, 25, 25))).toBe(false);
  });
});
