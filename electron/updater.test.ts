// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A controllable stand-in for autoUpdater.checkForUpdates(): it stays pending
// until the test calls h.resolve(), so we can observe what happens while a
// check is in flight. Hoisted so the vi.mock factory can close over it.
const h = vi.hoisted(() => {
  let resolveCurrent: (() => void) | undefined;
  const checkForUpdates = vi.fn(() => new Promise<void>(res => { resolveCurrent = () => res(); }));
  return { checkForUpdates, resolve: () => resolveCurrent?.() };
});

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.0.0' },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
  shell: { openExternal: vi.fn() },
}));
vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: h.checkForUpdates,
    downloadUpdate: vi.fn(),
    autoDownload: true,
    autoInstallOnAppQuit: false,
  },
}));

const { app } = await import('electron');
const { canSelfUpdate, checkForUpdates } = await import('./updater');

describe('canSelfUpdate', () => {
  it('is true on the platforms that can swap their own binary', () => {
    expect(canSelfUpdate('darwin', {})).toBe(true);
    expect(canSelfUpdate('win32', {})).toBe(true);
  });

  // An AppImage carries the metadata to replace itself; a .deb belongs to apt,
  // and telling that user to auto-update would fight the package manager.
  it('on Linux depends on running from an AppImage', () => {
    expect(canSelfUpdate('linux', { APPIMAGE: '/tmp/Noted.AppImage' })).toBe(true);
    expect(canSelfUpdate('linux', {})).toBe(false);
  });
});

describe('checkForUpdates serialisation', () => {
  const getWin = () => undefined;

  beforeEach(() => {
    h.checkForUpdates.mockClear();
    (app as { isPackaged: boolean }).isPackaged = true;
    // Make canSelfUpdate() true regardless of the host OS the test runs on:
    // darwin/win32 are already true; APPIMAGE flips Linux true too.
    process.env.APPIMAGE = '/tmp/Noted.AppImage';
  });
  afterEach(() => {
    (app as { isPackaged: boolean }).isPackaged = false;
    delete process.env.APPIMAGE;
  });

  it('coalesces an overlapping check onto the one already in flight', async () => {
    const first = checkForUpdates(getWin, false);  // automatic
    const second = checkForUpdates(getWin, true);  // manual, while the first runs

    // One network check, not two.
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    h.resolve();
    await Promise.all([first, second]);
  });

  it('starts a fresh check once the previous one has settled', async () => {
    const first = checkForUpdates(getWin, false);
    h.resolve();
    await first;

    const second = checkForUpdates(getWin, false);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);
    h.resolve();
    await second;
  });
});
