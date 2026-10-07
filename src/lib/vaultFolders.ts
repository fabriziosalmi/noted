import { getElectronApi } from './electronApi';

/**
 * Makes the folders a note will be in, one level at a time (the app creates a folder inside a folder that exists), as many as are missing.
 * A folder that is already there is not an error. Returns the reason it could not, or null.
 */
export async function ensureFolders(file: string, syncDir: string | undefined): Promise<string | null> {
  const api = getElectronApi();
  const parts = file.split('/').slice(0, -1);
  for (let i = 0; i < parts.length; i++) {
    const res = await api?.createFolder(parts.slice(0, i + 1).join('/'), syncDir);
    if (res && !res.success && !/already exists/i.test(res.error ?? '')) return res.error ?? 'failed';
  }
  return null;
}
