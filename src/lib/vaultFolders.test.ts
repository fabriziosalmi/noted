import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureFolders } from './vaultFolders';

const original = window.electronAPI;
afterEach(() => { window.electronAPI = original; });

describe('ensureFolders', () => {
  it('a folder that is already there is not an error, in any language (the main process says so with a code)', async () => {
    window.electronAPI = { ...original, createFolder: vi.fn(async () => ({ success: false, error: 'La cartella "sources" esiste già', code: 'exists' })) } as typeof window.electronAPI;
    expect(await ensureFolders('sources/Page.md', undefined)).toBeNull();
  });

  it('any other failure is returned', async () => {
    window.electronAPI = { ...original, createFolder: vi.fn(async () => ({ success: false, error: 'Nome di cartella non valido' })) } as typeof window.electronAPI;
    expect(await ensureFolders('bad/Page.md', undefined)).toBe('Nome di cartella non valido');
  });
});
