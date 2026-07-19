import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

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
    const home = app.getPath('home');
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

    type ProviderId = 'icloud' | 'googledrive' | 'dropbox' | 'onedrive';
    const providers: { id: ProviderId; name: string; basePath: string; notedPath: string; available: boolean }[] = [
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

    return { success: true, data: providers };
  });

  ipcMain.handle('activate-cloud-provider', (_, notedPath: string) => {
    try {
      if (!fs.existsSync(notedPath)) fs.mkdirSync(notedPath, { recursive: true });
      return { success: true, data: notedPath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
