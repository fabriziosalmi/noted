/**
 * Images pasted or dropped into a note used to be stored INSIDE it as base64 data
 * URIs: notes grew by megabytes, blew past the full-text size limit, made Git
 * diffs unreadable and reached MCP clients as walls of base64. They now live as
 * files in an attachments folder under a content-hash name, and the note keeps a
 * relative path. This module is the pure part: recognising images, finding the
 * references in a note, and converting between the two forms.
 *
 * Node-only (it uses Buffer); the main process is its only user.
 */

import { DEFAULT_ATTACHMENTS_FOLDER, isValidAttachmentsFolder } from './attachmentsFolder.js';

export { DEFAULT_ATTACHMENTS_FOLDER, isValidAttachmentsFolder };
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface ImageType {
  ext: 'png' | 'jpg' | 'gif' | 'webp';
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

/** Images the app stores and serves; anything else is not an attachment. */
const BY_EXT: Record<string, ImageType> = {
  png: { ext: 'png', mime: 'image/png' },
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  gif: { ext: 'gif', mime: 'image/gif' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

export function imageTypeFromExt(ext: string): ImageType | null {
  return BY_EXT[ext.toLowerCase().replace(/^\./, '')] ?? null;
}

/** Decide what a file is from its bytes, never from a name or a MIME type the sender claims. */
export function detectImage(b: Uint8Array): ImageType | null {
  const at = (i: number, ...sig: number[]) => sig.every((v, k) => b[i + k] === v);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return BY_EXT.png;
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return BY_EXT.jpg;
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return BY_EXT.gif;
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return BY_EXT.webp; // RIFF....WEBP
  return null;
}

/** File name for an attachment: a prefix of the content hash, so identical images are stored once. */
export function attachmentName(hashHex: string, ext: string): string {
  return `${hashHex.slice(0, 32)}.${ext}`;
}

// ── references inside a note ────────────────────────────────────────────────

const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decodeAttr = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, m => ENTITY[m]);

/**
 * Is `src` a path to an image file inside the vault (relative, no scheme, no
 * escaping the vault)? URLs, data URIs, absolute paths and `..` are not.
 */
export function isLocalImageRef(src: string): boolean {
  if (!src || src.includes('\0') || src.includes('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('//')) return false;
  if (src.split('/').some(seg => seg === '..' || seg === '')) return false;
  const ext = /\.([a-z0-9]+)$/i.exec(src)?.[1];
  return !!ext && imageTypeFromExt(ext) !== null;
}

/** Normalise a src/URL as written in a note to a vault-relative path, or null if it is not one. */
export function normalizeImageRef(src: string): string | null {
  let s = decodeAttr(src.trim()).replace(/[?#].*$/, '');
  try { s = decodeURIComponent(s); } catch { /* keep as written */ }
  // "./attachments/x.png" and "attachments/x.png" are the same file.
  s = s.split('/').filter(seg => seg !== '.').join('/');
  return isLocalImageRef(s) ? s : null;
}

const HTML_IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const MD_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Vault-relative image files a note refers to, distinct, in order of appearance. */
export function localImageRefs(raw: string): string[] {
  const out: string[] = [];
  const add = (src: string) => { const n = normalizeImageRef(src); if (n && !out.includes(n)) out.push(n); };
  for (const m of raw.matchAll(HTML_IMG_SRC)) add(m[1] ?? m[2] ?? '');
  for (const m of raw.matchAll(MD_IMAGE)) add(m[1]);
  return out;
}

// ── data URIs <-> files ─────────────────────────────────────────────────────

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/i;

export function parseDataImageUri(src: string): { bytes: Uint8Array; type: ImageType } | null {
  const m = DATA_IMAGE.exec(decodeAttr(src.trim()));
  if (!m) return null;
  const bytes = new Uint8Array(Buffer.from(m[2].replace(/\s+/g, ''), 'base64'));
  // The bytes decide: a data URI that claims PNG but holds something else is not stored as an image.
  const type = detectImage(bytes);
  return type ? { bytes, type } : null;
}

export interface ExtractResult {
  content: string;
  /** Data-URI images replaced by a path. */
  images: number;
  /** Bytes of base64 text removed from the note. */
  bytes: number;
}

/**
 * Replace every embedded image (HTML `<img src="data:...">` and Markdown
 * `![](data:...)`) with whatever `store` returns for its bytes — normally the
 * relative path of a file it just wrote. If `store` returns null the image is
 * left as it was, so nothing is lost when a write fails.
 */
export function extractDataImages(raw: string, store: (bytes: Uint8Array, type: ImageType) => string | null): ExtractResult {
  let images = 0;
  let bytes = 0;
  const swap = (src: string): string | null => {
    const parsed = parseDataImageUri(src);
    if (!parsed) return null;
    const rel = store(parsed.bytes, parsed.type);
    if (!rel) return null;
    images++;
    bytes += src.length;
    return rel;
  };
  let content = raw.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (whole, pre: string, dq?: string, sq?: string) => {
    const rel = swap(dq ?? sq ?? '');
    return rel === null ? whole : `${pre}"${rel.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
  });
  content = content.replace(/(!\[[^\]]*\]\()(\s*<?)(data:image\/[^)\s>]+)(>?)/g, (whole, open: string, ws: string, src: string, close: string) => {
    const rel = swap(src);
    return rel === null ? whole : `${open}${ws}${rel}${close}`;
  });
  return { content, images, bytes };
}

/**
 * The reverse, for exports: HTML that must stand alone (a PDF, an exported .html
 * or .docx, a gist) gets its local images back as data URIs. `read` returns the
 * file's bytes + type, or null when it is missing or not allowed (left as is).
 */
export function inlineLocalImages(raw: string, read: (relPath: string) => { bytes: Uint8Array; type: ImageType } | null): string {
  return raw.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (whole, pre: string, dq?: string, sq?: string) => {
    const rel = normalizeImageRef(dq ?? sq ?? '');
    if (!rel) return whole;
    const file = read(rel);
    return file ? `${pre}"data:${file.type.mime};base64,${Buffer.from(file.bytes).toString('base64')}"` : whole;
  }).replace(/(!\[[^\]]*\]\()(\s*<?)([^)\s>]+)(>?)/g, (whole, open: string, ws: string, src: string, close: string) => {
    const rel = normalizeImageRef(src);
    if (!rel) return whole;
    const file = read(rel);
    return file ? `${open}${ws}data:${file.type.mime};base64,${Buffer.from(file.bytes).toString('base64')}${close}` : whole;
  });
}
