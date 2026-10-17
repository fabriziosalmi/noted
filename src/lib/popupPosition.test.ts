import { describe, expect, it } from 'vitest';
import { popupPosition } from './popupPosition';

const VIEW = { width: 1280, height: 800 };
const caretAt = (top: number, left = 400) => ({ top, bottom: top + 20, left });

describe('popupPosition', () => {
  it('opens below the line when the menu fits there', () => {
    expect(popupPosition(caretAt(100), 256, VIEW)).toEqual({ left: 400, top: 126, maxHeight: 360 });
  });

  it('opens above the line near the bottom of the window, as tall as the room above allows', () => {
    const p = popupPosition(caretAt(700), 256, VIEW);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(800 - 700 + 6); // its bottom edge sits just over the line
    expect(p.maxHeight).toBe(360);
  });

  it('never runs off the bottom: with little room either way it takes the larger side and scrolls', () => {
    const small = { width: 800, height: 300 };
    const p = popupPosition(caretAt(120), 256, small);
    // below: 300 - 140 - 6 - 8 = 146; above: 120 - 6 - 8 = 106
    expect(p).toMatchObject({ top: 146, maxHeight: 146 });
    expect(p.top! + p.maxHeight).toBeLessThanOrEqual(small.height);
  });

  it('stays inside the left and right edges', () => {
    expect(popupPosition(caretAt(100, 1200), 256, VIEW).left).toBe(1280 - 256 - 8);
    expect(popupPosition(caretAt(100, -20), 256, VIEW).left).toBe(8);
  });
});
