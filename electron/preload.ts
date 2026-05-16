import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getNotesList: () => ipcRenderer.invoke('get-notes-list'),
  readNote: (fileName: string) => ipcRenderer.invoke('read-note', fileName),
  saveNote: (fileName: string, content: string) => ipcRenderer.invoke('save-note', fileName, content),
  deleteNote: (fileName: string) => ipcRenderer.invoke('delete-note', fileName),
});
