import { ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateFileName } from '../ipc-utils';
import { assertNotMigrating } from '../core/migrating';
import { getTargetDir, safeResolve } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { markAppWrite, markAppDelete } from '../core/app-writes';
import { saveSnapshot, writeFileDurable, fsyncDir } from '../core/note-io';
import { rewriteLinks } from '../core/rewrite';
import { getMainWindow } from '../core/windows';

export function registerNotesHandlers(): void {
  // FS IPC Handlers
  ipcMain.handle('get-notes-list', async (_, syncDir?: string) => {
    try {
      if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
      const targetDir = getTargetDir(syncDir);
      const filenames = await fs.promises.readdir(targetDir);
      const files: { name: string; path: string; stats: fs.Stats }[] = [];
      for (const f of filenames) {
        if (!f.endsWith('.md')) continue;
        try {
          validateFileName(f);
        } catch {
          continue;
        }
        try {
          const p = path.join(targetDir, f);
          const stat = await fs.promises.stat(p);
          files.push({
            name: f,
            path: p,
            stats: stat
          });
        } catch {
          // Skip unreadable entries and continue
        }
      }
      files.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs); // Sort by modified time
      return { success: true, data: files };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('read-note', async (_, fileName: string, syncDir?: string) => {
    try {
      validateFileName(fileName);
      const targetDir = getTargetDir(syncDir);
      const filePath = safeResolve(targetDir, fileName);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { success: true, data: content };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('save-note', async (_, fileName: string, content: string, syncDir?: string) => {
    try {
      assertNotMigrating();
      validateFileName(fileName);
      if (typeof content !== 'string') throw new Error('Content must be a string');
      const targetDir = getTargetDir(syncDir);
      const filePath = safeResolve(targetDir, fileName);
      const isNewNote = !fs.existsSync(filePath);
      await saveSnapshot(targetDir, fileName, content);
      // Durable atomic write: write to a unique tmp sibling, fsync it, rename
      // (atomic on POSIX), then fsync the directory so the rename itself survives
      // a power loss. A unique suffix avoids two concurrent writes to the same
      // note sharing (and corrupting) one temp file.
      const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      await writeFileDurable(tmpPath, content);
      await fs.promises.rename(tmpPath, filePath);
      // Record our own write's mtime *before* the next await. fs.watch may deliver
      // the rename event during a later await (e.g. fsyncDir), and if markAppWrite
      // hasn't run yet the watcher can't recognise the write as ours and misfires
      // the "changed on disk" warning for the app's own save.
      markAppWrite(targetDir, fileName);
      await fsyncDir(path.dirname(filePath));
      fullTextSearchIndex.upsertFromRaw(targetDir, fileName, content);
      vaultIndex.upsertFromRaw(targetDir, fileName, content);
      if (isNewNote) {
        getMainWindow()?.webContents.send('refresh-notes');
      }
      return { success: true };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-note-history', async (_, fileName: string, syncDir?: string) => {
    try {
      validateFileName(fileName);
      const targetDir = getTargetDir(syncDir);
      const histDir = path.join(targetDir, '.noted_history', fileName);
      try {
        await fs.promises.access(histDir);
      } catch {
        return { success: true, data: [] };
      }
      const snapshots = (await fs.promises.readdir(histDir))
        .filter(f => f.endsWith('.html'))
        .sort()
        .reverse()
        .map(f => ({ name: f, ts: f.replace('.html', '').replace(/T/, ' ').replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, '.$1.$2').replace('T', ' ') }));
      return { success: true, data: snapshots };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('read-note-snapshot', async (_, fileName: string, snapshotName: string, syncDir?: string) => {
    try {
      validateFileName(fileName);
      if (!/^[\w\-:.]+\.html$/.test(snapshotName)) throw new Error('Invalid snapshot name');
      const targetDir = getTargetDir(syncDir);
      const snapshotPath = safeResolve(targetDir, path.join('.noted_history', fileName, snapshotName));
      const content = await fs.promises.readFile(snapshotPath, 'utf-8');
      return { success: true, data: content };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('rename-note', async (_, oldName: string, newName: string, syncDir?: string, opts?: { updateLinks?: boolean }) => {
    try {
      assertNotMigrating();
      validateFileName(oldName);
      validateFileName(newName);
      const targetDir = getTargetDir(syncDir);
      const oldPath = safeResolve(targetDir, oldName);
      const newPath = safeResolve(targetDir, newName);
      if (fs.existsSync(newPath)) throw new Error(`A note named "${newName}" already exists`);
      // The old name vanishes from the vault — claim it like a delete, or the
      // watcher reports the rename as an external removal.
      markAppDelete(oldName);
      fs.renameSync(oldPath, newPath);
      // Move the note's version history with it — a title-driven rename fires on
      // every title edit, and this keeps ".noted_history/<name>" from orphaning.
      const oldHist = path.join(targetDir, '.noted_history', oldName);
      const newHist = path.join(targetDir, '.noted_history', newName);
      if (fs.existsSync(oldHist) && !fs.existsSync(newHist)) {
        try {
          fs.mkdirSync(path.dirname(newHist), { recursive: true });
          fs.renameSync(oldHist, newHist);
        } catch { /* history move is best-effort */ }
      }
      markAppWrite(targetDir, newName);
      fullTextSearchIndex.renameDoc(targetDir, oldName, newName);
      vaultIndex.renameDoc(targetDir, oldName, newName);
      const links = opts?.updateLinks ? await rewriteLinks(targetDir, [{ from: oldName, to: newName }]) : undefined;
      return { success: true, links };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-note', async (_, fileName: string, syncDir?: string) => {
    try {
      assertNotMigrating();
      validateFileName(fileName);
      const targetDir = getTargetDir(syncDir);
      const filePath = safeResolve(targetDir, fileName);
      // Claim the delete before it happens: the watcher fires as soon as the file
      // leaves the vault, and an unclaimed removal reads as an external one.
      markAppDelete(fileName);
      // Move to the OS Trash (recoverable) rather than an unrecoverable unlink.
      await shell.trashItem(filePath);
      fullTextSearchIndex.deleteDoc(targetDir, fileName);
      vaultIndex.deleteDoc(targetDir, fileName);
      return { success: true };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wipe-all-notes', (_, syncDir?: string) => {
    try {
      assertNotMigrating();
      if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
      const targetDir = getTargetDir(syncDir);
    
      // Delete all note files (.md) and subfolders (directories that don't start with '.')
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.md' || ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'].includes(ext)) {
            fs.unlinkSync(fullPath);
          }
        }
      }

      // Delete the history folder if it exists
      const histDir = path.join(targetDir, '.noted_history');
      if (fs.existsSync(histDir)) {
        fs.rmSync(histDir, { recursive: true, force: true });
      }

      fullTextSearchIndex.clearDir(targetDir);
      vaultIndex.clearDir(targetDir);
      return { success: true };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });
}
