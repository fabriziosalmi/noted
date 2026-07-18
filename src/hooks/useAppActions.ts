import { useCallback } from 'react';
import type { AppActionsArgs } from './contracts';
import { getElectronApi } from '../lib/electronApi';

export function useAppActions({
  t,
  syncDirectory,
  toast,
  fetchNotes,
  createNote,
  openOrCreateDaily,
  deleteNote,
  renameNote,
  updateSettings,
  createFolder,
  renameFolder,
  deleteFolder,
  moveNote,
}: AppActionsArgs) {
  const handleCreateNote = useCallback(async (folder?: string) => {
    try {
      const baseName = `${t('newNoteFilePrefix')}_${Date.now()}.md`;
      // Empty title + body: the caret lands in the empty <h1> (NoteEditor focuses
      // 'start'), the placeholder shows "Title", and the filename then follows
      // whatever title you type — Apple Notes muscle memory.
      const initialContent = '<h1></h1><p></p>';
      await createNote(folder ? `${folder}/${baseName}` : baseName, initialContent);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [createNote, toast, t]);

  const handleOpenDaily = useCallback(async () => {
    try {
      await openOrCreateDaily();
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [openOrCreateDaily, toast]);

  const handleSelectFolder = useCallback(async () => {
    const api = getElectronApi();
    if (!api) return;
    const res = await api.selectSyncFolder();
    if (res.success && res.data) {
      updateSettings({ syncDirectory: res.data });
      void fetchNotes();
    }
  }, [updateSettings, fetchNotes]);

  const handleDeleteNote = useCallback(async (fileName: string) => {
    try {
      await deleteNote(fileName);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [deleteNote, toast]);

  const handleRenameNote = useCallback(async (oldName: string, newName: string) => {
    try {
      await renameNote(oldName, newName);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [renameNote, toast]);

  const handleImportVault = useCallback(async () => {
    const api = getElectronApi();
    if (!api) return;
    const res = await api.importVault(syncDirectory || undefined);
    if (res.success) {
      toast(`${res.data ?? 0} ${t('notesImported')}`, 'success');
      void fetchNotes();
    } else {
      toast(res.error ?? t('importError'), 'error');
    }
  }, [t, syncDirectory, fetchNotes, toast]);

  const handleCreateFolder = useCallback(async (name: string) => {
    try {
      await createFolder(name);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [createFolder, toast]);

  const handleRenameFolder = useCallback(async (oldName: string, newName: string) => {
    try {
      await renameFolder(oldName, newName);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [renameFolder, toast]);

  const handleDeleteFolder = useCallback(async (name: string) => {
    try {
      await deleteFolder(name);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [deleteFolder, toast]);

  const handleMoveNote = useCallback(async (fileName: string, destination: string) => {
    try {
      await moveNote(fileName, destination);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [moveNote, toast]);

  return {
    handleCreateNote,
    handleOpenDaily,
    handleSelectFolder,
    handleDeleteNote,
    handleRenameNote,
    handleImportVault,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleMoveNote,
  };
}
