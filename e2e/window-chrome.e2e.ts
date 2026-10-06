import { test, expect } from './fixtures';

// What can be checked about the window's chrome without a person looking at it (#33), on each OS's CI runner:
// the controls exist, nothing is transparent where it must not be, and macOS keeps its hidden-inset bar.
// Not covered here, because it takes eyes: whether the app's own 40px bar next to the native frame looks
// right on Windows/Linux, and the native decorations on Linux (the CI display has no window manager).
test.describe('window chrome', () => {
  test('the window can be minimized, maximized and closed, and is opaque off macOS', async ({ noted }) => {
    const { app } = noted;
    const info = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return {
        minimizable: w.isMinimizable(),
        maximizable: w.isMaximizable(),
        closable: w.isClosable(),
        resizable: w.isResizable(),
        background: w.getBackgroundColor().toLowerCase(),
        frameHeight: w.getBounds().height - w.getContentBounds().height,
      };
    });
    expect(info).toMatchObject({ minimizable: true, maximizable: true, closable: true, resizable: true });

    if (process.platform === 'darwin') {
      expect(info.background).toMatch(/^#(00)?000000$/); // transparent (Electron reports it without the alpha): vibrancy shows through
      expect(info.frameHeight).toBe(0); // hidden-inset: the page runs under the traffic lights
    } else {
      expect(info.background).toMatch(/^#(ff)?0a0a0c$/); // opaque: no black or transparent flash, no missing controls
    }
    if (process.platform === 'win32') {
      expect(info.frameHeight).toBeGreaterThan(20); // the native caption bar with its buttons
    }
  });

  test('the app draws its own bar, with a drag area, beneath the native frame', async ({ noted }) => {
    const { win } = noted;
    const bar = win.locator('.vibrancy-titlebar');
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box!.height).toBeGreaterThan(30);
    expect(box!.y).toBeLessThanOrEqual(1); // at the top of the page: the native frame, when there is one, sits above the page
    const draggable = await bar.evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region'));
    expect(draggable).toBe('drag');
  });

  test('every window control in the app bar is outside the drag area, so it can be clicked', async ({ noted }) => {
    const { win } = noted;
    const buttons = win.locator('.vibrancy-titlebar button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      // the nearest element at or above the button that sets a region decides whether a click on it is a drag
      const region = await buttons.nth(i).evaluate(el => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const value = getComputedStyle(node).getPropertyValue('-webkit-app-region');
          if (value && value !== 'none') return value;
        }
        return 'none';
      });
      expect(region, `button ${i}`).toBe('no-drag');
    }
  });
});
