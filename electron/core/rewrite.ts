import fs from 'node:fs';
import { validateFileName } from '../ipc-utils';
import { applyRewrite, applyHeadingRewrite, previewHeadingRewrite, type HeadingChange, type RewriteDeps, type RewriteOutcome } from '../link-rewrite';
import type { NoteRename } from '../../shared/vault/links';
import type { MigrationDeps } from '../attachments';
import { DEFAULT_ATTACHMENTS_FOLDER } from '../../shared/vault/attachments';
import { obsidianAttachmentsFolder } from '../../shared/vault/obsidian';
import { logEvent } from '../structured-log';
import { safeResolve } from './paths';
import { saveSnapshot, writeNoteAtomic } from './note-io';
import { fullTextSearchIndex, vaultIndex } from './services';

/**
 * How link rewriting touches the vault. Deliberately NOT marked as an app write:
 * the file watcher then reports each rewritten note like any external change, so
 * a note open in the editor is reloaded (or, if the user is typing, kept beside
 * the other version) instead of being overwritten by the editor's stale buffer.
 */
export function linkRewriteDeps(targetDir: string): RewriteDeps {
  return {
    vaultIndex,
    readNote: (name) => fs.promises.readFile(safeResolve(targetDir, name), 'utf-8'),
    snapshotBefore: (name, previous) => saveSnapshot(targetDir, name, previous, { force: true }),
    writeNote: async (name, content) => {
      await writeNoteAtomic(targetDir, name, content);
      fullTextSearchIndex.upsertFromRaw(targetDir, name, content);
      vaultIndex.upsertFromRaw(targetDir, name, content);
    },
  };
}

/** Note access for operations that rewrite many notes (image migration, orphan checks). */
export function vaultNoteDeps(targetDir: string) {
  return {
    ...linkRewriteDeps(targetDir),
    // The full index, not RewriteDeps' narrow view of it: image operations also query it.
    vaultIndex,
  } satisfies MigrationDeps & { readNote: (name: string) => Promise<string> };
}

export interface LinkUpdateResult { notes: number; links: number; failed: number }

export async function rewriteLinks(targetDir: string, renames: NoteRename[]): Promise<LinkUpdateResult> {
  const out: RewriteOutcome = await applyRewrite(targetDir, renames, linkRewriteDeps(targetDir));
  if (out.failed.length > 0) logEvent('warn', 'link_rewrite_partial', { failed: out.failed.length, first: out.failed[0].error });
  logEvent('info', 'link_rewrite', { renames: renames.length, notes: out.notes.length, links: out.links });
  return { notes: out.notes.length, links: out.links, failed: out.failed.length };
}

export async function rewriteHeadingLinksIn(targetDir: string, change: HeadingChange): Promise<LinkUpdateResult> {
  const out: RewriteOutcome = await applyHeadingRewrite(targetDir, change, linkRewriteDeps(targetDir));
  if (out.failed.length > 0) logEvent('warn', 'heading_link_rewrite_partial', { failed: out.failed.length, first: out.failed[0].error });
  logEvent('info', 'heading_link_rewrite', { renames: change.renames.length, notes: out.notes.length, links: out.links });
  return { notes: out.notes.length, links: out.links, failed: out.failed.length };
}

export const previewHeadingLinks = (targetDir: string, change: HeadingChange): Promise<{ notes: number; links: number }> =>
  previewHeadingRewrite(targetDir, change, linkRewriteDeps(targetDir));

const MAX_HEADINGS = 2000;
const MAX_HEADING_CHARS = 500;

/** Validate a renderer-supplied heading change (untrusted). */
export function parseHeadingChange(input: unknown): HeadingChange {
  const { note, oldHeadings, renames } = (input ?? {}) as { note?: unknown; oldHeadings?: unknown; renames?: unknown };
  if (typeof note !== 'string') throw new Error('Invalid heading change');
  validateFileName(note);
  const text = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_HEADING_CHARS;
  if (!Array.isArray(oldHeadings) || oldHeadings.length > MAX_HEADINGS || !oldHeadings.every(text)) throw new Error('Invalid heading change');
  if (!Array.isArray(renames) || renames.length > MAX_HEADINGS) throw new Error('Invalid heading change');
  return {
    note,
    oldHeadings,
    renames: renames.map(r => {
      const { index, to } = (r ?? {}) as { index?: unknown; to?: unknown };
      if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= oldHeadings.length || !text(to)) throw new Error('Invalid heading rename');
      return { index: index as number, to };
    }),
  };
}

/** Validate a renderer-supplied rename list (untrusted). */
export function parseRenames(input: unknown): NoteRename[] {
  if (!Array.isArray(input) || input.length > 5000) throw new Error('Invalid renames');
  return input.map((r) => {
    const { from, to } = (r ?? {}) as { from?: unknown; to?: unknown };
    if (typeof from !== 'string' || typeof to !== 'string') throw new Error('Invalid rename');
    validateFileName(from);
    validateFileName(to);
    return { from, to };
  });
}
/**
 * The attachments folder for a vault: the one Obsidian uses when the vault is an Obsidian vault with a fixed
 * folder (so both apps keep finding each other's images), else the one the renderer asks for; anything invalid
 * falls back to the default.
 */
export const attachmentsFolderFor = (vaultDir: string, requested: unknown): string =>
  obsidianAttachmentsFolder(vaultDir) ?? (typeof requested === 'string' && requested ? requested : DEFAULT_ATTACHMENTS_FOLDER);
