import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getNotesList: (syncDir?: string) => ipcRenderer.invoke('get-notes-list', syncDir),
  readNote: (fileName: string, syncDir?: string) => ipcRenderer.invoke('read-note', fileName, syncDir),
  saveNote: (fileName: string, content: string, syncDir?: string) => ipcRenderer.invoke('save-note', fileName, content, syncDir),
  deleteNote: (fileName: string, syncDir?: string) => ipcRenderer.invoke('delete-note', fileName, syncDir),
  wipeAllNotes: (syncDir?: string) => ipcRenderer.invoke('wipe-all-notes', syncDir),
  selectSyncFolder: () => ipcRenderer.invoke('select-sync-folder'),
  exportPdf: (htmlContent: string) => ipcRenderer.invoke('export-pdf', htmlContent),
  printNote: (htmlContent: string, title?: string) => ipcRenderer.invoke('print-note', htmlContent, title),
  renameNote: (oldName: string, newName: string, syncDir?: string) => ipcRenderer.invoke('rename-note', oldName, newName, syncDir),
  exportMarkdown: (content: string) => ipcRenderer.invoke('export-markdown', content),
  storeApiKey: (key: string) => ipcRenderer.invoke('store-api-key', key),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  llmFetch: (url: string, options: { method: string; headers: Record<string, string>; body: string }) =>
    ipcRenderer.invoke('llm-fetch', url, options),
  getNoteHistory: (fileName: string, syncDir?: string) => ipcRenderer.invoke('get-note-history', fileName, syncDir),
  readNoteSnapshot: (fileName: string, snapshotName: string, syncDir?: string) => ipcRenderer.invoke('read-note-snapshot', fileName, snapshotName, syncDir),
  saveCapture: (text: string) => ipcRenderer.invoke('save-capture', text),
  closeCapture: () => ipcRenderer.invoke('close-capture'),
  onRefreshNotes: (cb: () => void) => ipcRenderer.on('refresh-notes', cb),
  getNativeTheme: () => ipcRenderer.invoke('get-native-theme') as Promise<{ isDark: boolean }>,
  onNativeThemeUpdated: (cb: (theme: 'dark' | 'light') => void) => {
    const listener = (_e: unknown, theme: 'dark' | 'light') => cb(theme);
    ipcRenderer.on('native-theme-updated', listener);
    return () => {
      ipcRenderer.removeListener('native-theme-updated', listener);
    };
  },
  exportHtml: (htmlContent: string, title: string) => ipcRenderer.invoke('export-html', htmlContent, title),
  exportDocx: (htmlContent: string, title: string) => ipcRenderer.invoke('export-docx', htmlContent, title),
  importVault: (targetDir?: string) => ipcRenderer.invoke('import-vault', targetDir),
  getICloudPath: () => ipcRenderer.invoke('get-icloud-path'),
  detectCloudProviders: () => ipcRenderer.invoke('detect-cloud-providers'),
  activateCloudProvider: (notedPath: string) => ipcRenderer.invoke('activate-cloud-provider', notedPath),
  copyVaultToFolder: (args: { destDir?: string; syncDir?: string }) => ipcRenderer.invoke('copy-vault-to-folder', args),
  shareNoteMacOS: (args: { content: string; title: string }) => ipcRenderer.invoke('share-note-macos', args),
  getNotesTree: (syncDir?: string) => ipcRenderer.invoke('get-notes-tree', syncDir),
  createFolder: (name: string, syncDir?: string) => ipcRenderer.invoke('create-folder', name, syncDir),
  renameFolder: (oldName: string, newName: string, syncDir?: string) => ipcRenderer.invoke('rename-folder', oldName, newName, syncDir),
  deleteFolder: (name: string, syncDir?: string) => ipcRenderer.invoke('delete-folder', name, syncDir),
  moveNote: (fileName: string, toFolder: string, syncDir?: string) => ipcRenderer.invoke('move-note', fileName, toFolder, syncDir),
  setNoteTitle: (noteName: string) => ipcRenderer.invoke('set-note-title', noteName),
  safeStorageStatus: () => ipcRenderer.invoke('safe-storage-status') as Promise<{ encrypted: boolean }>,
  getMcpServerPath: () => ipcRenderer.invoke('get-mcp-server-path') as Promise<{ path: string; exists: boolean }>,
  revealInFinder: (fsPath: string) => ipcRenderer.invoke('reveal-in-finder', fsPath) as Promise<{ success: boolean }>,
  gitStoreToken: (token: string) => ipcRenderer.invoke('git-store-token', token),
  gitGetToken: () => ipcRenderer.invoke('git-get-token'),
  // Git ops
  gitStatus: (syncDir?: string) => ipcRenderer.invoke('git-status', syncDir),
  gitInit: (syncDir?: string) => ipcRenderer.invoke('git-init', syncDir),
  gitCommitNote: (noteName: string, message?: string, syncDir?: string) => ipcRenderer.invoke('git-commit-note', noteName, message, syncDir),
  gitCommitAll: (message: string, syncDir?: string) => ipcRenderer.invoke('git-commit-all', message, syncDir),
  gitPreparePrBranch: (noteName: string, commitMessage?: string, syncDir?: string) => ipcRenderer.invoke('git-prepare-pr-branch', noteName, commitMessage, syncDir),
  gitPushBranch: (branch: string, remoteUrl: string, syncDir?: string) => ipcRenderer.invoke('git-push-branch', branch, remoteUrl, syncDir),
  gitLog: (noteName?: string, syncDir?: string) => ipcRenderer.invoke('git-log', noteName, syncDir),
  gitCreatePr: (params: { remoteUrl: string; token: string; branch: string; base: string; title: string; body: string }) => ipcRenderer.invoke('git-create-pr', params),
  gitSaveAsGist: (params: { fileName: string; content: string; isPublic: boolean; token: string }) => ipcRenderer.invoke('git-save-as-gist', params),
  searchNotesFulltext: (query: string, syncDir?: string) => ipcRenderer.invoke('search-notes-fulltext', query, syncDir),
  setupClaudeMcp: () => ipcRenderer.invoke('setup-claude-mcp'),
  importAppleNotes: (targetDir?: string) => ipcRenderer.invoke('import-apple-notes', targetDir),
  updateMcpSseConfig: (config: { enabled: boolean; port: number; syncDir?: string }) =>
    ipcRenderer.invoke('update-mcp-sse-config', config),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
