import fs from 'node:fs';

export interface Rect { x: number; y: number; width: number; height: number }

export interface WindowPlacement {
  width: number;
  height: number;
  /** Left out when the saved place is not on any screen now: the window is then centred. */
  x?: number;
  y?: number;
  maximized: boolean;
  fullScreen: boolean;
}

export const DEFAULT_SIZE = { width: 1200, height: 800 };
export const MIN_SIZE = { width: 720, height: 500 };
/** How much of the window's top edge must be on a screen for the saved place to be used: enough to grab it. */
const GRAB = { width: 100, height: 40 };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Where the main window opens: as it was left, when that still fits the screens there are now. A size larger than
 * every screen is reduced; a place no screen shows (a monitor that was unplugged) is dropped, so the window is
 * centred instead of opening where it cannot be seen. Anything unreadable gives the default size.
 */
export function restorePlacement(saved: unknown, workAreas: Rect[]): WindowPlacement {
  const fallback: WindowPlacement = { ...DEFAULT_SIZE, maximized: false, fullScreen: false };
  if (!saved || typeof saved !== 'object') return fallback;
  const s = saved as { bounds?: Partial<Rect>; maximized?: unknown; fullScreen?: unknown };
  const b = s.bounds;
  if (!b || !finite(b.width) || !finite(b.height)) return fallback;

  const maxW = Math.max(MIN_SIZE.width, ...workAreas.map(a => a.width));
  const maxH = Math.max(MIN_SIZE.height, ...workAreas.map(a => a.height));
  const width = Math.round(Math.min(Math.max(b.width, MIN_SIZE.width), maxW));
  const height = Math.round(Math.min(Math.max(b.height, MIN_SIZE.height), maxH));
  const placement: WindowPlacement = { width, height, maximized: s.maximized === true, fullScreen: s.fullScreen === true };

  if (finite(b.x) && finite(b.y)) {
    const x = b.x, y = b.y;
    const grabbable = workAreas.some(a => {
      const overlapW = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
      const overlapH = Math.min(y + GRAB.height, a.y + a.height) - Math.max(y, a.y);
      return overlapW >= GRAB.width && overlapH >= GRAB.height;
    });
    if (grabbable) { placement.x = Math.round(x); placement.y = Math.round(y); }
  }
  return placement;
}

export function readPlacementFile(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Written to a temporary file first, so a crash mid-write never leaves a broken state behind. */
export function writePlacementFile(file: string, state: { bounds: Rect; maximized: boolean; fullScreen: boolean }): void {
  try {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch { /* the next launch uses the default size: not worth interrupting a close for */ }
}
