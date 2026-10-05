import { ipcMain, shell } from 'electron';
import { validateFileName } from '../ipc-utils';
import { saveAttachment, scanEmbeddedImages, migrateEmbeddedImages, listOrphanAttachments, deleteAttachments, inlineVaultImages, AttachmentError } from '../attachments';
import { logEvent } from '../structured-log';
import { getTargetDir } from '../core/paths';
import { attachmentsFolderOf, vaultNoteDeps } from '../core/rewrite';

// ─── Image attachments ────────────────────────────────────────────────────────

const toApiError = (err: unknown) => ({ success: false as const, error: err instanceof AttachmentError ? err.message : (err as Error).message });

export function registerAttachmentsHandlers(): void {
  // A pasted/dropped image: stored under its content hash, the note keeps the path.
  ipcMain.handle('save-attachment', (_, bytes: unknown, folder?: string, syncDir?: string) => {
    try {
      if (!(bytes instanceof Uint8Array)) throw new AttachmentError('Image data must be binary');
      const saved = saveAttachment(getTargetDir(syncDir), attachmentsFolderOf(folder), bytes);
      return { success: true, data: saved.rel };
    } catch (err) {
      return toApiError(err);
    }
  });

  // Dry run first: what moving embedded (base64) images out of notes would do.
  ipcMain.handle('scan-embedded-images', async (_, syncDir?: string) => {
    try {
      const dir = getTargetDir(syncDir);
      return { success: true, data: await scanEmbeddedImages(dir, vaultNoteDeps(dir)) };
    } catch (err) {
      return toApiError(err);
    }
  });

  ipcMain.handle('migrate-embedded-images', async (_, folder?: string, syncDir?: string) => {
    try {
      const dir = getTargetDir(syncDir);
      const out = await migrateEmbeddedImages(dir, attachmentsFolderOf(folder), vaultNoteDeps(dir));
      logEvent('info', 'embedded_images_migrated', { notes: out.notes, images: out.images, failed: out.failed.length });
      return { success: true, data: out };
    } catch (err) {
      return toApiError(err);
    }
  });

  // Images only this note uses (what deleting it would leave unused), and their removal.
  ipcMain.handle('list-orphan-attachments', async (_, noteName: string, folder?: string, syncDir?: string) => {
    try {
      validateFileName(noteName);
      const dir = getTargetDir(syncDir);
      return { success: true, data: await listOrphanAttachments(dir, attachmentsFolderOf(folder), noteName, vaultNoteDeps(dir)) };
    } catch (err) {
      return toApiError(err);
    }
  });

  ipcMain.handle('delete-attachments', async (_, rels: unknown, folder?: string, syncDir?: string) => {
    try {
      if (!Array.isArray(rels) || rels.length > 500 || rels.some(r => typeof r !== 'string')) throw new AttachmentError('Invalid attachment list');
      const dir = getTargetDir(syncDir);
      return { success: true, data: await deleteAttachments(dir, attachmentsFolderOf(folder), rels as string[], vaultNoteDeps(dir), (file) => shell.trashItem(file)) };
    } catch (err) {
      return toApiError(err);
    }
  });

  // Exports must stand alone: embed the vault's images into the HTML/Markdown being exported.
  ipcMain.handle('inline-vault-images', (_, content: unknown, syncDir?: string) => {
    try {
      if (typeof content !== 'string') throw new AttachmentError('Content must be a string');
      return { success: true, data: inlineVaultImages(getTargetDir(syncDir), content) };
    } catch (err) {
      return toApiError(err);
    }
  });
}
