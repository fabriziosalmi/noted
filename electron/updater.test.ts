// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// The module pulls in electron and electron-updater for the wiring half; the
// capability check under test touches neither.
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.0.0' },
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock('electron-updater', () => ({
  autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn() },
}));

const { canSelfUpdate } = await import('./updater');

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
