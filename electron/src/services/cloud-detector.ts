import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export type CloudProviderId = 'icloud' | 'googledrive' | 'dropbox' | 'onedrive';

export interface CloudProvider {
  id: CloudProviderId;
  name: string;
  basePath: string;
  notedPath: string;
  available: boolean;
}

/**
 * Locate the cloud-sync folders present on this machine.
 *
 * Exported (and parameterised on `home` + `platform`) so the detection can be
 * exercised against a fixture directory instead of the real home folder — and
 * so a Linux CI runner can still test the macOS layout.
 *
 * The same four providers are always returned, in the same order: one that this
 * platform can't host simply reports `available: false`, so the renderer needs
 * no per-platform branching of its own.
 */
export function detectCloudProviders(
  home: string,
  platform: NodeJS.Platform = process.platform,
): CloudProvider[] {
  const cloudStorageBase = path.join(home, 'Library', 'CloudStorage');
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';

  function firstMatch(candidates: string[]): string | null {
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  // Find a directory under `base` whose name starts with `prefix` — the shape
  // both macOS CloudStorage mounts and Windows OneDrive tenants use.
  function firstPrefixed(base: string, prefix: string): string | null {
    if (!fs.existsSync(base)) return null;
    try {
      const entry = fs.readdirSync(base).find(e => e.startsWith(prefix));
      return entry ? path.join(base, entry) : null;
    } catch {
      return null;
    }
  }

  function findGoogleDrive(): string | null {
    if (isMac) {
      const mount = firstPrefixed(cloudStorageBase, 'GoogleDrive-');
      if (!mount) return null;
      const myDrive = path.join(mount, 'My Drive');
      return fs.existsSync(myDrive) ? myDrive : mount;
    }
    if (isWin) {
      // Drive for desktop mounts a virtual drive letter, but a synced folder in
      // the profile is the common case we can actually detect.
      return firstMatch([
        path.join(home, 'My Drive'),
        path.join(home, 'Google Drive'),
      ]);
    }
    // No first-party Google Drive client on Linux.
    return null;
  }

  function findOneDrive(): string | null {
    const direct = firstMatch([
      path.join(home, 'OneDrive'),
      path.join(home, 'OneDrive - Personal'),
      ...(isMac ? [path.join(cloudStorageBase, 'OneDrive-Personal')] : []),
    ]);
    if (direct) return direct;
    if (isWin) return firstPrefixed(home, 'OneDrive -');
    if (isMac) return firstPrefixed(cloudStorageBase, 'OneDrive-');
    return null;
  }

  function findICloud(): string | null {
    if (isMac) {
      const base = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
      return fs.existsSync(base) ? base : null;
    }
    // iCloud for Windows syncs to %USERPROFILE%\iCloudDrive. Nothing on Linux.
    if (isWin) return firstMatch([path.join(home, 'iCloudDrive')]);
    return null;
  }

  const icBase = findICloud();
  const gdBase = findGoogleDrive();
  const dbBase = firstMatch([path.join(home, 'Dropbox')]);
  const odBase = findOneDrive();

  return [
    {
      id: 'icloud',
      name: 'iCloud Drive',
      basePath: icBase ?? '',
      notedPath: icBase ? path.join(icBase, 'Noted') : '',
      available: !!icBase,
    },
    {
      id: 'googledrive',
      name: 'Google Drive',
      basePath: gdBase ?? '',
      notedPath: gdBase ? path.join(gdBase, 'Noted') : '',
      available: !!gdBase,
    },
    {
      id: 'dropbox',
      name: 'Dropbox',
      basePath: dbBase ?? '',
      notedPath: dbBase ? path.join(dbBase, 'Noted') : '',
      available: !!dbBase,
    },
    {
      id: 'onedrive',
      name: 'OneDrive',
      basePath: odBase ?? '',
      notedPath: odBase ? path.join(odBase, 'Noted') : '',
      available: !!odBase,
    },
  ];
}

/**
 * Is `candidate` the Noted folder of a cloud provider that actually exists on
 * this machine? The renderer supplies the path, so it is re-derived here rather
 * than trusted — an activated provider becomes a blessed vault root, and the
 * allowlist is only worth anything if nothing arbitrary can join it.
 */
export function isDetectedProviderPath(
  home: string,
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (typeof candidate !== 'string' || !candidate) return false;
  const resolved = path.resolve(candidate);
  return detectCloudProviders(home, platform)
    .some(p => p.available && p.notedPath && path.resolve(p.notedPath) === resolved);
}

export function registerCloudDetectorHandlers(blessRoot?: (dir: string) => void) {
  ipcMain.handle('get-icloud-path', () => {
    try {
      const home = app.getPath('home');
      // Derive it rather than hardcoding the macOS layout: iCloud lives
      // somewhere else on Windows and nowhere at all on Linux.
      const icloud = detectCloudProviders(home).find(p => p.id === 'icloud');
      if (!icloud?.available) {
        return { success: false, error: 'iCloud Drive is not available on this machine' };
      }
      const icloudPath = icloud.notedPath;
      if (!fs.existsSync(icloudPath)) fs.mkdirSync(icloudPath, { recursive: true });
      // This is a main-computed, trusted path — bless it so the vault-root
      // allowlist accepts it as a copy/export destination.
      blessRoot?.(icloudPath);
      return { success: true, data: icloudPath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('detect-cloud-providers', () => {
    return { success: true, data: detectCloudProviders(app.getPath('home')) };
  });

  ipcMain.handle('activate-cloud-provider', (_, notedPath: string) => {
    try {
      const home = app.getPath('home');
      // Only a folder belonging to a provider detected on this machine may be
      // created and activated — never an arbitrary renderer-supplied path.
      if (!isDetectedProviderPath(home, notedPath)) {
        return { success: false, error: 'Not a detected cloud provider folder' };
      }
      if (!fs.existsSync(notedPath)) fs.mkdirSync(notedPath, { recursive: true });
      // Activating a provider makes it the vault: bless it, or every read and
      // write would silently fall back to the default vault while the UI shows
      // the cloud folder as active.
      blessRoot?.(notedPath);
      return { success: true, data: notedPath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
