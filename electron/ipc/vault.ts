import { ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { validateFileName } from '../ipc-utils';
import { writeVaultConfig, isValidRetentionDays } from '../../shared/vault-config';
import { previewRewrite } from '../link-rewrite';
import { readVaultFormat } from '../../shared/vault/formatFile';
import { logEvent, newRequestId } from '../structured-log';
import { getTargetDir, blessVaultRoot, isBlessedRoot, setActiveVaultDir } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { startVaultWatch } from '../core/watcher';
import { rewriteLinks, parseRenames, linkRewriteDeps } from '../core/rewrite';

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
      return { success: true, data: readVaultFormat(getTargetDir(syncDir)) };
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
          title: 'Export vault to folder',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Export here',
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
