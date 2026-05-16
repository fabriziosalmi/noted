import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getNotesList: (syncDir?: string) => ipcRenderer.invoke('get-notes-list', syncDir),
  readNote: (fileName: string, syncDir?: string) => ipcRenderer.invoke('read-note', fileName, syncDir),
  saveNote: (fileName: string, content: string, syncDir?: string) => ipcRenderer.invoke('save-note', fileName, content, syncDir),
  deleteNote: (fileName: string, syncDir?: string) => ipcRenderer.invoke('delete-note', fileName, syncDir),
  selectSyncFolder: () => ipcRenderer.invoke('select-sync-folder'),
  exportPdf: (htmlContent: string) => ipcRenderer.invoke('export-pdf', htmlContent),
});
