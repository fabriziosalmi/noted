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
 * Exported (and parameterised on `home`) so the detection can be exercised
 * against a fixture directory instead of the real home folder.
 */
export function detectCloudProviders(home: string): CloudProvider[] {
  const cloudStorageBase = path.join(home, 'Library', 'CloudStorage');

  function firstMatch(candidates: string[]): string | null {
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  function findGoogleDrive(): string | null {
    if (!fs.existsSync(cloudStorageBase)) return null;
    const entries = fs.readdirSync(cloudStorageBase);
    const gdEntry = entries.find(e => e.startsWith('GoogleDrive-'));
    if (!gdEntry) return null;
    const myDrive = path.join(cloudStorageBase, gdEntry, 'My Drive');
    return fs.existsSync(myDrive) ? myDrive : path.join(cloudStorageBase, gdEntry);
  }

  function findOneDrive(): string | null {
    const candidates = [
      path.join(home, 'OneDrive'),
      path.join(home, 'OneDrive - Personal'),
      path.join(cloudStorageBase, 'OneDrive-Personal'),
    ];
    const direct = firstMatch(candidates);
    if (direct) return direct;
    if (!fs.existsSync(cloudStorageBase)) return null;
    const entries = fs.readdirSync(cloudStorageBase);
    const od = entries.find(e => e.startsWith('OneDrive-'));
    return od ? path.join(cloudStorageBase, od) : null;
  }

  const iCloudBase = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const gdBase = findGoogleDrive();
  const dbBase = firstMatch([path.join(home, 'Dropbox')]);
  const odBase = findOneDrive();

  return [
    {
      id: 'icloud',
      name: 'iCloud Drive',
      basePath: iCloudBase,
      notedPath: path.join(iCloudBase, 'Noted'),
      available: fs.existsSync(iCloudBase),
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
export function isDetectedProviderPath(home: string, candidate: string): boolean {
  if (typeof candidate !== 'string' || !candidate) return false;
  const resolved = path.resolve(candidate);
  return detectCloudProviders(home).some(p => p.available && p.notedPath && path.resolve(p.notedPath) === resolved);
}

export function registerCloudDetectorHandlers(blessRoot?: (dir: string) => void) {
  ipcMain.handle('get-icloud-path', () => {
    try {
      const home = app.getPath('home');
      const icloudPath = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Noted');
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
