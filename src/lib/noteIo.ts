// Where a note's text crosses between the app and the disk (ADR 0001). Inside the app a note is HTML plus a
// frontmatter comment (the "wire" form: what the store, the editor and every feature already work with);
// on disk it is that same HTML for a vault written by earlier versions, or Markdown for a migrated one. The
// vault's format decides, and only the three calls that read or write a note's text look at it, so nothing
// else in the renderer needs to know which format a vault is in.
import { documentSchema } from '../../shared/markdown/schema';
import { parseNote, serializeNote } from '../../shared/markdown/codec';
import { docToHtml, htmlToDoc } from '../../shared/markdown/html';
import { extractHtmlFrontmatterComment, prependFrontmatterComment } from '../../shared/markdown/frontmatter';
import type { NoteFormat } from '../../shared/vault/format';

export type { NoteFormat };

const dom = () => ({ document, DOMParser });

/** A note file's text as the app works with it (HTML with a frontmatter comment). */
export function diskToWire(raw: string, format: NoteFormat): string {
  if (format !== 'markdown') return raw;
  const { frontmatter, doc } = parseNote(raw);
  return prependFrontmatterComment(docToHtml(doc, dom()), frontmatter || null);
}

/** What goes into the file for a note the app holds as HTML with a frontmatter comment. */
export function wireToDisk(wire: string, format: NoteFormat): string {
  if (format !== 'markdown') return wire;
  const { frontmatter, body } = extractHtmlFrontmatterComment(wire);
  return serializeNote({ frontmatter: frontmatter ?? '', doc: htmlToDoc(body, documentSchema(), dom()) });
}

/**
 * The one HTML a note has once it has been through the file: what the editor would read back after a save.
 * Two HTML strings that mean the same note compare equal after this; comparing them raw would call every
 * autosave an outside change, because the editor and the codec print the same document slightly differently.
 */
export function canonicalWire(wire: string, format: NoteFormat): string {
  return format === 'markdown' ? diskToWire(wireToDisk(wire, format), format) : wire;
}

// ── the vault's format, per vault directory ────────────────────────────────

const formats = new Map<string, NoteFormat>();
const asking = new Map<string, Promise<NoteFormat>>();
const keyOf = (syncDir?: string): string => syncDir ?? '';

/** The format of the vault at `syncDir`, asked of the main process once (concurrent callers share the answer) and then remembered. */
export function vaultFormatOf(
  api: { getVaultFormat?: (syncDir?: string) => Promise<{ success: boolean; data?: NoteFormat }> },
  syncDir?: string,
): Promise<NoteFormat> {
  const key = keyOf(syncDir);
  const known = formats.get(key);
  if (known) return Promise.resolve(known);
  let pending = asking.get(key);
  if (!pending) {
    pending = (async () => {
      const res = await api.getVaultFormat?.(syncDir).catch(() => undefined);
      const format: NoteFormat = res?.success && res.data === 'markdown' ? 'markdown' : 'html';
      formats.set(key, format);
      return format;
    })().finally(() => asking.delete(key));
    asking.set(key, pending);
  }
  return pending;
}

/** The remembered format, or 'html' if it has not been asked yet (callers that need it have already read a note). */
export function peekVaultFormat(syncDir?: string): NoteFormat {
  return formats.get(keyOf(syncDir)) ?? 'html';
}

/** After a migration (or a change from outside): forget what was remembered. */
export function forgetVaultFormat(syncDir?: string): void {
  if (syncDir === undefined) { formats.clear(); asking.clear(); }
  else { formats.delete(keyOf(syncDir)); asking.delete(keyOf(syncDir)); }
}
