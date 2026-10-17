/** Where a menu opened at the caret goes, as `position: fixed` style values. */
export interface PopupStyle {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

interface Box { top: number; bottom: number; left: number }
interface Viewport { width: number; height: number }

/**
 * A suggestion menu for a caret at `caret` (from `coordsAtPos`): below the line, or above it when there is less room
 * below than above and not enough for the whole menu. It is never taller than the room it has (it scrolls instead)
 * and never runs off the left or right edge.
 */
export function popupPosition(
  caret: Box,
  width: number,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight },
  desiredHeight = 360,
  gap = 6,
  margin = 8,
): PopupStyle {
  const left = Math.max(margin, Math.min(caret.left, viewport.width - width - margin));
  const below = viewport.height - caret.bottom - gap - margin;
  const above = caret.top - gap - margin;
  if (below >= desiredHeight || below >= above) {
    return { left, top: caret.bottom + gap, maxHeight: Math.max(0, Math.min(desiredHeight, below)) };
  }
  return { left, bottom: viewport.height - caret.top + gap, maxHeight: Math.max(0, Math.min(desiredHeight, above)) };
}
