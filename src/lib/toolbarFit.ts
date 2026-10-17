/** Width of an icon button in the formatting bar (p-1.5 around a 15 px icon, plus the 2 px gap). */
export const TOOLBAR_BUTTON_WIDTH = 29;
/** Width of the separator between two groups (1 px line, 2 px margin each side, plus the gap). */
export const TOOLBAR_SEPARATOR_WIDTH = 7;
/** Width of the "more" button that holds the groups that do not fit. */
export const TOOLBAR_MORE_WIDTH = 31;

/**
 * How many groups of buttons, from the start, fit in `width`: all of them when they fit, otherwise as many as fit
 * next to the "more" button that holds the rest. Never less than one, so the bar is never empty.
 */
export function groupsThatFit(groupSizes: number[], width: number): number {
  const widths = groupSizes.map((n, i) => n * TOOLBAR_BUTTON_WIDTH + (i > 0 ? TOOLBAR_SEPARATOR_WIDTH : 0));
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= width) return groupSizes.length;
  let used = TOOLBAR_MORE_WIDTH;
  let count = 0;
  for (const w of widths) {
    if (used + w > width) break;
    used += w;
    count++;
  }
  return Math.max(1, count);
}
