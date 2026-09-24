/**
 * The bits of movement tray UI that appear in more than one place: the wording of
 * every setting, and the two callouts that offer a one-click fix (a thicker floor
 * for a wide sheet of bare floor, and a thicker floor for magnets that would
 * otherwise go right through).
 */
import React from 'react';
import { suggestedTrayFloor } from '@/model/defaults';
import type { TrayInfo } from '@/worker/api';

/** One help line per setting. Plain English, no jargon; "frame" is the one allowed term. */
export const TRAY_HELP = {
  intro: 'Every base you put in the frame leaves a slot in the tray it drops into. The material between and around the slots stays, so the tray and the bases look like one scene.',
  floor: 'How thick the flat sheet under the whole tray is. Thin trays can curl as the resin cures, so go thicker on big trays — 1 mm is fine up to about a hand’s width.',
  gap: 'Extra room in each slot so a printed base drops in without forcing it. 0.2 mm suits resin, 0.3 mm for FDM.',
  edge: 'How far the tray sticks out past the bases, so there is always an edge to pick it up by. It is also what stiffens the tray, so do not go below 2 mm on a big one. With no frame, it is the wall kept between the bases and the edge of the scene.',
  magnets: 'Puts a magnet hole in the tray floor under every base, lined up with the base’s own magnet. If the floor is thinner than the magnets, the whole tray is made deep enough for them, so nothing pokes through and the bases still sit flush. Check which way round the magnets go before gluing.',
  spacing: 'Leaves a gap between bases when you fill the frame. A small gap gives the tray a raised wall between each base — it looks more like a real tray and stops a big thin floor from curling.',
  profile: 'Bases keep the edge shape you picked. Slots are sized from the bottom of the base, so any edge shape drops in; a sloped edge leaves a small groove around the base in the tray.',
};

/**
 * "This tray has 125 mm of unbroken floor" — shown only when a thicker floor is
 * actually advisable, never applied on its own. The bands are a house rule
 * (docs/research/flat-underside.md gives no figure in mm), so the wording says so.
 */
export function TrayFloorCallout({ tray, floor, onSetFloor }: { tray: TrayInfo | undefined; floor: number; onSetFloor: (v: number) => void }) {
  if (!tray) return null;
  const span = Math.max(tray.thinSpan.w, tray.thinSpan.d);
  const want = suggestedTrayFloor(span, floor);
  if (!want) return null;
  return (
    <div className="callout tray-callout">
      This tray has {Math.round(span)} mm of floor with nothing across it. A sheet that wide and only {floor} mm thick tends to curl as it cures.
      <div>
        <button type="button" className="primary" onClick={() => onSetFloor(want)}>Make the floor {want} mm</button>
      </div>
      Or leave a small gap between the bases, so the tray keeps a raised wall between them.
    </div>
  );
}

/** When the magnets need more floor than was asked for, the tray is simply made that deep; say so. */
export function TrayMagnetCallout({ tray }: { tray: TrayInfo | undefined; onSetFloor?: (v: number) => void }) {
  if (!tray || tray.magnetMode === 'none' || tray.floor <= tray.floorAsked + 1e-6) return null;
  return (
    <div className="callout tray-callout">
      The floor is {tray.floor.toFixed(1)} mm here rather than {tray.floorAsked.toFixed(1)}: the magnets need that much to sit fully inside it. The surround rises with the floor, so the bases still sit flush.
    </div>
  );
}
