// Evernote export (.enex) into the vault: each note a Markdown (or HTML) note under Evernote/<notebook>/, its attachments in the vault's
// attachments folder, and a report of what did not come across whole. The file work is injected so this can be tested on a plain directory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NoteFormat } from '../shared/vault/format';
import type { DomEnv } from '../shared/markdown/html';
import { convertHtmlNote } from '../shared/markdown/migrate';
import { prependFrontmatterComment } from '../shared/markdown/frontmatter';
import { detectImage, attachmentName, MAX_ATTACHMENT_BYTES } from '../shared/vault/attachments';
import { enexFrontmatter, enmlToHtml, noteStem, parseEnexDate, type MediaRef } from '../shared/import/enex';
import { addFinding, createReport, type ImportReport } from '../shared/import/report';
import { readEnex, type EnexResource } from './enex-stream';

/** A file that is not a picture is kept as a file; past this size it is left out (and said so). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface EnexDeps {
  format: NoteFormat;
  dom: DomEnv;
  /** Folder for attachments, as the vault is set up to have it. */
  attachmentsFolder: string;
  /** Whether a path in the vault (relative) is already taken. */
  exists: (rel: string) => boolean;
  /** Write a file in the vault, creating its folders. */
  write: (rel: string, bytes: Uint8Array | string) => Promise<void>;
  /** The note names that were written, so the caller can update its indexes. */
  onNote?: (rel: string, content: string) => void;
}

const sha256 = (b: Uint8Array): string => crypto.createHash('sha256').update(b).digest('hex');

const extOf = (name: string): string => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? '').toLowerCase();
const MIME_EXT: Record<string, string> = { 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a', 'video/mp4': 'mp4', 'text/plain': 'txt', 'application/zip': 'zip' };

/** A file name for an attachment that is not a picture: what it was called, made safe, led by the start of its hash so two of one name differ. */
function fileAttachmentName(r: EnexResource, hash: string): string {
  const ext = extOf(r.fileName) || MIME_EXT[r.mime] || 'bin';
  const base = noteStem(r.fileName.replace(/\.[^.]*$/, '') || 'attachment').replace(/\s+/g, '_');
  return `${hash.slice(0, 8)}-${base}.${ext}`;
}

/** The notebook's name: the file's, which is what Evernote names an export after. */
export const notebookName = (file: string): string => noteStem(path.basename(file).replace(/\.enex$/i, '')) || 'Evernote';

export async function importEnex(deps: EnexDeps, file: string): Promise<ImportReport> {
  const notebook = notebookName(file);
  const report = createReport(path.basename(file));
  const folder = `Evernote/${notebook}`;
  const taken = new Set<string>();
  const free = (stem: string): string => {
    let name = `${folder}/${stem}.md`;
    for (let i = 1; deps.exists(name) || taken.has(name.toLowerCase()); i++) name = `${folder}/${stem}_${i}.md`;
    taken.add(name.toLowerCase());
    return name;
  };
  const stored = new Set<string>();

  for await (const en of readEnex(file)) {
    const title = en.title || 'Untitled';
    const where = `${notebook}/${title}`;
    const media = new Map<string, MediaRef>();
    for (const r of en.resources) {
      const display = r.fileName || `attachment.${MIME_EXT[r.mime] ?? 'bin'}`;
      if (r.data.length === 0) { addFinding(report, { note: where, level: 'skipped', message: `attachment "${display}" is empty` }); continue; }
      const image = detectImage(r.data);
      let rel: string;
      if (image) {
        if (r.data.length > MAX_ATTACHMENT_BYTES) { addFinding(report, { note: where, level: 'skipped', message: `image "${display}" is over 25 MB and was not imported` }); continue; }
        rel = `${deps.attachmentsFolder}/${attachmentName(sha256(r.data), image.ext)}`;
      } else {
        if (r.data.length > MAX_FILE_BYTES) { addFinding(report, { note: where, level: 'skipped', message: `file "${display}" is over 100 MB and was not imported` }); continue; }
        rel = `${deps.attachmentsFolder}/${fileAttachmentName(r, sha256(r.data))}`;
        addFinding(report, { note: where, level: 'formatting', message: `"${display}" is kept as a file next to your images and linked, not shown inside the note` });
      }
      if (!stored.has(rel) && !deps.exists(rel)) { await deps.write(rel, r.data); report.attachments++; }
      stored.add(rel);
      media.set(r.hash, { rel, name: display, image: image !== null });
    }

    const { html, findings } = enmlToHtml(en.content, deps.dom, media);
    for (const f of findings) addFinding(report, { note: where, level: f.level, message: f.message });
    const front = enexFrontmatter({ created: parseEnexDate(en.created), updated: parseEnexDate(en.updated), tags: en.tags, sourceUrl: en.sourceUrl, author: en.author });
    const withFront = prependFrontmatterComment(html, front ? front.trimEnd() : null);
    const converted = convertHtmlNote(withFront, deps.dom);
    // Words that are not in the result are the one thing a person must hear about; styling is a count, not an alarm
    if (converted.verdict === 'lossy') addFinding(report, { note: where, level: 'lossy', message: converted.findings[0] ?? 'some content was changed' });
    else if (converted.verdict === 'formatting') addFinding(report, { note: where, level: 'formatting', message: 'styling the editor does not have (colours, fonts, sizes) was dropped' });
    const content = deps.format === 'markdown' ? converted.text : withFront;
    const rel = free(noteStem(title));
    await deps.write(rel, content);
    deps.onNote?.(rel, content);
    report.imported++;
  }
  return report;
}

/** The fs-backed deps for a vault directory: writes are atomic enough for an import (temp file then rename). */
export function vaultWriter(vault: string, resolve: (vault: string, rel: string) => string = path.join): Pick<EnexDeps, 'exists' | 'write'> {
  return {
    exists: (rel) => { try { return fs.existsSync(resolve(vault, rel)); } catch { return true; } },
    write: async (rel, bytes) => {
      const target = resolve(vault, rel);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.promises.writeFile(tmp, bytes);
      await fs.promises.rename(tmp, target);
    },
  };
}
