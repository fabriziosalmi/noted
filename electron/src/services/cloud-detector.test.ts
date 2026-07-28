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
const provider = (id: string) => detectCloudProviders(home).find(p => p.id === id)!;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-cloud-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('detectCloudProviders', () => {
  it('reports every provider as unavailable on a bare home folder', () => {
    const providers = detectCloudProviders(home);
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
});

describe('isDetectedProviderPath', () => {
  // Activation blesses the path as a vault root, so anything else has to be
  // refused — otherwise the allowlist is decorative.
  it('accepts the Noted folder of an available provider', () => {
    mk('Dropbox');
    expect(isDetectedProviderPath(home, path.join(home, 'Dropbox', 'Noted'))).toBe(true);
  });

  it('normalises the path before comparing', () => {
    mk('Dropbox');
    expect(isDetectedProviderPath(home, path.join(home, 'Dropbox', '.', 'Noted') + path.sep)).toBe(true);
  });

  it('rejects a provider that is not installed', () => {
    expect(isDetectedProviderPath(home, path.join(home, 'Dropbox', 'Noted'))).toBe(false);
  });

  it('rejects an arbitrary directory', () => {
    mk('Dropbox');
    expect(isDetectedProviderPath(home, '/tmp')).toBe(false);
    expect(isDetectedProviderPath(home, path.join(home, 'Dropbox'))).toBe(false);
    expect(isDetectedProviderPath(home, '')).toBe(false);
  });
});
