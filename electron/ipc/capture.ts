import { ipcMain } from 'electron';
import fs from 'node:fs';
import { stripUnsafeHtml } from '../ipc-utils';
import { readVaultFormat } from '../../shared/vault/formatFile';
import { toCaptureTarget } from '../../shared/capture/target';
import { assertNotMigrating } from '../core/migrating';
import { getTargetDir, safeResolve, getActiveVaultDir } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { markAppWrite } from '../core/app-writes';
import { saveSnapshot, writeFileDurable } from '../core/note-io';
import { currentLanguage, tr } from '../core/language';
import { getMainWindow, closeCaptureWindow } from '../core/windows';
import { plainBody, writeCapture } from '../capture-write';

const DATE_LOCALE: Record<string, string> = { en: 'en-US', it: 'it-IT', es: 'es-ES', pt: 'pt-PT', fr: 'fr-FR', de: 'de-DE' };

export function registerCaptureHandlers(): void {
  ipcMain.handle('save-capture', async (_, text: string, target?: unknown) => {
    try {
      assertNotMigrating();
      if (typeof text !== 'string' || !text.trim()) return { success: false };
      // Honor the user's configured vault (not just the default dir).
      const targetDir = getTargetDir(getActiveVaultDir() || undefined);
      // Written in the vault's own format (see shared/vault/format.ts).
      const format = readVaultFormat(targetDir);
      const written = new Map<string, string>();
      const result = await writeCapture({
        format,
        now: () => new Date(),
        readNote: async (name) => { try { return await fs.promises.readFile(safeResolve(targetDir, name), 'utf8'); } catch { return null; } },
        writeNote: async (name, content) => { await writeFileDurable(safeResolve(targetDir, name), content); written.set(name, content); },
        snapshotBefore: (name, previous) => saveSnapshot(targetDir, name, previous, { force: true }),
        daily: (now) => ({
          title: new Intl.DateTimeFormat(DATE_LOCALE[currentLanguage()] ?? 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now),
          notes: tr('dailySectionNotes'), todo: tr('dailySectionTodo'), ideas: tr('dailySectionIdeas'),
        }),
        newNoteBody: plainBody(format, stripUnsafeHtml),
      }, text, toCaptureTarget(target));
      const content = written.get(result.fileName) ?? '';
      // A note that was already there is left unmarked on purpose: if it is open in the editor, the watcher tells the editor it
      // changed underneath it, so the next autosave cannot erase the capture.
      if (result.created) markAppWrite(targetDir, result.fileName);
      fullTextSearchIndex.upsertFromRaw(targetDir, result.fileName, content);
      vaultIndex.upsertFromRaw(targetDir, result.fileName, content);
      closeCaptureWindow();
      getMainWindow()?.webContents.send('refresh-notes');
      return { success: true, fileName: result.fileName };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('close-capture', () => { closeCaptureWindow(); });
}
