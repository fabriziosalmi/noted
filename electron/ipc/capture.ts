import { ipcMain } from 'electron';
import crypto from 'node:crypto';
import { stripUnsafeHtml } from '../ipc-utils';
import { readVaultFormat } from '../../shared/vault/formatFile';
import { plainTextToMarkdown } from '../../shared/markdown/codec';
import { assertNotMigrating } from '../core/migrating';
import { getTargetDir, safeResolve, getActiveVaultDir } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { markAppWrite } from '../core/app-writes';
import { writeFileDurable } from '../core/note-io';
import { getMainWindow, closeCaptureWindow } from '../core/windows';

export function registerCaptureHandlers(): void {
  ipcMain.handle('save-capture', async (_, text: string) => {
    try {
      assertNotMigrating();
      if (typeof text !== 'string' || !text.trim()) return { success: false };
      const pad = (n: number) => String(n).padStart(2, '0');
      const now = new Date();
      // Seconds + a short random suffix so two captures in the same minute don't
      // overwrite each other.
      const rand = crypto.randomBytes(2).toString('hex');
      const fileName = `Capture_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_${rand}.md`;
      // Honor the user's configured vault (not just the default dir).
      const targetDir = getTargetDir(getActiveVaultDir() || undefined);
      // Written in the vault's own format (see shared/vault/format.ts).
      const content = readVaultFormat(targetDir) === 'markdown'
        ? plainTextToMarkdown(text)
        : `<p>${stripUnsafeHtml(text).replace(/\n/g, '</p><p>')}</p>`;
      await writeFileDurable(safeResolve(targetDir, fileName), content);
      markAppWrite(targetDir, fileName);
      fullTextSearchIndex.upsertFromRaw(targetDir, fileName, content);
      vaultIndex.upsertFromRaw(targetDir, fileName, content);
      closeCaptureWindow();
      getMainWindow()?.webContents.send('refresh-notes');
      return { success: true, fileName };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('close-capture', () => { closeCaptureWindow(); });
}
