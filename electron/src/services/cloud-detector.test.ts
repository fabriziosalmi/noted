// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// The module imports electron for the IPC registration half; the detection half
// under test never touches it.
vi.mock('electron', () => ({
  app: { getPath: () => '' },
  ipcMain: { handle: () => undefined },
}));

const { detectCloudProviders, isDetectedProviderPath } = await import('./cloud-detector');

let home: string;
const mk = (rel: string) => fs.mkdirSync(path.join(home, rel), { recursive: true });
// Platform is passed explicitly throughout: the macOS layout has to stay
// testable on the Linux CI runner, and vice versa.
const provider = (id: string, platform: NodeJS.Platform = 'darwin') =>
  detectCloudProviders(home, platform).find(p => p.id === id)!;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-cloud-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('detectCloudProviders', () => {
  it('reports every provider as unavailable on a bare home folder', () => {
    const providers = detectCloudProviders(home, 'darwin');
    expect(providers.map(p => p.id)).toEqual(['icloud', 'googledrive', 'dropbox', 'onedrive']);
    expect(providers.every(p => !p.available)).toBe(true);
  });

  it('finds iCloud Drive and points at its Noted subfolder', () => {
    mk('Library/Mobile Documents/com~apple~CloudDocs');
    expect(provider('icloud').available).toBe(true);
    expect(provider('icloud').notedPath).toBe(
      path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Noted'),
    );
  });

  it('prefers "My Drive" inside a Google Drive mount', () => {
    mk('Library/CloudStorage/GoogleDrive-someone@gmail.com/My Drive');
    expect(provider('googledrive').available).toBe(true);
    expect(provider('googledrive').basePath).toContain(`My Drive`);
  });

  it('falls back to the Google Drive mount root when "My Drive" is absent', () => {
    mk('Library/CloudStorage/GoogleDrive-someone@gmail.com');
    expect(provider('googledrive').basePath).toBe(
      path.join(home, 'Library', 'CloudStorage', 'GoogleDrive-someone@gmail.com'),
    );
  });

  it('finds Dropbox and a CloudStorage-style OneDrive', () => {
    mk('Dropbox');
    mk('Library/CloudStorage/OneDrive-Personal');
    expect(provider('dropbox').available).toBe(true);
    expect(provider('onedrive').available).toBe(true);
  });

  // Every platform returns the same four rows in the same order, so the
  // renderer never has to branch — only `available` differs.
  it('keeps the provider list stable across platforms', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as NodeJS.Platform[]) {
      expect(detectCloudProviders(home, platform).map(p => p.id))
        .toEqual(['icloud', 'googledrive', 'dropbox', 'onedrive']);
    }
  });

  it('uses the Windows layout on win32', () => {
    mk('iCloudDrive');
    mk('My Drive');
    mk('OneDrive - Contoso');
    expect(provider('icloud', 'win32').notedPath).toBe(path.join(home, 'iCloudDrive', 'Noted'));
    expect(provider('googledrive', 'win32').basePath).toBe(path.join(home, 'My Drive'));
    expect(provider('onedrive', 'win32').basePath).toBe(path.join(home, 'OneDrive - Contoso'));
  });

  it('ignores the macOS layout when running on win32', () => {
    mk('Library/Mobile Documents/com~apple~CloudDocs');
    mk('Library/CloudStorage/GoogleDrive-someone@gmail.com/My Drive');
    expect(provider('icloud', 'win32').available).toBe(false);
    expect(provider('googledrive', 'win32').available).toBe(false);
  });

  // Linux has Dropbox and (third-party) OneDrive clients, but no iCloud and no
  // first-party Google Drive — claiming otherwise would offer a dead folder.
  it('offers only Dropbox and OneDrive on linux', () => {
    mk('Dropbox');
    mk('OneDrive');
    mk('iCloudDrive');
    mk('My Drive');
    expect(provider('dropbox', 'linux').available).toBe(true);
    expect(provider('onedrive', 'linux').available).toBe(true);
    expect(provider('icloud', 'linux').available).toBe(false);
    expect(provider('googledrive', 'linux').available).toBe(false);
  });
});

describe('isDetectedProviderPath', () => {
  // Activation blesses the path as a vault root, so anything else has to be
  // refused — otherwise the allowlist is decorative.
  it('accepts the Noted folder of an available provider', () => {
    mk('Dropbox');
    expect(isDetectedProviderPath(home, path.join(home, 'Dropbox', 'Noted'), 'darwin')).toBe(true);
  });

  it('normalises the path before comparing', () => {
    mk('Dropbox');
    expect(isDetectedProviderPath(home, path.join(home, 'Dropbox', '.', 'Noted') + path.sep, 'darwin')).toBe(true);
  });

  it('rejects a provider that is not installed', () => {
    expect(isDetectedProviderPath(home, path.join(home, 'Dropbox', 'Noted'), 'darwin')).toBe(false);
  });

  it('rejects an arbitrary directory', () => {
    mk('Dropbox');
    expect(isDetectedProviderPath(home, '/tmp', 'darwin')).toBe(false);
    expect(isDetectedProviderPath(home, path.join(home, 'Dropbox'), 'darwin')).toBe(false);
    expect(isDetectedProviderPath(home, '', 'darwin')).toBe(false);
  });

  // A provider the platform can't host must never bless a vault root, even if a
  // folder with the right name happens to exist.
  it('rejects a macOS-only provider path when running elsewhere', () => {
    mk('Library/Mobile Documents/com~apple~CloudDocs');
    const icloudNoted = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Noted');
    expect(isDetectedProviderPath(home, icloudNoted, 'darwin')).toBe(true);
    expect(isDetectedProviderPath(home, icloudNoted, 'win32')).toBe(false);
    expect(isDetectedProviderPath(home, icloudNoted, 'linux')).toBe(false);
  });
});
