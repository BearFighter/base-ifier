/**
 * Largest empty axis-aligned rectangle in a rectangular container with
 * axis-aligned occupied rectangles removed, via grid rasterisation plus the
 * classic histogram/stack "maximal rectangle in a binary matrix" algorithm.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Container spans [0, w] x [0, h]. Rasterises on a `step` grid (a cell is
 * occupied if any occupied rect covers it fully or partially), finds the
 * maximal-area all-free rectangle, and returns it in mm snapped to the grid.
 * Returns null if there is no free cell. Ties prefer the rect closest to the
 * container origin.
 */
export function largestEmptyRect(
  container: { w: number; h: number },
  occupied: Rect[],
  step = 0.5,
): Rect | null {
  const cols = Math.max(1, Math.round(container.w / step));
  const rows = Math.max(1, Math.round(container.h / step));
  const eps = step * 1e-6;

  const blocked = new Uint8Array(rows * cols);
  for (const rect of occupied) {
    const x0 = rect.x;
    const x1 = rect.x + rect.w;
    const y0 = rect.y;
    const y1 = rect.y + rect.h;
    if (x1 <= 0 || y1 <= 0 || x0 >= container.w || y0 >= container.h) continue;

    let cStart = Math.floor(x0 / step + eps);
    let cEnd = Math.ceil(x1 / step - eps) - 1;
    let rStart = Math.floor(y0 / step + eps);
    let rEnd = Math.ceil(y1 / step - eps) - 1;
    cStart = Math.max(0, cStart);
    rStart = Math.max(0, rStart);
    cEnd = Math.min(cols - 1, cEnd);
    rEnd = Math.min(rows - 1, rEnd);

    for (let r = rStart; r <= rEnd; r++) {
      const rowOff = r * cols;
      for (let c = cStart; c <= cEnd; c++) {
        blocked[rowOff + c] = 1;
      }
    }
  }

  const heights = new Int32Array(cols);
  let best: { area: number; x: number; y: number; w: number; h: number } | null = null;

  for (let r = 0; r < rows; r++) {
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      heights[c] = blocked[rowOff + c] ? 0 : heights[c] + 1;
    }

    // Largest rectangle in histogram (monotonic stack of column indices).
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const idx = stack.pop()!;
        const height = heights[idx];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const right = c - 1;
        const width = right - left + 1;
        const area = height * width;
        if (area > 0) {
          const rectX = left * step;
          const rectY = (r - height + 1) * step;
          const rectW = width * step;
          const rectH = height * step;
          const better =
            best === null ||
            area > best.area + 1e-9 ||
            (area >= best.area - 1e-9 &&
              rectX * rectX + rectY * rectY < best.x * best.x + best.y * best.y - 1e-9);
          if (better) {
            best = { area, x: rectX, y: rectY, w: rectW, h: rectH };
          }
        }
      }
      stack.push(c);
    }
  }

  if (!best) return null;
  return { x: best.x, y: best.y, w: best.w, h: best.h };
}
