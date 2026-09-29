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
const { canSelfUpdate, checkForUpdates, isDiskImagePath } = await import('./updater');

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

  it('is false on macOS when running from the mounted DMG', () => {
    expect(canSelfUpdate('darwin', {}, '/Volumes/Noted/Noted.app/Contents/Resources/app.asar')).toBe(false);
    expect(canSelfUpdate('darwin', {}, '/Applications/Noted.app/Contents/Resources/app.asar')).toBe(true);
  });

  it('reads the real app path when none is passed', () => {
    const electronApp = app as unknown as { getAppPath?: () => string };
    const original = electronApp.getAppPath;
    try {
      electronApp.getAppPath = () => '/Volumes/Noted/Noted.app/Contents/Resources/app.asar';
      expect(canSelfUpdate('darwin', {})).toBe(false);
      electronApp.getAppPath = () => '/Applications/Noted.app/Contents/Resources/app.asar';
      expect(canSelfUpdate('darwin', {})).toBe(true);
    } finally {
      if (original) electronApp.getAppPath = original;
      else delete electronApp.getAppPath;
    }
  });
});

describe('isDiskImagePath', () => {
  it('only matches macOS /Volumes paths', () => {
    expect(isDiskImagePath('/Volumes/Noted/Noted.app', 'darwin')).toBe(true);
    expect(isDiskImagePath('/Applications/Noted.app', 'darwin')).toBe(false);
    expect(isDiskImagePath('/Volumes/Noted/Noted.app', 'win32')).toBe(false);
  });
});

describe('updater logging', () => {
  it('routes electron-updater chatter off bare console', async () => {
    const { autoUpdater } = await import('electron-updater');
    // Trigger wireListeners through a check (dev, unpackaged → still wires).
    (app as { isPackaged: boolean }).isPackaged = true;
    process.env.APPIMAGE = '/tmp/Noted.AppImage';
    const pending = checkForUpdates(() => undefined, false);
    h.resolve();
    await pending;
    delete process.env.APPIMAGE;
    (app as { isPackaged: boolean }).isPackaged = false;

    const logger = (autoUpdater as unknown as { logger?: {
      info: (m?: unknown) => void; warn: (m?: unknown) => void;
      error: (m?: unknown) => void; debug: (m?: unknown) => void;
    } }).logger;
    expect(logger).toBeDefined();

    // Simulate the reported crash: stdout.write throwing EPIPE synchronously
    // (dead socket stdio, as in DownloadedUpdateHelper.getValidCachedUpdateFile).
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    }) as typeof process.stdout.write;
    try {
      expect(() => logger!.info('cached update file')).not.toThrow();
      expect(() => logger!.warn('w')).not.toThrow();
      expect(() => logger!.error('e')).not.toThrow();
      expect(() => logger!.debug('d')).not.toThrow();
    } finally {
      process.stdout.write = originalWrite;
    }
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
