import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { validateFileName, validateFolderPath } from '../ipc-utils';
import { dissolveFolder, moveFolder } from '../vault-ops';
import { walkVault } from '../../shared/vault/walk';
import { dirnameOf } from '../../shared/vault/paths';
import { assertNotMigrating } from '../core/migrating';
import { getTargetDir, safeResolve } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { rewriteLinks } from '../core/rewrite';
import { notePreview } from '../../shared/search/textExtract';

// ─── Multi-folder / notebooks ─────────────────────────────────────────────────

// Read a short body preview (Apple Notes-style) from the first few KB of a
// note, skipping the frontmatter and the title heading (HTML or Markdown note).
async function readNotePreview(filePath: string): Promise<string> {
  try {
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, 4096, 0);
      return notePreview(buf.toString('utf8', 0, bytesRead));
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

interface TreeNoteEntry {
  name: string;
  path: string;
  stats: fs.Stats;
  preview: string;
}

/** Run `fn` over `items` with at most `limit` in flight (a vault of thousands of notes must not open them all at once). */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/**
 * The vault as the sidebar wants it: the notes at the root, and every folder at any depth (empty ones too) with the
 * notes directly in it. A folder's `name` is its full path ("Work/Q4"), so the renderer can build the tree from it.
 */
export async function scanNotesTree(targetDir: string) {
  const walked = await walkVault(targetDir);
  const entries = (await mapLimit(walked.notes, 32, async (name): Promise<TreeNoteEntry | null> => {
    const p = path.join(targetDir, name);
    try {
      const stat = await fs.promises.stat(p);
      return { name, path: p, stats: stat, preview: await readNotePreview(p) };
    } catch {
      return null; // gone or unreadable: skip it and carry on
    }
  })).filter((e): e is TreeNoteEntry => e !== null);

  const byFolder = new Map<string, TreeNoteEntry[]>(walked.folders.map(f => [f, []]));
  const rootNotes: TreeNoteEntry[] = [];
  for (const entry of entries) {
    const folder = dirnameOf(entry.name);
    if (!folder) rootNotes.push(entry);
    else byFolder.get(folder)?.push(entry);
  }
  const newestFirst = (a: TreeNoteEntry, b: TreeNoteEntry): number => b.stats.mtimeMs - a.stats.mtimeMs;
  rootNotes.sort(newestFirst);
  const folders = walked.folders.map(name => ({ name, notes: (byFolder.get(name) ?? []).sort(newestFirst) }));
  return { rootNotes, folders };
}

export function registerFoldersHandlers(): void {
  ipcMain.handle('get-notes-tree', async (_, syncDir?: string) => {
    try {
      if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
      const targetDir = getTargetDir(syncDir);
      const data = await scanNotesTree(targetDir);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('create-folder', (_, folderName: string, syncDir?: string) => {
    try {
      validateFolderPath(folderName);
      const targetDir = getTargetDir(syncDir);
      const folderPath = safeResolve(targetDir, folderName);
      if (fs.existsSync(folderPath)) throw new Error(`Folder "${folderName}" already exists`);
      // A new folder goes inside a folder that exists ("Work/Q4" needs "Work"): not a way to build a tree by typing a path.
      const parent = dirnameOf(folderName);
      if (parent && !fs.existsSync(safeResolve(targetDir, parent))) throw new Error(`The folder "${parent}" does not exist`);
      fs.mkdirSync(folderPath);
      fullTextSearchIndex.markDirty(targetDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Rename a folder, or move it under another folder: `newName` is its new full path ("Archive/Q4").
  ipcMain.handle('rename-folder', async (_, oldName: string, newName: string, syncDir?: string, opts?: { updateLinks?: boolean }) => {
    try {
      assertNotMigrating();
      validateFolderPath(oldName);
      validateFolderPath(newName);
      const targetDir = getTargetDir(syncDir);
      // Every note under the folder changes name; the index lets the links to them follow.
      await vaultIndex.ensure(targetDir);
      const { moves } = moveFolder(targetDir, oldName, newName, safeResolve);
      fullTextSearchIndex.markDirty(targetDir);
      await vaultIndex.reconcile(targetDir);
      const links = opts?.updateLinks && moves.length ? await rewriteLinks(targetDir, moves) : undefined;
      return { success: true, data: { moves: moves.length }, links };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Delete a folder, keeping what is in it: everything moves up one level (to the vault root for a top-level folder).
  ipcMain.handle('delete-folder', async (_, folderName: string, syncDir?: string, opts?: { updateLinks?: boolean }) => {
    try {
      assertNotMigrating();
      validateFolderPath(folderName);
      const targetDir = getTargetDir(syncDir);
      await vaultIndex.ensure(targetDir);
      const { moved, renamed, moves, folderKept } = dissolveFolder(targetDir, folderName, safeResolve);
      fullTextSearchIndex.markDirty(targetDir);
      await vaultIndex.reconcile(targetDir);
      const links = opts?.updateLinks && moves.length ? await rewriteLinks(targetDir, moves) : undefined;
      return { success: true, data: { moved, renamed, folderKept }, links };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('move-note', async (_, fileName: string, toFolder: string, syncDir?: string, opts?: { updateLinks?: boolean }) => {
    try {
      assertNotMigrating();
      validateFileName(fileName);
      if (toFolder !== '') validateFolderPath(toFolder);
      const targetDir = getTargetDir(syncDir);
      // fileName may already include a folder prefix
      const baseName = path.basename(fileName);
      const srcPath = safeResolve(targetDir, fileName);
      const destPath = toFolder
        ? safeResolve(targetDir, `${toFolder}/${baseName}`)
        : safeResolve(targetDir, baseName);
      if (!fs.existsSync(srcPath)) throw new Error(`Note "${fileName}" not found`);
      if (fs.existsSync(destPath)) throw new Error(`A note named "${baseName}" already exists at the destination`);
      if (toFolder) {
        const folderPath = safeResolve(targetDir, toFolder);
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
      }
      fs.renameSync(srcPath, destPath);
      const movedRelPath = toFolder ? `${toFolder}/${baseName}` : baseName;
      fullTextSearchIndex.renameDoc(targetDir, fileName, movedRelPath);
      vaultIndex.renameDoc(targetDir, fileName, movedRelPath);
      const links = opts?.updateLinks ? await rewriteLinks(targetDir, [{ from: fileName, to: movedRelPath }]) : undefined;
      return { success: true, data: movedRelPath, links };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
