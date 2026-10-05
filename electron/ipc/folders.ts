import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { validateFileName, validateFolderName } from '../ipc-utils';
import { deleteFolderMovingContentToRoot } from '../vault-ops';
import type { NoteRename } from '../../shared/vault/links';
import { getTargetDir, safeResolve } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { rewriteLinks } from '../core/rewrite';

// ─── Multi-folder / notebooks ─────────────────────────────────────────────────

// Read a short body preview (Apple Notes-style) from the first few KB of a
// note, skipping the frontmatter comment and the title heading.
async function readNotePreview(filePath: string): Promise<string> {
  try {
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, 4096, 0);
      const stripped = buf.toString('utf8', 0, bytesRead)
        .replace(/^\s*<!--noted-frontmatter:[\s\S]*?-->/i, '')  // frontmatter comment
        .replace(/^\s*#{1,6}\s+[^\n]*\n?/, '')                   // leading markdown heading
        .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i, '');        // leading HTML heading (the title)
      return stripped
        .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

async function scanNotesTree(targetDir: string) {
  interface TreeNoteEntry {
    name: string;
    path: string;
    stats: fs.Stats;
    preview: string;
  }
  interface TreeFolderResult {
    type: 'folder';
    name: string;
    notes: TreeNoteEntry[];
  }
  interface TreeRootResult {
    type: 'rootNote';
    name: string;
    path: string;
    stats: fs.Stats;
    preview: string;
  }

  const rootNotes: TreeNoteEntry[] = [];
  const folders: { name: string; notes: TreeNoteEntry[] }[] = [];

  const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
  
  const results = await Promise.all<(TreeFolderResult | TreeRootResult | null)>(entries.map(async (entry) => {
    if (entry.name.startsWith('.')) return null;
    if (entry.isDirectory()) {
      const folderPath = path.join(targetDir, entry.name);
      try {
        const files = await fs.promises.readdir(folderPath);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        const folderNotes: TreeNoteEntry[] = [];
        for (const f of mdFiles) {
          const relName = `${entry.name}/${f}`;
          try {
            validateFileName(relName);
          } catch {
            continue;
          }
          try {
            const p = path.join(folderPath, f);
            const stat = await fs.promises.stat(p);
            const preview = await readNotePreview(p);
            folderNotes.push({ name: relName, path: p, stats: stat, preview });
          } catch {
            // Skip unreadable entries and continue
          }
        }
        
        folderNotes.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
        return { type: 'folder', name: entry.name, notes: folderNotes };
      } catch {
        return null;
      }
    } else if (entry.name.endsWith('.md')) {
      try {
        validateFileName(entry.name);
      } catch {
        return null;
      }
      const p = path.join(targetDir, entry.name);
      try {
        const stat = await fs.promises.stat(p);
        const preview = await readNotePreview(p);
        return { type: 'rootNote', name: entry.name, path: p, stats: stat, preview };
      } catch {
        return null;
      }
    }
    return null;
  }));

  for (const res of results) {
    if (!res) continue;
    if (res.type === 'folder') {
      folders.push({ name: res.name, notes: res.notes });
    } else if (res.type === 'rootNote') {
      rootNotes.push({ name: res.name, path: res.path, stats: res.stats, preview: res.preview });
    }
  }

  rootNotes.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
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
      validateFolderName(folderName);
      const targetDir = getTargetDir(syncDir);
      const folderPath = safeResolve(targetDir, folderName);
      if (fs.existsSync(folderPath)) throw new Error(`Folder "${folderName}" already exists`);
      fs.mkdirSync(folderPath);
      fullTextSearchIndex.markDirty(targetDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('rename-folder', async (_, oldName: string, newName: string, syncDir?: string, opts?: { updateLinks?: boolean }) => {
    try {
      validateFolderName(oldName);
      validateFolderName(newName);
      const targetDir = getTargetDir(syncDir);
      const oldPath = safeResolve(targetDir, oldName);
      const newPath = safeResolve(targetDir, newName);
      if (!fs.existsSync(oldPath)) throw new Error(`Folder "${oldName}" not found`);
      if (fs.existsSync(newPath)) throw new Error(`Folder "${newName}" already exists`);
      // Which notes are in the folder, before it moves (the index is by note name).
      await vaultIndex.ensure(targetDir);
      const renames: NoteRename[] = vaultIndex.names(targetDir)
        .filter((n) => n.startsWith(`${oldName}/`))
        .map((n) => ({ from: n, to: `${newName}/${n.slice(oldName.length + 1)}` }));
      fs.renameSync(oldPath, newPath);
      fullTextSearchIndex.markDirty(targetDir);
      await vaultIndex.reconcile(targetDir);
      const links = opts?.updateLinks && renames.length ? await rewriteLinks(targetDir, renames) : undefined;
      return { success: true, links };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('delete-folder', async (_, folderName: string, syncDir?: string, opts?: { updateLinks?: boolean }) => {
    try {
      validateFolderName(folderName);
      const targetDir = getTargetDir(syncDir);
      const folderPath = safeResolve(targetDir, folderName);
      if (!fs.existsSync(folderPath)) throw new Error(`Folder "${folderName}" not found`);
      // Moves the folder's contents to the root without ever overwriting a note
      // that's already there, then removes the folder.
      await vaultIndex.ensure(targetDir);
      const { moved, renamed, moves } = deleteFolderMovingContentToRoot(targetDir, folderName, safeResolve);
      fullTextSearchIndex.markDirty(targetDir);
      await vaultIndex.reconcile(targetDir);
      const links = opts?.updateLinks && moves.length ? await rewriteLinks(targetDir, moves) : undefined;
      return { success: true, data: { moved, renamed }, links };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('move-note', async (_, fileName: string, toFolder: string, syncDir?: string, opts?: { updateLinks?: boolean }) => {
    try {
      validateFileName(fileName);
      if (toFolder !== '') validateFolderName(toFolder);
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
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
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
