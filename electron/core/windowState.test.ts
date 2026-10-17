// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZE, restorePlacement } from './windowState';

const laptop = { x: 0, y: 25, width: 1512, height: 920 };
const external = { x: 1512, y: 0, width: 2560, height: 1415 };

describe('restorePlacement', () => {
  it('opens the window where and as it was left', () => {
    expect(restorePlacement({ bounds: { x: 100, y: 80, width: 1000, height: 700 }, maximized: false }, [laptop]))
      .toEqual({ x: 100, y: 80, width: 1000, height: 700, maximized: false, fullScreen: false });
  });

  it('keeps maximized and full screen', () => {
    expect(restorePlacement({ bounds: { x: 0, y: 25, width: 1200, height: 800 }, maximized: true, fullScreen: true }, [laptop]))
      .toMatchObject({ maximized: true, fullScreen: true });
  });

  it('centres a window left on a screen that is gone, at its size', () => {
    const p = restorePlacement({ bounds: { x: 2000, y: 100, width: 1400, height: 900 } }, [laptop]);
    expect(p.x).toBeUndefined();
    expect(p.y).toBeUndefined();
    expect(p).toMatchObject({ width: 1400, height: 900 });
    // ...and keeps the place when that screen is there.
    expect(restorePlacement({ bounds: { x: 2000, y: 100, width: 1400, height: 900 } }, [laptop, external])).toMatchObject({ x: 2000, y: 100 });
  });

  it('drops a place whose title bar could not be grabbed (above the top, or only a sliver on screen)', () => {
    expect(restorePlacement({ bounds: { x: 100, y: -500, width: 1000, height: 700 } }, [laptop]).x).toBeUndefined();
    expect(restorePlacement({ bounds: { x: 1480, y: 100, width: 1000, height: 700 } }, [laptop]).x).toBeUndefined();
  });

  it('never opens smaller than the minimum or larger than the largest screen', () => {
    expect(restorePlacement({ bounds: { x: 0, y: 25, width: 200, height: 100 } }, [laptop])).toMatchObject({ width: 720, height: 500 });
    expect(restorePlacement({ bounds: { x: 0, y: 25, width: 5000, height: 3000 } }, [laptop])).toMatchObject({ width: 1512, height: 920 });
  });

  it('falls back to the default size for anything unreadable', () => {
    for (const bad of [null, 'x', {}, { bounds: { width: 'wide', height: 600 } }, { bounds: { width: NaN, height: 600 } }]) {
      expect(restorePlacement(bad, [laptop])).toEqual({ ...DEFAULT_SIZE, maximized: false, fullScreen: false });
    }
  });
});
