export {};

interface NoteFileBase {
  name: string;
  path: string;
  stats: { mtimeMs: number; ctimeMs: number; size: number };
}

interface NotesTree {
  rootNotes: NoteFileBase[];
  folders: { name: string; notes: NoteFileBase[] }[];
}

declare global {
  interface Window {
    electronAPI: {
      getNotesList: (syncDir?: string) => Promise<{ success: boolean; data?: unknown[]; error?: string }>;
      readNote: (fileName: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      saveNote: (fileName: string, content: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      deleteNote: (fileName: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      selectSyncFolder: () => Promise<{ success: boolean; data?: string }>;
      exportPdf: (htmlContent: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      printNote: (htmlContent: string, title?: string) => Promise<{ success: boolean; error?: string }>;
      renameNote: (oldName: string, newName: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      exportMarkdown: (content: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      storeApiKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      getApiKey: () => Promise<{ success: boolean; data?: string; error?: string }>;
      llmFetch: (url: string, options: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: string }>;
      getNoteHistory: (fileName: string, syncDir?: string) => Promise<{ success: boolean; data?: { name: string; ts: string }[]; error?: string }>;
      readNoteSnapshot: (fileName: string, snapshotName: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      saveCapture: (text: string) => Promise<{ success: boolean; fileName?: string; error?: string }>;
      closeCapture: () => Promise<void>;
      onRefreshNotes: (cb: () => void) => void;
      getNativeTheme: () => Promise<{ isDark: boolean }>;
      onNativeThemeUpdated?: (cb: (theme: 'dark' | 'light') => void) => void;
      exportHtml: (htmlContent: string, title: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      exportDocx: (htmlContent: string, title: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      importVault: (targetDir?: string) => Promise<{ success: boolean; data?: number; error?: string }>;
      getICloudPath: () => Promise<{ success: boolean; data?: string; error?: string }>;
      detectCloudProviders: () => Promise<{ success: boolean; data?: Array<{ id: string; name: string; basePath: string; notedPath: string; available: boolean }>; error?: string }>;
      activateCloudProvider: (notedPath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      copyVaultToFolder: (args: { destDir?: string; syncDir?: string }) => Promise<{ success: boolean; canceled?: boolean; data?: { copied: number; destDir: string }; error?: string }>;
      shareNoteMacOS: (args: { content: string; title: string }) => Promise<{ success: boolean; fallback?: boolean; error?: string }>;
      getNotesTree: (syncDir?: string) => Promise<{ success: boolean; data?: NotesTree; error?: string }>;
      createFolder: (name: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      renameFolder: (oldName: string, newName: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      deleteFolder: (name: string, syncDir?: string) => Promise<{ success: boolean; error?: string }>;
      moveNote: (fileName: string, toFolder: string, syncDir?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      setNoteTitle: (noteName: string) => Promise<void>;
      safeStorageStatus: () => Promise<{ encrypted: boolean }>;
      gitStoreToken: (token: string) => Promise<{ success: boolean; error?: string }>;
      gitGetToken: () => Promise<{ success: boolean; data?: string; error?: string }>;
      // Git ops
      gitStatus: (syncDir?: string) => Promise<GitResult<GitStatusData>>;
      gitInit: (syncDir?: string) => Promise<GitResult>;
      gitCommitNote: (noteName: string, message?: string, syncDir?: string) => Promise<GitResult<{ hash: string }>>;
      gitCommitAll: (message: string, syncDir?: string) => Promise<GitResult<{ hash: string }>>;
      gitPreparePrBranch: (noteName: string, commitMessage?: string, syncDir?: string) => Promise<GitResult<{ branch: string; hash: string }>>;
      gitPushBranch: (branch: string, remoteUrl: string, syncDir?: string) => Promise<GitResult>;
      gitLog: (noteName?: string, syncDir?: string) => Promise<GitResult<GitLogEntry[]>>;
      gitCreatePr: (params: { remoteUrl: string; token: string; branch: string; base: string; title: string; body: string }) => Promise<GitResult<PrData>>;
      gitSaveAsGist: (params: { fileName: string; content: string; isPublic: boolean; token: string }) => Promise<GitResult<string>>;
      searchNotesFulltext: (query: string, syncDir?: string) => Promise<{ success: boolean; data?: Array<{ relPath: string; title: string; snippet: string; score: number; terms: string[] }>; truncated?: boolean; error?: string }>;
    };
  }
}

interface GitResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

interface GitStatusData {
  initialized: boolean;
  branch: string;
  dirty: boolean;
  ahead: number;
  stagedFiles: string[];
  modifiedFiles: string[];
}

interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

interface PrData {
  url: string;
  number: number;
  title: string;
}