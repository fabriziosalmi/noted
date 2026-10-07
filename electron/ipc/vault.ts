import { ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { validateFileName } from '../ipc-utils';
import { writeVaultConfig, isValidRetentionDays } from '../../shared/vault-config';
import { previewRewrite } from '../link-rewrite';
import { readVaultFormat } from '../../shared/vault/formatFile';
import { readViews, writeViews } from '../../shared/views/file';
import { setProperty } from '../note-properties';
import { toggleTask } from '../note-tasks';
import { approvePending, rejectPending } from '../pending-changes';
import { revertEntries } from '../journal-revert';
import { appendEntry, readBlob, readEntries } from '../../shared/vault/journalFile';
import { verifyChain } from '../../shared/vault/journal';
import { revertedIds } from '../../shared/vault/journalTypes';
import { listPending } from '../../shared/vault/pendingFile';
import { MAX_PENDING_BYTES } from '../../shared/vault/pending';
import { lintVaultDir } from '../vault-lint';
import { moveToTrash } from '../../mcp-server/trash';
import { isAccess, parsePolicy, serializePolicy, MAX_POLICY_FOLDERS, type McpPolicy } from '../../shared/vault/mcpPolicy';
import { loadPolicy, savePolicy } from '../../shared/vault/mcpPolicyFile';
import { queryTasks, localDay, type TaskFilter } from '../../shared/tasks/query';
import { isFieldValue, type FieldValue } from '../../shared/vault/fields';
import { MAX_FIELD_CHARS } from '../../shared/views/model';
import { isObsidianVault } from '../../shared/vault/obsidian';
import { logEvent, newRequestId } from '../structured-log';
import { assertNotMigrating } from '../core/migrating';
import { tr } from '../core/language';
import { getTargetDir, blessVaultRoot, isBlessedRoot, setActiveVaultDir } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { startVaultWatch } from '../core/watcher';
import { rewriteLinks, parseRenames, linkRewriteDeps, rewriteHeadingLinksIn, previewHeadingLinks, parseHeadingChange } from '../core/rewrite';

const MAX_LISTED_TASKS = 2000;
const MAX_LISTED_JOURNAL = 1000;

/** The filter a renderer sent, kept to what it may contain (untrusted). */
function parseTaskFilter(input: unknown): TaskFilter {
  const f = (input ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.length <= max && v !== '' ? v : undefined);
  const day = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const status = f.status === 'done' || f.status === 'all' ? f.status : 'open';
  return {
    status, folder: text(f.folder), tag: text(f.tag), text: text(f.text),
    dueFrom: day(f.dueFrom), dueTo: day(f.dueTo), overdue: f.overdue === true || undefined, noDue: f.noDue === true || undefined,
  };
}

export function registerVaultHandlers(): void {
  // The renderer's configured vault directory, mirrored in main so windows that
  // have no access to the store (quick-capture) still write into the right vault.
  ipcMain.on('set-active-vault-dir', (_e, dir: unknown) => {
    setActiveVaultDir(dir);
    startVaultWatch();
  });

  // Settings the MCP server (possibly started by another program) must share with
  // the app live in <vault>/.noted/config.json; the renderer pushes them here.
  // How this vault's notes are stored on disk (shared/vault/format.ts); the renderer converts to and from it.
  ipcMain.handle('get-vault-format', (_, syncDir?: string) => {
    try {
      if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
      const dir = getTargetDir(syncDir);
      return { success: true, data: readVaultFormat(dir), shared: isObsidianVault(dir) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('set-vault-config', (_, config: { trashRetentionDays?: unknown }, syncDir?: string) => {
    try {
      if (typeof config !== 'object' || config === null) throw new Error('Invalid config');
      const patch: { trashRetentionDays?: number } = {};
      if (config.trashRetentionDays !== undefined) {
        if (!isValidRetentionDays(config.trashRetentionDays)) throw new Error('trashRetentionDays must be a whole number from 0 to 3650');
        patch.trashRetentionDays = config.trashRetentionDays;
      }
      writeVaultConfig(getTargetDir(syncDir), patch);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('select-sync-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false };
    }
    // A native folder pick is a trusted user gesture — bless it as a vault root.
    blessVaultRoot(result.filePaths[0]);
    return { success: true, data: result.filePaths[0] };
  });

  // ─── Export vault / Share note ───────────────────────────────────────────────

  ipcMain.handle('copy-vault-to-folder', async (_, args: { destDir?: string; syncDir?: string }) => {
    try {
      const srcDir = getTargetDir(args?.syncDir);
      let destDir: string = args?.destDir ?? '';
      // Only a blessed destination (native pick or the trusted iCloud path) may be
      // used without prompting — never an arbitrary renderer-supplied path.
      if (destDir && !isBlessedRoot(destDir)) destDir = '';
      if (!destDir) {
        const { filePaths, canceled } = await dialog.showOpenDialog({
          title: tr('dlgExportVault'),
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: tr('dlgExportHere'),
        });
        if (canceled || !filePaths.length) return { success: false, canceled: true };
        destDir = filePaths[0];
        blessVaultRoot(destDir);
      }
      let copied = 0;
      function copyDir(src: string, dest: string) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            copyDir(path.join(src, entry.name), path.join(dest, entry.name));
          } else if (entry.name.endsWith('.md')) {
            fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
            copied++;
          } else if (/\.(png|jpe?g|gif|webp)$/i.test(entry.name)) {
            // Attachments travel with the notes that show them (not counted as notes).
            fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
          }
        }
      }
      copyDir(srcDir, destDir);
      return { success: true, data: { copied, destDir } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ─── Full-text search ─────────────────────────────────────────────────────────

  ipcMain.handle('search-notes-fulltext', async (_, query: string, syncDir?: string) => {
    const reqId = newRequestId('search-ft');
    if (!query || query.trim().length < 2) return { success: true, data: [] };
    const dir = getTargetDir(syncDir);
    const { results, truncated } = await fullTextSearchIndex.search(dir, query, (name) => validateFileName(name));
    logEvent('info', 'search_fulltext_completed', {
      reqId,
      queryLen: query.length,
      resultCount: results.length,
      truncated,
    });
    return { success: true, data: results, truncated };
  });

  // ─── Link updates after renames ───────────────────────────────────────────────

  // How many notes/links WOULD change for these renames — for the "Ask" setting.
  ipcMain.handle('preview-link-rewrite', async (_, renames: unknown, syncDir?: string) => {
    try {
      const dir = getTargetDir(syncDir);
      await vaultIndex.ensure(dir);
      return { success: true, data: await previewRewrite(dir, parseRenames(renames), linkRewriteDeps(dir)) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // The vault's saved views (`.noted-views.json`): read, and replace as a whole.
  ipcMain.handle('views-load', async (_, syncDir?: string) => {
    try {
      return { success: true, data: readViews(getTargetDir(syncDir)) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('views-save', async (_, views: unknown, syncDir?: string) => {
    try {
      assertNotMigrating();
      return { success: true, data: writeViews(getTargetDir(syncDir), views) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // What agents (MCP clients) may reach: the policy file the MCP server enforces.
  ipcMain.handle('get-mcp-policy', (_, syncDir?: string) => {
    try {
      const loaded = loadPolicy(getTargetDir(syncDir));
      return { success: true, data: loaded.ok ? { policy: loaded.policy, present: loaded.present } : { error: loaded.error } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('set-mcp-policy', (_, policy: unknown, syncDir?: string) => {
    try {
      const p = (policy ?? {}) as { default?: unknown; folders?: unknown };
      if (!isAccess(p.default) || typeof p.folders !== 'object' || p.folders === null || Array.isArray(p.folders)) throw new Error('Invalid policy');
      const entries = Object.entries(p.folders as Record<string, unknown>);
      if (entries.length > MAX_POLICY_FOLDERS) throw new Error('Too many folders');
      const checked = parsePolicy(serializePolicy({ default: p.default, folders: Object.fromEntries(entries.filter(([, a]) => isAccess(a))) as McpPolicy['folders'] }));
      if (!checked.ok || entries.some(([, a]) => !isAccess(a))) throw new Error(checked.ok ? 'Invalid access' : checked.error);
      savePolicy(getTargetDir(syncDir), checked.policy);
      return { success: true, data: { policy: checked.policy } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Changes agents proposed where their writes need approval (policy `staged`): list, approve, reject.
  ipcMain.handle('list-pending-changes', (_, syncDir?: string) => {
    try {
      return { success: true, data: listPending(getTargetDir(syncDir)) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // The health check of the whole vault (see shared/lint/vaultLint.ts): read from the indexes, nothing is changed.
  ipcMain.handle('vault-lint', async (_, opts: unknown, syncDir?: string) => {
    try {
      const o = (opts ?? {}) as { staleDays?: unknown };
      const staleDays = typeof o.staleDays === 'number' && Number.isFinite(o.staleDays) ? Math.max(7, Math.min(3650, Math.round(o.staleDays))) : undefined;
      const dir = getTargetDir(syncDir);
      return { success: true, data: await lintVaultDir(dir, { vaultIndex, fullText: fullTextSearchIndex, validate: name => validateFileName(name) }, staleDays ? { staleDays } : {}) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('settle-pending-change', async (_, id: unknown, approve: unknown, syncDir?: string, content?: unknown) => {
    try {
      if (typeof id !== 'string' || typeof approve !== 'boolean') throw new Error('Invalid request');
      if (content !== undefined && (typeof content !== 'string' || !approve || content.length > MAX_PENDING_BYTES)) throw new Error('Invalid request');
      const dir = getTargetDir(syncDir);
      if (!approve) return rejectPending(dir, id).ok ? { success: true } : { success: false, error: 'that change is no longer waiting' };
      assertNotMigrating();
      const files = linkRewriteDeps(dir);
      const out = await approvePending({
        notesDir: dir,
        readNote: async name => { try { return await files.readNote(name); } catch { return null; } },
        snapshotBefore: files.snapshotBefore,
        writeNote: files.writeNote,
        trashNote: name => { moveToTrash(dir, name); fullTextSearchIndex.deleteDoc(dir, name); vaultIndex.deleteDoc(dir, name); },
        record: entry => { appendEntry(dir, { ...entry, session: `approval-${id}`, via: 'approval' }); },
      }, id, { content });
      return out.ok ? { success: true } : { success: false, error: out.error, conflict: out.conflict };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // The agent journal: what assistants changed, who, when; look at one, and undo.
  ipcMain.handle('journal-list', (_, syncDir?: string) => {
    try {
      const dir = getTargetDir(syncDir);
      const { entries, damaged } = readEntries(dir);
      const check = damaged > 0 ? { ok: false as const, at: 0, reason: `${damaged} line(s) are not entries` } : verifyChain(entries);
      return { success: true, data: { entries: entries.slice(-MAX_LISTED_JOURNAL).reverse(), total: entries.length, reverted: [...revertedIds(entries)], chain: check } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('journal-diff', (_, id: unknown, syncDir?: string) => {
    try {
      if (typeof id !== 'string') throw new Error('Invalid entry');
      const dir = getTargetDir(syncDir);
      const entry = readEntries(dir).entries.find(e => e.id === id);
      if (!entry) throw new Error('no such entry');
      const blob = (hash: string | null) => (hash === null ? { text: '', kept: true } : { text: readBlob(dir, hash) ?? '', kept: readBlob(dir, hash) !== null });
      const before = blob(entry.beforeHash);
      const after = blob(entry.afterHash);
      return { success: true, data: { before: before.text, after: after.text, kept: before.kept && after.kept } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('journal-revert', async (_, ids: unknown, syncDir?: string) => {
    try {
      assertNotMigrating();
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every(i => typeof i === 'string')) throw new Error('Invalid entries');
      const dir = getTargetDir(syncDir);
      const files = linkRewriteDeps(dir);
      const results = await revertEntries({
        notesDir: dir,
        readNote: async name => { try { return await files.readNote(name); } catch { return null; } },
        snapshotBefore: files.snapshotBefore,
        writeNote: files.writeNote,
        trashNote: name => { moveToTrash(dir, name); fullTextSearchIndex.deleteDoc(dir, name); vaultIndex.deleteDoc(dir, name); },
      }, ids as string[]);
      return { success: true, data: results };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Tasks across the vault (`- [ ]` items of Markdown notes), filtered, and one of them ticked in its note.
  ipcMain.handle('list-tasks', async (_, filter: unknown, syncDir?: string) => {
    try {
      const dir = getTargetDir(syncDir);
      await vaultIndex.ensure(dir);
      await vaultIndex.reconcile(dir);
      const f = parseTaskFilter(filter);
      const all = queryTasks(vaultIndex.tasks(dir), f, localDay(new Date()));
      return { success: true, data: { tasks: all.slice(0, MAX_LISTED_TASKS), total: all.length, format: readVaultFormat(dir) } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('toggle-task', async (_, name: unknown, line: unknown, text: unknown, done: unknown, syncDir?: string) => {
    try {
      assertNotMigrating();
      if (typeof name !== 'string' || !Number.isInteger(line) || (line as number) < 1 || typeof text !== 'string' || typeof done !== 'boolean') throw new Error('Invalid task');
      validateFileName(name);
      const dir = getTargetDir(syncDir);
      const out = await toggleTask({ ...linkRewriteDeps(dir), format: readVaultFormat(dir) }, name, line as number, text, done);
      return out.ok ? { success: true, data: { changed: out.changed } } : { success: false, error: out.error };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // One property of one note, changed in the file (a cell of a view, a card moved to another column). `expect` makes it
  // compare-and-set: it is written only if the property still holds what the caller last saw.
  ipcMain.handle('set-note-property', async (_, name: unknown, key: unknown, value: unknown, expect: unknown, syncDir?: string) => {
    try {
      assertNotMigrating();
      if (typeof name !== 'string' || typeof key !== 'string' || key.length === 0 || key.length > MAX_FIELD_CHARS) throw new Error('Invalid property');
      validateFileName(name);
      if (value !== undefined && !isFieldValue(value)) throw new Error('Invalid property value');
      const wanted = expect as { value?: unknown } | undefined;
      if (wanted !== undefined && wanted !== null && wanted.value !== undefined && !isFieldValue(wanted.value)) throw new Error('Invalid property value');
      const dir = getTargetDir(syncDir);
      const out = await setProperty(
        { ...linkRewriteDeps(dir), format: readVaultFormat(dir) },
        name, key, value, wanted ? { value: wanted.value as FieldValue | undefined } : undefined,
      );
      return out.ok ? { success: true, data: { changed: out.changed, fields: out.fields } } : { success: false, error: out.error, conflict: out.conflict, fields: out.fields };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // A heading renamed: how many notes/links point at it (for "Ask"), and the rewrite itself.
  ipcMain.handle('preview-heading-rewrite', async (_, change: unknown, syncDir?: string) => {
    try {
      const dir = getTargetDir(syncDir);
      await vaultIndex.ensure(dir);
      return { success: true, data: await previewHeadingLinks(dir, parseHeadingChange(change)) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('rewrite-heading-links', async (_, change: unknown, syncDir?: string) => {
    try {
      assertNotMigrating();
      const dir = getTargetDir(syncDir);
      await vaultIndex.ensure(dir);
      return { success: true, data: await rewriteHeadingLinksIn(dir, parseHeadingChange(change)) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ─── Retrieval for the AI chat ────────────────────────────────────────────────

  // The best-matching notes for a question from the WHOLE vault (BM25 over the
  // in-memory index), with their text; the renderer re-ranks this short list.
  ipcMain.handle('rag-candidates', async (_, query: unknown, limit: unknown, syncDir?: string) => {
    try {
      if (typeof query !== 'string' || query.length > 4000) throw new Error('Invalid query');
      const n = typeof limit === 'number' && Number.isFinite(limit) ? limit : 30;
      const dir = getTargetDir(syncDir);
      return { success: true, data: await fullTextSearchIndex.candidates(dir, query, n, (name) => validateFileName(name)) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Rewrite links for renames already done (title-driven renames are applied later,
  // once, instead of on every keystroke-pause).
  ipcMain.handle('rewrite-links', async (_, renames: unknown, syncDir?: string) => {
    try {
      assertNotMigrating();
      const dir = getTargetDir(syncDir);
      await vaultIndex.ensure(dir);
      return { success: true, data: await rewriteLinks(dir, parseRenames(renames)) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ─── Vault index IPC ──────────────────────────────────────────────────────────

  ipcMain.handle('vault-index-snapshot', async (_, syncDir?: string) => {
    return vaultIndex.snapshot(getTargetDir(syncDir));
  });

  // Everything the index knows about one note (headings, frontmatter keys, links
  // with alias/heading) — for features beyond the sidebar and backlinks.
  ipcMain.handle('vault-index-note', async (_, name: string, syncDir?: string) => {
    try {
      validateFileName(name);
      const dir = getTargetDir(syncDir);
      await vaultIndex.ensure(dir);
      const e = vaultIndex.get(dir, name);
      if (!e) return { success: false, error: 'Note not indexed' };
      return { success: true, data: { links: e.links, tags: e.tags, headings: e.headings, frontmatterKeys: e.frontmatterKeys } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
