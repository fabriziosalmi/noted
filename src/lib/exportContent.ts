import { getElectronApi } from './electronApi';

/**
 * Notes now refer to their images by path ("attachments/<hash>.png"). A PDF, an
 * exported .html/.docx/.md, a printout or a gist must stand alone, so before
 * anything leaves the vault the images are embedded back as data URIs by the main
 * process (which alone may read the vault). If that is not possible the content
 * goes out as it is, never blocked.
 */
export async function inlineVaultImages(content: string): Promise<string> {
  if (!content || (!content.includes('<img') && !content.includes('!['))) return content;
  const api = getElectronApi();
  if (!api?.inlineVaultImages) return content;
  try {
    const res = await api.inlineVaultImages(content, undefined);
    return res.success && typeof res.data === 'string' ? res.data : content;
  } catch {
    return content;
  }
}
