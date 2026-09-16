/**
 * A prop the studio can place: the user's own STL, welded and grounded by the
 * worker (see `mesh/ground.ts`). Base Studio never generates props — the ground
 * is generated, the props are the user's.
 */
import type { Soup } from '../types';

export interface Prop {
  /** closed shells (possibly several, overlapping) in the prop's local frame, bottom at z = 0 */
  soup: Soup;
  /** radius around the origin the prop occupies in XY, mm */
  footprintRadius: number;
  /** top of the prop above the ground line, mm */
  height: number;
  /** lowest point below the ground line (<= 0), mm; that part beds into the terrain */
  underground: number;
}
