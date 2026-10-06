import { ipcMain } from 'electron';
import { validateFileName } from '../ipc-utils';
import { assertNotMigrating } from '../core/migrating';
import { getTargetDir } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { linkRewriteDeps } from '../core/rewrite';
import { readVaultFormat } from '../../shared/vault/formatFile';
import { noteFormatIn } from '../../shared/vault/noteFormat';
import { buildLinkResolver } from '../../shared/vault/resolve';
import { findMentions, linkMention, snippetAround, type Snippet } from '../../shared/vault/mentions';

const MAX_LISTED = 50;

export interface UnlinkedMention {
  name: string;
  /** How many places in the note mention it. */
  count: number;
  snippet: Snippet;
}

/** The names a note answers to: its own (without folder and extension) and its aliases. */
function namesOf(noteName: string, aliases: readonly string[]): string[] {
  const stem = noteName.replace(/\.md$/i, '');
  return [stem.slice(stem.lastIndexOf('/') + 1), ...aliases];
}

export function registerMentionHandlers(): void {
  // Notes that write this note's title (or an alias) as plain text without linking to it. Candidates come from the
  // search index; only those are read, and each read is checked for the exact phrase outside code, links and markup.
  ipcMain.handle('unlinked-mentions', async (_, noteName: unknown, syncDir?: string) => {
    try {
      validateFileName(noteName);
      const dir = getTargetDir(syncDir);
      await vaultIndex.ensure(dir);
      const entry = vaultIndex.get(dir, noteName);
      const phrases = namesOf(noteName, entry?.aliases ?? []);
      const alreadyLinking = new Set(vaultIndex.backlinks(dir, noteName));
      const vaultFormat = readVaultFormat(dir);
      const { readNote } = linkRewriteDeps(dir);

      const candidates = (await fullTextSearchIndex.notesMatching(dir, phrases, name => validateFileName(name)))
        .filter(name => name !== noteName && !alreadyLinking.has(name));
      const items: UnlinkedMention[] = [];
      for (const name of candidates) {
        if (items.length >= MAX_LISTED) break;
        let raw: string;
        try { raw = await readNote(name); } catch { continue; }
        const format = noteFormatIn(vaultFormat, raw);
        const found = findMentions(raw, phrases, format);
        if (found.length > 0) items.push({ name, count: found.length, snippet: snippetAround(raw, found[0], format) });
      }
      return { success: true, data: { items } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Turn the first plain-text mention of `target` in `source` into a [[link]]. The note's previous text goes to its
  // history; the change is announced like any outside change, so an open editor reloads it.
  ipcMain.handle('link-mention', async (_, source: unknown, target: unknown, syncDir?: string) => {
    try {
      assertNotMigrating();
      validateFileName(source);
      validateFileName(target);
      const dir = getTargetDir(syncDir);
      await vaultIndex.ensure(dir);
      const deps = linkRewriteDeps(dir);
      const raw = await deps.readNote(source);
      const format = noteFormatIn(readVaultFormat(dir), raw);
      const phrases = namesOf(target, vaultIndex.get(dir, target)?.aliases ?? []);
      const found = findMentions(raw, phrases, format);
      if (found.length === 0) return { success: false, error: 'The mention is not there any more' };

      // The shortest text that finds the target from the source: its name, or its path when the name is shared.
      const stem = target.replace(/\.md$/i, '');
      const aliases: Record<string, string[]> = {};
      for (const name of vaultIndex.names(dir)) {
        const list = vaultIndex.get(dir, name)?.aliases;
        if (list?.length) aliases[name] = list;
      }
      const resolver = buildLinkResolver(vaultIndex.names(dir), aliases);
      const bare = stem.slice(stem.lastIndexOf('/') + 1);
      const written = resolver.resolve(bare, source) === target ? bare : stem;

      const next = linkMention(raw, found[0], written, format);
      await deps.snapshotBefore(source, raw);
      await deps.writeNote(source, next);
      return { success: true, data: { remaining: found.length - 1 } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
