import { getElectronApi } from './electronApi';

import { DEFAULT_ATTACHMENTS_FOLDER } from '../../shared/vault/attachmentsFolder';

export { DEFAULT_ATTACHMENTS_FOLDER };

/**
 * Turn a pasted or dropped image into something a note can reference. In the app
 * the bytes are stored as a file under the vault's attachments folder (content
 * hash name) and the note gets the relative path; only where there is no app
 * backend (tests, a plain browser) does it fall back to an inline data URI.
 */
export async function attachImage(
  file: Blob,
  opts: { folder?: string; syncDir?: string },
): Promise<{ src: string; stored: boolean }> {
  const api = getElectronApi();
  if (api?.saveAttachment) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await api.saveAttachment(bytes, opts.folder || DEFAULT_ATTACHMENTS_FOLDER, opts.syncDir);
    if (!res.success || !res.data) throw new Error(res.error ?? 'Could not save the image');
    return { src: res.data, stored: true };
  }
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
    reader.readAsDataURL(file);
  });
  return { src, stored: false };
}
