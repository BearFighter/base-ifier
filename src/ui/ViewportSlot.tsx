/** Hosts the 3D viewport (`src/viewport/Viewport.tsx`), filling `.viewport-host`. */
import { Viewport } from '@/viewport/Viewport';

export function ViewportSlot() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Viewport />
    </div>
  );
}
